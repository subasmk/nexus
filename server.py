"""Nexus local server. Python standard library only, no pip install.
Serves the web UI and forwards chat requests to Ollama on this laptop."""
import json, os, sys, urllib.request, urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
if not OLLAMA.startswith("http"):
    OLLAMA = "http://" + OLLAMA
PORT = int(os.environ.get("NEXUS_PORT", "8080"))
WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, fmt, *args):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/models":
            try:
                with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=4) as r:
                    data = json.load(r)
                names = [m.get("name") for m in data.get("models", [])]
                return self._json(200, {"ok": True, "models": names})
            except Exception as e:
                return self._json(200, {"ok": False, "models": [], "error": str(e)})
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/chat":
            return self._json(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(n) or b"{}")
        payload["stream"] = True
        req = urllib.request.Request(
            OLLAMA + "/api/chat",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            upstream = urllib.request.urlopen(req, timeout=300)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            return self._json(e.code, {"error": detail})
        except Exception as e:
            return self._json(502, {"error": "Cannot reach Ollama at %s (%s)" % (OLLAMA, e)})
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            for line in upstream:
                self.wfile.write(line)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            upstream.close()


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Nexus is running: http://localhost:%d  (Ollama: %s)" % (PORT, OLLAMA))
    print("Open it in Chrome or Edge. Press Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass

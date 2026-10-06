"""Fake Ollama for testing the UI without a GPU. Not used in real runs.
Run: python tools-mock-ollama.py   (listens on 11434)"""
import json, time
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        b = json.dumps({"models": [{"name": "gemma3:latest"}, {"name": "llama3.2:3b"}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); req = json.loads(self.rfile.read(n))
        last = req["messages"][-1]["content"]
        tamil = any("\u0b80" <= c <= "\u0bff" for c in last)
        text = ("வணக்கம்! நான் நெக்சஸ். நீங்கள் கேட்டதை எளிமையாக விளக்குகிறேன்." if tamil
                else "Hi, I'm Nexus. Photosynthesis is how plants turn sunlight, water and carbon dioxide into food.")
        self.send_response(200); self.send_header("Content-Type", "application/x-ndjson"); self.end_headers()
        for w in text.split(" "):
            self.wfile.write((json.dumps({"message": {"role": "assistant", "content": w + " "}, "done": False}) + "\n").encode()); self.wfile.flush(); time.sleep(0.05)
        self.wfile.write((json.dumps({"message": {"role": "assistant", "content": ""}, "done": True}) + "\n").encode())

HTTPServer(("127.0.0.1", 11434), H).serve_forever()

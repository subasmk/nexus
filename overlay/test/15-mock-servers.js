// Fake Groq (OpenAI style) and fake Ollama, for testing the overlay without keys or a GPU.
const http = require("http");
const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
const send = (res, o, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };

http.createServer(async (req, res) => { // fake Groq on 9101
  const raw = await body(req);
  if (req.url.endsWith("/audio/transcriptions")) return send(res, { text: "open the devpost hackathons page" });
  if (req.url.endsWith("/chat/completions")) {
    if (req.headers.authorization !== "Bearer gsk_mock_key") return send(res, { error: "bad key" }, 401);
    const j = JSON.parse(raw); const last = j.messages[j.messages.length - 1];
    const text = last.role === "user" ? last.content.toLowerCase() : "";
    const tc = (name, args) => ({ choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } }] } }], usage: { total_tokens: 420 } });
    if (last.role === "tool") return send(res, { choices: [{ message: { role: "assistant", content: last.content.startsWith("ERROR") ? "Okay, I will not do that." : "Done. I opened it for you." } }], usage: { total_tokens: 180 } });
    if (text.includes("remember")) return send(res, tc("remember", { text: "He is preparing for hackathons" }));
    if (text.includes("open")) return send(res, tc("open_file", { path: "C:\\Users\\SUBASH M\\Documents\\resume.pdf" }));
    return send(res, { choices: [{ message: { role: "assistant", content: "Hi da! I am Nexus. Enna help venum?" } }], usage: { total_tokens: 150 } });
  }
  send(res, {}, 404);
}).listen(9101);

http.createServer(async (req, res) => { // fake Ollama on 9102
  await body(req);
  send(res, { message: { role: "assistant", content: "Local brain here. I am a smaller model, so I may be slower." } });
}).listen(9102);
console.log("mock groq :9101, mock ollama :9102");

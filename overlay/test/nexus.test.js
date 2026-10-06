const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"); const os = require("os"); const path = require("path");
const { createSettings } = require("../src/settings");
const { createMemory } = require("../src/memory");
const { createEngine } = require("../src/perm");
const { buildTools } = require("../src/tools");
const { createBrain } = require("../src/brain");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "nexus-"));
const fakeSafe = (avail = true) => ({
  isEncryptionAvailable: () => avail,
  encryptString: (s) => Buffer.from("ENC:" + Buffer.from(s).toString("base64")),
  decryptString: (b) => Buffer.from(b.toString().slice(4), "base64").toString()
});

function rig({ answers = [], avail = true } = {}) {
  const dir = tmp(); const settings = createSettings(dir, fakeSafe(avail)); const memory = createMemory(dir);
  const opened = []; const logs = []; const asked = [];
  const shell = { openExternal: async (u) => opened.push(u), openPath: async (p) => { opened.push(p); return ""; } };
  const ran = [];
  const tools = buildTools({ memory, settings, shell, notesDir: path.join(dir, "notes"), remind: () => {} });
  // test-only strong tool, to prove the typed-phrase gate (slice 1 ships no real submit tool)
  tools.push({ name: "submit_form", tier: "strong", describe: () => "Submit the registration form", run: async () => { ran.push("submitted"); return "submitted"; } });
  let paused = false;
  const engine = createEngine({ tools, ask: async (r) => { asked.push(r); return answers.shift(); }, log: (e) => logs.push(e), isPaused: () => paused });
  return { dir, settings, memory, engine, tools, opened, logs, asked, ran, pause: (v) => (paused = v) };
}

test("key is stored encrypted, never as plain text", () => {
  const r = rig(); r.settings.saveKey("gsk_secret123"); r.settings.set({ speak: true });
  const raw = fs.readFileSync(path.join(r.dir, "groq.key.enc"), "utf8");
  assert.ok(!raw.includes("gsk_secret123")); assert.ok(!Buffer.from(raw, "base64").toString().includes("gsk_secret123"));
  assert.strictEqual(r.settings.getKey(), "gsk_secret123");
  assert.ok(!fs.readFileSync(path.join(r.dir, "settings.json"), "utf8").includes("gsk_secret"));
});
test("key is not written to disk when encryption is unavailable", () => {
  const r = rig({ avail: false }); assert.strictEqual(r.settings.saveKey("gsk_x").stored, "session-only");
  assert.ok(!fs.existsSync(path.join(r.dir, "groq.key.enc"))); assert.strictEqual(r.settings.getKey(), "gsk_x");
});
test("tiers: plain link auto, login link approval, non-http denied", () => {
  const r = rig();
  assert.strictEqual(r.engine.classify("open_url", { url: "https://devpost.com/hackathons" }), "auto");
  assert.strictEqual(r.engine.classify("open_url", { url: "https://accounts.google.com/signin" }), "approval");
  assert.strictEqual(r.engine.classify("open_url", { url: "file:///etc/passwd" }), "deny");
  assert.strictEqual(r.engine.classify("open_url", { url: "javascript:alert(1)" }), "deny");
});
test("unknown tool names that look like submit/send/push/pay are strong, others denied", () => {
  const r = rig();
  for (const n of ["submit_form", "send_email", "git_push", "delete_repo", "pay_now"]) assert.strictEqual(r.engine.classify(n, {}), "strong");
  assert.strictEqual(r.engine.classify("format_disk", {}), "deny");
});
test("auto tool runs without asking; approval tool waits for yes", async () => {
  const r = rig({ answers: [false, true] });
  assert.ok((await r.engine.execute("open_url", { url: "https://example.com" })).ok); assert.strictEqual(r.asked.length, 0);
  const no = await r.engine.execute("open_file", { path: "C:/a.txt" }); assert.ok(!no.ok); assert.strictEqual(r.opened.length, 1);
  const yes = await r.engine.execute("open_file", { path: "C:/a.txt" }); assert.ok(yes.ok); assert.strictEqual(r.opened.length, 2);
});
test("strong tier needs the exact typed phrase", async () => {
  const r = rig({ answers: ["yes", true, " YES SUBMIT "] });
  assert.ok(!(await r.engine.execute("submit_form", {})).ok);   // "yes" is not enough
  assert.ok(!(await r.engine.execute("submit_form", {})).ok);   // a plain Approve tap is not enough
  assert.strictEqual(r.ran.length, 0);
  assert.ok((await r.engine.execute("submit_form", {})).ok);    // exact phrase (case/space tolerant)
  assert.deepStrictEqual(r.ran, ["submitted"]);
  assert.strictEqual(r.asked[0].kind, "strong"); assert.strictEqual(r.asked[0].confirmWord, "yes submit");
});
test("tools that do not exist are refused without running or asking", async () => {
  const r = rig({ answers: [true] });
  for (const n of ["send_email", "git_push", "format_disk"]) assert.ok(!(await r.engine.execute(n, {})).ok);
  assert.strictEqual(r.asked.length, 0);
});
test("pause blocks everything, and a model cannot approve for himself", async () => {
  const r = rig({ answers: [undefined] }); r.pause(true);
  assert.ok(!(await r.engine.execute("open_url", { url: "https://example.com" })).ok);
  r.pause(false);
  assert.ok(!(await r.engine.execute("open_file", { path: "x" })).ok); // no answer = no
  assert.strictEqual(r.opened.length, 0);
});
test("folders: allowed folder lists without asking, other folder asks", async () => {
  const r = rig({ answers: [false] }); const f = tmp(); fs.writeFileSync(path.join(f, "a.txt"), "hi");
  r.settings.set({ allowedFolders: [f] });
  const a = await r.engine.execute("list_folder", { path: f }); assert.ok(a.ok); assert.match(a.result, /a.txt/); assert.strictEqual(r.asked.length, 0);
  assert.ok(!(await r.engine.execute("list_folder", { path: os.tmpdir() })).ok); assert.strictEqual(r.asked.length, 1);
  assert.ok(!(await r.engine.execute("list_folder", { path: path.join(f, "..", "x") })).ok);
});
test("memory: remember, dedupe, forget needs approval, summary compaction", async () => {
  const r = rig({ answers: [true] });
  await r.engine.execute("remember", { text: "He studies B.Tech AI and DS" }); await r.engine.execute("remember", { text: "he studies b.tech ai and ds" });
  assert.strictEqual(r.memory.facts().length, 1);
  assert.ok((await r.engine.execute("forget", { query: "b.tech" })).ok); assert.strictEqual(r.memory.facts().length, 0);
  for (let i = 0; i < 30; i++) r.memory.addTurn("user", "msg " + i);
  await r.memory.compact(async () => "short summary"); assert.strictEqual(r.memory.history().length, 12); assert.strictEqual(r.memory.summary(), "short summary");
});

function mkFetch(script) { // script: array of handlers by url substring
  const calls = [];
  const f = async (url, opt) => { calls.push({ url, opt }); for (const [k, h] of script) if (url.includes(k)) return h(url, opt, calls.length); throw new Error("no route"); };
  f.calls = calls; return f;
}
const J = (o, status = 200) => ({ ok: status < 300, status, json: async () => o });
const groqText = (t, tokens = 100) => J({ choices: [{ message: { content: t } }], usage: { total_tokens: tokens } });
const ollamaText = (t) => J({ message: { role: "assistant", content: t } });

test("brain: Groq first, counts tokens, sends key only to Groq", async () => {
  const r = rig(); r.settings.saveKey("gsk_k");
  const f = mkFetch([["groq.com", () => groqText("Hello da", 321)]]);
  const b = createBrain({ ...r, fetchImpl: f }); const out = await b.chat("hi");
  assert.strictEqual(out.brain, "groq"); assert.strictEqual(out.text, "Hello da"); assert.strictEqual(r.settings.tokensToday(), 321);
  assert.strictEqual(f.calls[0].opt.headers.Authorization, "Bearer gsk_k");
  const body = JSON.parse(f.calls[0].opt.body); assert.ok(body.tools.length >= 6); assert.match(body.messages[0].content, /NEVER write Tamil script/);
});
test("brain: falls back to local Ollama on 429, 401, network error", async () => {
  for (const mode of [429, 401, "net"]) {
    const r = rig(); r.settings.saveKey("gsk_k");
    const f = mkFetch([["groq.com", () => { if (mode === "net") throw new Error("offline"); return J({}, mode); }], ["11434", () => ollamaText("local answer")]]);
    const out = await createBrain({ ...r, fetchImpl: f }).chat("hi"); assert.strictEqual(out.brain, "ollama"); assert.match(out.note, /local brain/);
  }
});
test("brain: Private mode never touches Groq (and no key is sent anywhere)", async () => {
  const r = rig(); r.settings.saveKey("gsk_k"); r.settings.set({ private: true });
  const f = mkFetch([["groq.com", () => { throw new Error("must not call"); }], ["11434", () => ollamaText("private ok")]]);
  const b = createBrain({ ...r, fetchImpl: f }); const out = await b.chat("secret stuff"); assert.strictEqual(out.brain, "ollama");
  assert.ok(f.calls.every((c) => !c.url.includes("groq")));
  await assert.rejects(b.transcribe(Buffer.from("x"), "audio/webm", ""), /Private mode/);
});
test("brain: no key uses local; daily budget used up uses local", async () => {
  let r = rig(); let f = mkFetch([["11434", () => ollamaText("ok")]]);
  assert.strictEqual((await createBrain({ ...r, fetchImpl: f }).chat("hi")).brain, "ollama");
  r = rig(); r.settings.saveKey("gsk_k"); r.settings.addTokens(195000);
  f = mkFetch([["groq.com", () => { throw new Error("must not call"); }], ["11434", () => ollamaText("ok")]]);
  const out = await createBrain({ ...r, fetchImpl: f }).chat("hi"); assert.strictEqual(out.brain, "ollama"); assert.match(out.note, /budget/);
});
test("brain: tool loop runs open_url (auto) and a prompt-injected strong tool still needs the phrase", async () => {
  const r = rig({ answers: [undefined] }); r.settings.saveKey("gsk_k");
  let n = 0;
  const f = mkFetch([["groq.com", () => {
    n++;
    if (n === 1) return J({ choices: [{ message: { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "open_url", arguments: '{"url":"https://example.com"}' } }, { id: "c2", type: "function", function: { name: "submit_form", arguments: "{}" } }] } }], usage: { total_tokens: 50 } });
    return groqText("Opened it.", 40);
  }]]);
  const out = await createBrain({ ...r, fetchImpl: f }).chat("open example");
  assert.strictEqual(out.text, "Opened it."); assert.deepStrictEqual(r.opened, ["https://example.com/"]);
  assert.strictEqual(r.asked.length, 1); assert.strictEqual(r.asked[0].kind, "strong"); assert.strictEqual(r.ran.length, 0);
  const second = JSON.parse(f.calls[1].opt.body).messages.filter((m) => m.role === "tool");
  assert.strictEqual(second.length, 2); assert.match(second[1].content, /ERROR/);
});
test("brain: transcribe sends key to Groq STT with language", async () => {
  const r = rig(); r.settings.saveKey("gsk_k");
  const f = mkFetch([["audio/transcriptions", () => J({ text: " hello there " })]]);
  assert.strictEqual(await createBrain({ ...r, fetchImpl: f }).transcribe(Buffer.from("abc"), "audio/webm", "ta"), "hello there");
  assert.strictEqual(f.calls[0].opt.headers.Authorization, "Bearer gsk_k"); assert.strictEqual(f.calls[0].opt.body.get("language"), "ta");
});

// Local memory: facts he tells her, the recent chat, and a short summary of older chat.
const fs = require("fs");
const path = require("path");

function createMemory(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "memory.json");
  let d;
  try { d = JSON.parse(fs.readFileSync(file, "utf8")); } catch { d = {}; }
  d.facts = d.facts || []; d.history = d.history || []; d.summary = d.summary || "";
  const save = () => fs.writeFileSync(file, JSON.stringify(d, null, 2));
  const id = () => Math.random().toString(36).slice(2, 8);

  return {
    facts: () => d.facts.slice(),
    addFact(text) {
      text = String(text || "").trim().slice(0, 300);
      if (!text) return null;
      const dup = d.facts.find((f) => f.text.toLowerCase() === text.toLowerCase());
      if (dup) return dup;
      const f = { id: id(), text, ts: new Date().toISOString() };
      d.facts.push(f); if (d.facts.length > 200) d.facts.shift(); save(); return f;
    },
    forget(query) {
      const q = String(query || "").trim().toLowerCase(); if (!q) return [];
      const gone = d.facts.filter((f) => f.id === q || f.text.toLowerCase().includes(q));
      d.facts = d.facts.filter((f) => !gone.includes(f)); save(); return gone;
    },
    findToForget(query) {
      const q = String(query || "").trim().toLowerCase(); if (!q) return [];
      return d.facts.filter((f) => f.id === q || f.text.toLowerCase().includes(q));
    },
    history: () => d.history.slice(),
    addTurn(role, content) { d.history.push({ role, content: String(content).slice(0, 4000) }); save(); },
    clearHistory() { d.history = []; d.summary = ""; save(); },
    summary: () => d.summary,
    // Keep the last `keep` turns; older turns are folded into a short summary.
    async compact(summarize, keep = 12, max = 24) {
      if (d.history.length <= max) return false;
      const old = d.history.splice(0, d.history.length - keep);
      let s = "";
      try { s = await summarize(old, d.summary); } catch {}
      if (!s) s = (d.summary + " | " + old.filter((m) => m.role === "user").map((m) => m.content.slice(0, 80)).join("; ")).slice(-600);
      d.summary = s.slice(0, 800); save(); return true;
    },
    promptBlock(maxChars = 1500) {
      let out = d.facts.map((f) => "- " + f.text).join("\n");
      if (out.length > maxChars) out = out.slice(out.length - maxChars);
      return out;
    }
  };
}
module.exports = { createMemory };

// Settings and the Groq API key. The key is only ever stored encrypted with the
// operating system (Windows DPAPI via Electron safeStorage). If encryption is not
// available the key is refused, never written as plain text.
const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  private: false,            // true = local Ollama only, nothing leaves the laptop
  paused: false,             // true = no tools run at all
  speak: true,
  voiceName: "",             // "" = auto-pick a male voice
  handsFree: false,          // always listening (only after he turns it on)
  wakeWord: true,            // hands-free only acts on speech that starts with "Nexus"
  groqModel: "openai/gpt-oss-120b",
  ollamaModel: "gemma3",
  allowedFolders: [],
  usage: { day: "", tokens: 0 },
  tokenLimitPerDay: 200000   // from Groq's rate-limit page; check your own Limits page
};

function today(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function createSettings(dir, safeStorage) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "settings.json");
  const keyFile = path.join(dir, "groq.key.enc");
  let data;
  try { data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { data = { ...DEFAULTS }; }
  const save = () => fs.writeFileSync(file, JSON.stringify(data, null, 2));
  let sessionKey = null; // used only when encryption is unavailable (not persisted)

  return {
    get: () => ({ ...data }),
    set(patch) {
      const allowed = ["private", "paused", "speak", "voiceName", "handsFree", "wakeWord", "groqModel", "ollamaModel", "allowedFolders"];
      for (const k of Object.keys(patch)) if (allowed.includes(k)) data[k] = patch[k];
      save(); return { ...data };
    },
    addTokens(n, now = new Date()) {
      const d = today(now);
      if (data.usage.day !== d) data.usage = { day: d, tokens: 0 };
      data.usage.tokens += Math.max(0, Number(n) || 0); save();
    },
    tokensToday(now = new Date()) { return data.usage.day === today(now) ? data.usage.tokens : 0; },
    saveKey(key) {
      key = String(key || "").trim();
      if (!key) throw new Error("Empty key");
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(keyFile, safeStorage.encryptString(key).toString("base64"));
        sessionKey = null; return { stored: "encrypted" };
      }
      sessionKey = key; // memory only, gone when the app closes
      return { stored: "session-only" };
    },
    getKey() {
      if (sessionKey) return sessionKey;
      try {
        const raw = Buffer.from(fs.readFileSync(keyFile, "utf8"), "base64");
        return safeStorage.decryptString(raw);
      } catch { return null; }
    },
    removeKey() { sessionKey = null; try { fs.unlinkSync(keyFile); } catch {} },
    hasKey() { return !!this.getKey(); }
  };
}
module.exports = { createSettings, today, DEFAULTS };

// Permission engine. Three tiers:
//   auto    - runs without asking (talk, remember, open a plain public link, list an allowed folder)
//   approval- shows the exact action, runs only after he taps Approve
//   strong  - shows the full action, runs only after he types the confirm phrase
// The model can only PROPOSE a tool call. This module decides, so a wrong or tricked
// model output cannot submit, send, push, delete or pay on its own.
const STRONG_WORDS = /(submit|send|push|delete|remove_repo|pay|purchase|buy|transfer|post_|publish|register)/i;
const CONFIRM_PHRASE = "yes submit";

function createEngine({ tools, ask, log, isPaused }) {
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  function classify(name, args) {
    const t = byName[name];
    if (!t) return STRONG_WORDS.test(name) ? "strong" : "deny";
    return typeof t.tier === "function" ? t.tier(args || {}) : t.tier;
  }

  async function execute(name, args) {
    args = args || {};
    const t = byName[name];
    if (isPaused()) { log({ name, args, tier: "paused", result: "blocked" }); return { ok: false, error: "Paused. Actions are switched off." }; }
    const tier = classify(name, args);
    if (tier === "deny" || !t) { log({ name, args, tier: "deny", result: "unknown tool" }); return { ok: false, error: "That tool does not exist." }; }
    if (tier === "approval" || tier === "strong") {
      const summary = t.describe ? t.describe(args) : name + " " + JSON.stringify(args);
      const answer = await ask({ kind: tier, summary, confirmWord: tier === "strong" ? CONFIRM_PHRASE : undefined });
      const okAnswer = tier === "strong" ? String(answer || "").trim().toLowerCase() === CONFIRM_PHRASE : answer === true;
      if (!okAnswer) { log({ name, args, tier, result: "declined" }); return { ok: false, error: "He said no." }; }
    }
    if (tier === "strong" && !t.run) return { ok: false, error: "Not available yet." };
    try {
      const result = await t.run(args);
      log({ name, args, tier, result: "ok" });
      return { ok: true, result };
    } catch (e) {
      log({ name, args, tier, result: "error: " + e.message });
      return { ok: false, error: e.message };
    }
  }
  return { classify, execute, CONFIRM_PHRASE };
}
module.exports = { createEngine, CONFIRM_PHRASE };

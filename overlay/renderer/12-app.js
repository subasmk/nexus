(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const api = window.nexus;
  let S = null, recorder = null, chunks = [], stream = null, langMode = "auto", busy = false, apId = null, apStrong = false, hideTimer = null;

  // ---- click-through: only her, the bubble, dock and panel catch the mouse ----
  document.addEventListener("mouseover", (e) => { if (e.target.closest(".hit")) api.interactive(true); });
  document.addEventListener("mouseout", (e) => { if (e.target.closest(".hit") && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".hit"))) api.interactive(false); });

  function setState(s) { document.body.dataset.state = s; }
  function bubble(text, meta, keep) {
    $("bubbleText").textContent = text; $("meta").textContent = meta || "";
    $("bubble").classList.add("show"); clearTimeout(hideTimer);
    if (!keep) hideTimer = setTimeout(() => { if ($("approval").hidden) $("bubble").classList.remove("show"); }, Math.max(9000, text.length * 90));
  }

  // ---- speech out (English-India voice; replies are English/Tanglish) ----
  function speak(text) {
    if (!S || !S.speak || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>~]/g, ""));
    const vs = speechSynthesis.getVoices();
    const v = vs.find((x) => /en-IN/i.test(x.lang)) || vs.find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v; u.lang = "en-IN";
    u.onstart = () => setState("speaking"); u.onend = u.onerror = () => { if (!busy) setState("idle"); };
    speechSynthesis.speak(u);
  }

  // ---- chat ----
  async function ask(text) {
    text = text.trim(); if (!text || busy) return;
    busy = true; $("input").value = ""; speechSynthesis.cancel();
    setState("thinking"); bubble("...", "", true);
    const r = await api.send(text);
    busy = false; setState("idle");
    const brainName = r.brain === "groq" ? "online brain (Groq)" : r.brain === "ollama" ? "local brain (Ollama)" : "";
    bubble(r.text, [brainName, r.note].filter(Boolean).join(" | "));
    if (!r.error) speak(r.text);
    refresh();
  }

  // ---- approvals ----
  api.onApproval((req) => {
    apId = req.id; apStrong = req.kind === "strong";
    $("apSummary").textContent = (apStrong ? "STRONG APPROVAL: " : "Approve? ") + req.summary;
    $("apStrong").hidden = !apStrong; $("apInput").value = ""; $("apYes").textContent = apStrong ? "Confirm" : "Approve";
    $("approval").hidden = false; bubble($("bubbleText").textContent || "I need your OK for this.", "", true);
    $("bubble").classList.add("show"); api.interactive(true);
  });
  function answer(yes) {
    if (apId == null) return;
    api.answerApproval(apId, apStrong ? (yes ? $("apInput").value : false) : yes);
    apId = null; $("approval").hidden = true; setState("thinking");
  }
  $("apYes").onclick = () => answer(true); $("apNo").onclick = () => answer(false);
  $("apInput").addEventListener("keydown", (e) => { if (e.key === "Enter") answer(true); });
  api.onSay((t) => { bubble(t); speak(t); });
  api.onNotice((n) => { if (n.type === "state") refresh(); if (n.type === "fallback") bubble(n.message, "", false); });
  api.onHotkey((h) => { if (h === "talk") toggleMic(); });

  // ---- microphone: record, then Groq Whisper turns it into text ----
  async function toggleMic() {
    if (recorder && recorder.state === "recording") { recorder.stop(); return; }
    if (busy) return;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { bubble("I cannot use the microphone. Allow it in Windows privacy settings, or type.", ""); return; }
    chunks = []; recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop()); $("mic").classList.remove("on"); setState("thinking");
      const blob = new Blob(chunks, { type: recorder.mimeType });
      if (blob.size < 2000) { setState("idle"); bubble("I did not hear anything.", ""); return; }
      const r = await api.transcribe(await blob.arrayBuffer(), blob.type, langMode === "auto" ? "" : langMode);
      if (r.error) { setState("idle"); bubble(r.error, ""); return; }
      if (!r.text) { setState("idle"); bubble("I could not catch that. Try again.", ""); return; }
      bubble("You: " + r.text, "", true); ask(r.text);
    };
    recorder.start(); $("mic").classList.add("on"); setState("listening"); bubble("Listening... tap MIC again when done.", "", true);
    setTimeout(() => recorder && recorder.state === "recording" && recorder.stop(), 25000);
  }
  $("mic").onclick = toggleMic;
  $("lang").onclick = () => { langMode = { auto: "en", en: "ta", ta: "auto" }[langMode]; $("lang").textContent = langMode; };
  $("send").onclick = () => ask($("input").value);
  $("input").addEventListener("keydown", (e) => { if (e.key === "Enter") ask($("input").value); });

  // ---- settings panel ----
  async function refresh() {
    S = await api.getState();
    $("keyState").textContent = S.hasKey ? "saved" : "none"; $("keyState").className = S.hasKey ? "ok" : "bad";
    $("privateOn").checked = S.private; $("pausedOn").checked = S.paused; $("speakOn").checked = S.speak;
    const pct = Math.min(100, Math.round((S.tokens / S.tokenLimit) * 100));
    $("meterFill").style.width = pct + "%";
    $("meterText").textContent = `Online tokens today: ${S.tokens.toLocaleString()} of about ${S.tokenLimit.toLocaleString()} (check your Groq Limits page). ` +
      (S.private ? "PRIVATE MODE: everything stays on this laptop. " : "") + (S.paused ? "PAUSED: no actions will run. " : "") +
      (S.encryption ? "" : "Key encryption unavailable: the key is kept in memory only.");
    $("folders").textContent = S.allowedFolders.join("\n") || "none yet. She will ask before opening any folder.";
    const f = $("facts"); f.innerHTML = "";
    if (!S.facts.length) f.innerHTML = '<div class="small">Nothing remembered yet. Say "remember that ..."</div>';
    for (const x of S.facts) {
      const d = document.createElement("div"); d.className = "fact";
      const t = document.createElement("span"); t.textContent = x.text;
      const b = document.createElement("button"); b.textContent = "X"; b.onclick = async () => { await api.forgetFact(x.id); refresh(); };
      d.append(t, b); f.appendChild(d);
    }
  }
  $("gear").onclick = () => { $("panel").hidden = !$("panel").hidden; refresh(); };
  $("closePanel").onclick = () => ($("panel").hidden = true);
  $("keySave").onclick = async () => {
    const r = await api.saveKey($("keyInput").value); $("keyInput").value = "";
    bubble(r.error ? r.error : r.stored === "encrypted" ? "Key saved, encrypted for your Windows account." : "Key kept for this session only (encryption unavailable).", "");
    refresh();
  };
  $("keyDel").onclick = async () => { await api.removeKey(); refresh(); };
  $("privateOn").onchange = async (e) => { await api.setSettings({ private: e.target.checked }); refresh(); };
  $("pausedOn").onchange = async (e) => { await api.setSettings({ paused: e.target.checked }); refresh(); };
  $("speakOn").onchange = async (e) => { await api.setSettings({ speak: e.target.checked }); refresh(); };
  $("addFolder").onclick = async () => { await api.addFolder(); refresh(); };
  $("clearChat").onclick = async () => { await api.clearChat(); bubble("Chat cleared. I still remember your facts.", ""); refresh(); };

  speechSynthesis.getVoices();
  refresh().then(() => bubble(S.hasKey ? "Hi, I'm Nexus. Talk to me or type." : "Hi, I'm Nexus. Open SET and paste your Groq key for the online brain, or just chat with the local one.", "", false));
})();

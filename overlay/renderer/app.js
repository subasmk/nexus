(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const api = window.nexus;
  let S = null, recorder = null, chunks = [], stream = null, langMode = "auto", busy = false, apId = null, apStrong = false, hideTimer = null, speakEnded = 0;

  // ---- click-through: only her, the bubble, dock and panel catch the mouse ----
  document.addEventListener("mouseover", (e) => { if (e.target.closest(".hit")) api.interactive(true); });
  document.addEventListener("mouseout", (e) => { if (e.target.closest(".hit") && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".hit"))) api.interactive(false); });

  function setState(s) { document.body.dataset.state = s; }
  function bubble(text, meta, keep) {
    $("bubbleText").textContent = text; $("meta").textContent = meta || "";
    $("bubble").classList.add("show"); clearTimeout(hideTimer);
    if (!keep) hideTimer = setTimeout(() => { if ($("approval").hidden) $("bubble").classList.remove("show"); }, Math.max(9000, text.length * 90));
  }

  // ---- speech out: male voice by default, he can pick another in SET ----
  const MALE = /ravi|prabhat|hemant|david|mark|guy|george|ryan|james|richard|brian|christopher|eric|roger|andrew|davis|jason|tony|sean|male/i;
  const FEMALE = /zira|heera|neerja|hazel|susan|aria|jenny|catherine|linda|female/i;
  function pickVoice() {
    const vs = speechSynthesis.getVoices();
    if (S && S.voiceName) { const v = vs.find((x) => x.name === S.voiceName); if (v) return v; }
    const en = vs.filter((x) => /^en/i.test(x.lang));
    const male = en.filter((x) => MALE.test(x.name) && !FEMALE.test(x.name));
    return male.find((x) => /en-IN/i.test(x.lang)) || male[0] || en.find((x) => /en-IN/i.test(x.lang)) || en[0] || null;
  }
  function fillVoices() {
    const sel = $("voiceSel"), vs = speechSynthesis.getVoices().filter((x) => /^en/i.test(x.lang));
    sel.innerHTML = ""; const auto = document.createElement("option"); auto.value = ""; auto.textContent = "Auto (male if found)"; sel.appendChild(auto);
    for (const v of vs) { const o = document.createElement("option"); o.value = v.name; o.textContent = v.name.replace(/^Microsoft /, "") + " (" + v.lang + ")"; sel.appendChild(o); }
    sel.value = S && S.voiceName && vs.some((x) => x.name === S.voiceName) ? S.voiceName : "";
  }
  function speak(text) {
    if (!S || !S.speak || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>~]/g, ""));
    const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-IN";
    u.onstart = () => setState("speaking"); u.onend = u.onerror = () => { if (!busy) setState("idle"); speakEnded = Date.now(); };
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
  api.onHotkey((h) => { if (h === "talk") { if (hf.on) bubble("Hands-free is on. Just talk.", ""); else toggleMic(); } });

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
  // ---- hands-free: mic stays open only while the red bar is showing ----
  // Audio is cut into speech segments locally. A segment is sent to Groq Whisper only after
  // speech was detected. With the wake word on, a segment without "Nexus" is thrown away after
  // that check. MIC OFF (or Ctrl+Shift+M) closes the microphone completely.
  const WAKE = /\b(nexus|nexis|nexes|nexas|next us|nex us|nexxus)\b[\s,.!?:-]*/i;
  let hf = { on: false, stream: null, ctx: null, timer: null, rec: null, chunks: [], speechMs: 0, silenceMs: 0, segMs: 0, floor: 0.01, followUntil: 0, hearing: false };
  function bar(text, muted) {
    $("listenBar").hidden = false; $("listenBar").classList.toggle("muted", !!muted); $("listenText").textContent = text;
    $("listenOff").textContent = muted ? "TURN ON" : "MIC OFF"; $("listenOff").dataset.muted = muted ? "1" : "";
  }
  function hfBlocked() { return !S ? "starting" : S.private ? "Private mode: voice-to-text is online, so hands-free is off" : S.paused ? "Paused: hands-free is off" : !S.hasKey ? "Add a Groq key in SET to use hands-free" : ""; }
  async function hfStop() {
    clearInterval(hf.timer); hf.timer = null;
    try { if (hf.rec && hf.rec.state === "recording") { hf.rec.onstop = null; hf.rec.stop(); } } catch {}
    hf.rec = null; hf.chunks = [];
    if (hf.stream) hf.stream.getTracks().forEach((t) => t.stop()); hf.stream = null;
    if (hf.ctx) { try { await hf.ctx.close(); } catch {} } hf.ctx = null; hf.on = false;
    if (document.body.dataset.state === "listening") setState("idle");
  }
  async function hfStart() {
    if (hf.on) return;
    try { hf.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { await api.setSettings({ handsFree: false }); bubble("I cannot use the microphone. Allow it in Windows privacy settings.", ""); await refresh(); return; }
    hf.ctx = new AudioContext(); const an = hf.ctx.createAnalyser(); an.fftSize = 1024;
    hf.ctx.createMediaStreamSource(hf.stream).connect(an); const buf = new Float32Array(an.fftSize);
    hf.on = true; hf.speechMs = hf.silenceMs = hf.segMs = 0; hf.floor = 0.01; const TICK = 50;
    hf.timer = setInterval(() => {
      if (!hf.on) return;
      const talking = busy || (window.speechSynthesis && speechSynthesis.speaking) || Date.now() - speakEnded < 700 || !$("approval").hidden;
      an.getFloatTimeDomainData(buf); let sum = 0; for (const v of buf) sum += v * v; const rms = Math.sqrt(sum / buf.length);
      const thr = Math.max(0.02, hf.floor * 3.5);
      if (talking) { if (hf.rec) hfDrop(); return; }
      if (rms < thr) hf.floor = hf.floor * 0.97 + rms * 0.03;
      if (!hf.rec) {
        hf.speechMs = rms > thr ? hf.speechMs + TICK : 0;
        if (hf.speechMs >= 100) hfBegin();
        return;
      }
      hf.segMs += TICK; hf.silenceMs = rms > thr ? 0 : hf.silenceMs + TICK; if (rms > thr) hf.heard = (hf.heard || 0) + TICK;
      if (hf.silenceMs >= 1000 || hf.segMs >= 20000) hfEnd();
    }, TICK);
  }
  function hfBegin() {
    hf.silenceMs = 0; hf.segMs = 0; hf.heard = 0;
    const parts = []; hf.rec = new MediaRecorder(hf.stream); const rec = hf.rec;
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => hfSend(rec, parts);
    rec.start(); hf.hearing = true; bar("LISTENING... (hearing you)", false); $("listenBar").classList.add("hear"); setState("listening");
  }
  function hfDrop() { const r = hf.rec; hf.rec = null; if (r) { r.onstop = null; try { r.stop(); } catch {} } hf.chunks = []; hfIdle(); }
  function hfEnd() { const r = hf.rec; hf.rec = null; if (r && r.state === "recording") r.stop(); hfIdle(); }
  function hfIdle() { hf.hearing = false; $("listenBar").classList.remove("hear"); if (hf.on) { setState("idle"); bar(S && S.wakeWord ? 'LISTENING - say "Nexus ..." (mic is ON)' : "LISTENING - just talk (mic is ON)", false); } }
  async function hfSend(rec, parts) {
    const blob = new Blob(parts, { type: rec.mimeType });
    if (!hf.on || blob.size < 4000 || (hf.heard || 0) < 300) return;      // too short or just noise: never uploaded
    const r = await api.transcribe(await blob.arrayBuffer(), blob.type, langMode === "auto" ? "" : langMode);
    if (r.error) { bubble(r.error, ""); return; }
    let text = (r.text || "").trim(); if (text.length < 2 || /^(thank you\.?|thanks\.?|you\.?)$/i.test(text)) return; // Whisper's usual silence guesses
    if (S.wakeWord && Date.now() > hf.followUntil) {
      const m = text.match(WAKE); if (!m || m.index > 25) return;          // not for me: thrown away
      text = text.slice(m.index + m[0].length).trim();
      if (!text) { bubble("Yes? I'm listening.", ""); hf.followUntil = Date.now() + 10000; return; }
    }
    hf.followUntil = Date.now() + 10000;                                    // follow-up without saying Nexus again
    bubble("You: " + text, "", true); ask(text);
  }
  function applyHandsFree() {
    $("handsFreeOn").checked = !!(S && S.handsFree); $("wakeOn").checked = !!(S && S.wakeWord);
    const why = S && S.handsFree ? hfBlocked() : "";
    if (!S || !S.handsFree) { hfStop(); $("listenBar").hidden = true; return; }
    if (why) { hfStop(); bar(why, true); $("listenOff").textContent = "TURN OFF"; return; }
    if (!hf.on) hfStart().then(() => hf.on && hfIdle());
    else hfIdle();
  }
  $("listenOff").onclick = async () => { await api.setSettings({ handsFree: false }); await refresh(); bubble("Mic is off. I am not listening.", ""); };
  $("handsFreeOn").onchange = async (e) => { await api.setSettings({ handsFree: e.target.checked }); await refresh(); };
  $("wakeOn").onchange = async (e) => { await api.setSettings({ wakeWord: e.target.checked }); await refresh(); };
  $("mic").onclick = () => { if (hf.on) bubble("Hands-free is on. Just talk" + (S.wakeWord ? ' and start with "Nexus".' : "."), ""); else toggleMic(); };
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
    fillVoices(); applyHandsFree();
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

  speechSynthesis.onvoiceschanged = fillVoices;
  $("voiceSel").onchange = async (e) => { await api.setSettings({ voiceName: e.target.value }); await refresh(); speak("Hi, I am Nexus."); };
  $("voiceTest").onclick = () => speak("Hi, I am Nexus. This is how I sound.");
  refresh().then(() => bubble(S.hasKey ? "Hi, I'm Nexus. Talk to me or type." : "Hi, I'm Nexus. Open SET and paste your Groq key for the online brain, or just chat with the local one.", "", false));
})();

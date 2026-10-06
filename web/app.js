(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const hud = $("hud"), logEl = $("log"), input = $("input"), bubbleText = $("bubbleText"),
        liveEl = $("live"), micBtn = $("mic"), modelSel = $("model"), hintEl = $("hint"),
        stateTag = $("stateTag"), sendBtn = $("send"), stopBtn = $("stop");

  const SYSTEM = [
    "You are Nexus, a friendly study buddy for an Indian college student.",
    "Reply in the same language the user used: Tamil script for Tamil, English for English. If they mix, mix naturally.",
    "Your answers are spoken aloud, so keep them short (2 to 4 sentences), simple and warm.",
    "No markdown, no bullet symbols, no emojis. If you are not sure, say so instead of guessing."
  ].join(" ");

  let messages = JSON.parse(localStorage.getItem("nexus.messages") || "[]");
  let micLang = localStorage.getItem("nexus.micLang") || "en-IN";
  let speakOn = localStorage.getItem("nexus.speak") !== "0";
  let busy = false, abortCtl = null, recog = null, listening = false;
  let audioCtx = null, analyser = null, micStream = null, speaking = false, tamilVoice = null;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // ---------- state + UI ----------
  function setState(s) {
    hud.dataset.state = s;
    stateTag.textContent = s.toUpperCase();
  }
  function save() { localStorage.setItem("nexus.messages", JSON.stringify(messages.slice(-60))); }
  function render() {
    logEl.innerHTML = "";
    if (!messages.length) {
      const e = document.createElement("div"); e.className = "empty";
      e.textContent = "NO CONVERSATION YET\nask anything in Tamil or English"; e.style.whiteSpace = "pre";
      logEl.appendChild(e); return;
    }
    for (const m of messages) addBubble(m.role, m.content, m.err);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function addBubble(role, text, err) {
    const d = document.createElement("div");
    d.className = "msg " + (role === "user" ? "u" : "a") + (err ? " err" : "");
    d.textContent = text; logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight; return d;
  }

  // ---------- Ollama ----------
  async function refreshModels() {
    let data;
    try { data = await (await fetch("/api/models")).json(); } catch { data = { ok: false, models: [] }; }
    const st = $("stOllama");
    if (data.ok) { st.textContent = "online"; st.className = "ok"; } else { st.textContent = "offline"; st.className = "bad"; }
    const prev = modelSel.value || localStorage.getItem("nexus.model") || "";
    if (data.models.join() !== [...modelSel.options].map(o => o.value).join()) {
      modelSel.innerHTML = "";
      for (const n of data.models) { const o = document.createElement("option"); o.value = o.textContent = n; modelSel.appendChild(o); }
      const pick = data.models.includes(prev) ? prev : (data.models.find(n => n.startsWith("gemma3")) || data.models[0] || "");
      if (pick) modelSel.value = pick;
    }
    if (!data.ok) hintEl.textContent = "Ollama is not running. Open the Ollama app, then this page reconnects by itself.";
    else if (!data.models.length) hintEl.textContent = "No model yet. In a terminal run:  ollama pull gemma3";
    else hintEl.textContent = "";
  }
  modelSel.addEventListener("change", () => localStorage.setItem("nexus.model", modelSel.value));

  const isTamil = (t) => (t.match(/[\u0B80-\u0BFF]/g) || []).length > Math.max(2, t.length * 0.2);

  async function ask(text) {
    text = text.trim();
    if (!text || busy) return;
    stopSpeaking();
    if (listening) stopListening();
    busy = true; sendBtn.hidden = true; stopBtn.hidden = false;
    messages.push({ role: "user", content: text });
    render(); input.value = "";
    setState("thinking"); bubbleText.textContent = "...";
    const live = addBubble("assistant", "");
    let full = "", spokenUpTo = 0;
    abortCtl = new AbortController();
    try {
      const model = modelSel.value;
      if (!model) throw new Error("No model selected. Is Ollama running and a model pulled?");
      const body = {
        model, keep_alive: "10m", options: { temperature: 0.7, num_ctx: 4096 },
        messages: [{ role: "system", content: SYSTEM }, ...messages.slice(-12).map(({ role, content }) => ({ role, content }))]
      };
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: abortCtl.signal });
      if (!res.ok) { let e = ""; try { e = (await res.json()).error; } catch {} throw new Error(e || ("Server error " + res.status)); }
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
          let j; try { j = JSON.parse(line); } catch { continue; }
          if (j.error) throw new Error(j.error);
          if (j.message && j.message.content) {
            full += j.message.content; live.textContent = full; bubbleText.textContent = full; logEl.scrollTop = logEl.scrollHeight;
            if (hud.dataset.state === "thinking") setState("speaking");
            if (speakOn) spokenUpTo = speakReady(full, spokenUpTo, false);
          }
        }
      }
      if (speakOn) speakReady(full, spokenUpTo, true);
      messages.push({ role: "assistant", content: full.trim() || "(empty reply)" });
    } catch (e) {
      if (e.name === "AbortError") { if (full.trim()) messages.push({ role: "assistant", content: full.trim() }); }
      else {
        const msg = /Failed to fetch|NetworkError/.test(e.message) ? "Cannot reach the Nexus server. Is the black window still open?" : e.message;
        messages.push({ role: "assistant", content: msg, err: true }); bubbleText.textContent = msg;
      }
    } finally {
      busy = false; abortCtl = null; sendBtn.hidden = false; stopBtn.hidden = true;
      save(); render();
      if (!speaking) setState("idle");
    }
  }

  // ---------- speech out ----------
  function clean(t) { return t.replace(/[*_`#>~]/g, "").replace(/\s+/g, " ").trim(); }
  function pickVoice(text) {
    const vs = speechSynthesis.getVoices();
    if (isTamil(text)) return vs.find(v => /^ta/i.test(v.lang)) || null;
    return vs.find(v => /en-IN/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
  }
  // speak whole sentences as they arrive; returns how much of the text is already queued
  function speakReady(text, from, final) {
    const rest = text.slice(from);
    const re = /[^.!?।\n]+[.!?।\n]+/g; let m, end = 0, parts = [];
    while ((m = re.exec(rest))) { parts.push(m[0]); end = re.lastIndex; }
    if (final && rest.slice(end).trim()) { parts.push(rest.slice(end)); end = rest.length; }
    for (const p of parts) enqueue(clean(p));
    return from + end;
  }
  function enqueue(s) {
    if (!s) return;
    const u = new SpeechSynthesisUtterance(s);
    const v = pickVoice(s);
    if (isTamil(s)) { u.lang = "ta-IN"; if (!v) { noTamilVoice(); return; } } else u.lang = "en-IN";
    if (v) u.voice = v;
    u.onstart = () => { speaking = true; setState("speaking"); };
    u.onend = () => { if (!speechSynthesis.speaking && !speechSynthesis.pending) { speaking = false; if (!busy) setState("idle"); } };
    u.onerror = u.onend;
    speechSynthesis.speak(u);
  }
  function stopSpeaking() { speechSynthesis.cancel(); speaking = false; }
  function noTamilVoice() {
    hintEl.textContent = "No Tamil voice installed, so I can type Tamil but not speak it. Windows: Settings > Time & language > Speech > Add voices > Tamil.";
  }
  function refreshVoices() {
    tamilVoice = speechSynthesis.getVoices().find(v => /^ta/i.test(v.lang)) || null;
    const st = $("stTamil");
    st.textContent = tamilVoice ? "found" : "missing"; st.className = tamilVoice ? "ok" : "bad";
  }
  speechSynthesis.onvoiceschanged = refreshVoices; refreshVoices();
  setTimeout(refreshVoices, 1200);

  // ---------- speech in + waveform ----------
  const canvas = $("wave"), g = canvas.getContext("2d");
  let t0 = 0;
  function drawWave(ts) {
    const w = canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1), h = canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);
    g.clearRect(0, 0, w, h);
    const bars = Math.floor(w / 8); let data = null;
    if (listening && analyser) { data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data); }
    for (let i = 0; i < bars; i++) {
      let a;
      if (data) a = data[Math.floor(i / bars * data.length * 0.6)] / 255;
      else if (speaking || hud.dataset.state === "thinking") a = 0.15 + 0.45 * Math.abs(Math.sin(ts / 180 + i * 0.5) * Math.sin(ts / 700 + i * 0.13));
      else a = 0.04 + 0.03 * Math.sin(ts / 600 + i * 0.4);
      const bh = Math.max(2, a * h * 0.9);
      g.fillStyle = listening ? "#ff2d3d" : "#c6ff1a"; g.fillRect(i * 8 + 2, (h - bh) / 2, 4, bh);
    }
    requestAnimationFrame(drawWave);
  }
  requestAnimationFrame(drawWave);

  async function startMeter() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser(); analyser.fftSize = 256; src.connect(analyser);
    } catch { /* recognition can still work without the meter */ }
  }
  function stopMeter() { if (micStream) micStream.getTracks().forEach(t => t.stop()); micStream = null; analyser = null; }

  function startListening() {
    if (!SR) { hintEl.textContent = "This browser has no speech recognition. Use Chrome or Edge, or type."; return; }
    if (busy) return;
    stopSpeaking();
    recog = new SR(); recog.lang = micLang; recog.interimResults = true; recog.continuous = false;
    let finalText = "";
    recog.onstart = () => { listening = true; micBtn.classList.add("on"); setState("listening"); liveEl.textContent = "Listening (" + (micLang === "ta-IN" ? "தமிழ்" : "English") + ")..."; };
    recog.onresult = (e) => {
      let interim = ""; finalText = "";
      for (const r of e.results) (r.isFinal ? (finalText += r[0].transcript) : (interim += r[0].transcript));
      liveEl.textContent = finalText + interim;
    };
    recog.onerror = (e) => {
      const map = { "not-allowed": "Mic blocked. Click the lock icon in the address bar and allow the microphone.", "no-speech": "Did not hear anything. Try again.", "network": "Speech recognition needs internet in Chrome/Edge.", "language-not-supported": "This language is not supported for voice input here." };
      liveEl.textContent = map[e.error] || ("Mic error: " + e.error);
    };
    recog.onend = () => {
      listening = false; micBtn.classList.remove("on"); stopMeter();
      if (hud.dataset.state === "listening") setState("idle");
      if (finalText.trim()) { liveEl.textContent = finalText; ask(finalText); }
    };
    startMeter(); try { recog.start(); } catch {}
  }
  function stopListening() { if (recog) try { recog.stop(); } catch {} }

  // ---------- wiring ----------
  micBtn.addEventListener("click", () => (listening ? stopListening() : startListening()));
  $("form").addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });
  stopBtn.addEventListener("click", () => { if (abortCtl) abortCtl.abort(); stopSpeaking(); });
  $("clear").addEventListener("click", () => { messages = []; save(); render(); bubbleText.textContent = "Fresh start. What are we studying?"; });
  document.querySelectorAll(".chips button").forEach(b => b.addEventListener("click", () => { input.value = b.dataset.p; input.focus(); }));
  document.querySelectorAll("#langSeg button").forEach(b => {
    b.classList.toggle("on", b.dataset.l === micLang);
    b.addEventListener("click", () => { micLang = b.dataset.l; localStorage.setItem("nexus.micLang", micLang);
      document.querySelectorAll("#langSeg button").forEach(x => x.classList.toggle("on", x === b)); });
  });
  $("speakOn").checked = speakOn;
  $("speakOn").addEventListener("change", (e) => { speakOn = e.target.checked; localStorage.setItem("nexus.speak", speakOn ? "1" : "0"); if (!speakOn) stopSpeaking(); });

  render(); refreshModels(); setInterval(refreshModels, 5000);
  window.__nexus = { ask }; // used by the automated UI test
})();

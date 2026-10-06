# Nexus overlay (slice 1)

Anime-girl desktop assistant that floats on top of your screen. Voice, English + Tanglish, memory, 3-level permissions, Groq brain with local Ollama fallback, Private mode.

## Run on Windows (plain steps)
1. Install Node.js LTS from https://nodejs.org (click next, next, finish). Restart the terminal after.
2. Download this repo (green Code button, Download ZIP, or git clone), open the `overlay` folder.
3. In that folder open Terminal (right click, Open in Terminal) and run:
   - `npm install`  (takes a few minutes, downloads Electron)
   - `npm start`
4. Nexus appears at the bottom right. Click SET, paste your Groq key (from console.groq.com) and press Save. Never share the key in chat.
5. Talk: Ctrl+Shift+Space, or the MIC button. Pause all actions: Ctrl+Shift+P. Tray icon: show/hide/quit.
   - Hands-free: SET > turn on "Hands-free listening". A red bar says LISTENING while the mic is open. Say "Nexus, ..." and ask. MIC OFF on the bar (or Ctrl+Shift+M) closes the mic fully.
   - Voice: SET > Voice. Default picks a male voice if Windows has one (Ravi, David, Mark). Pick another and press Test. Missing voices: Windows Settings > Time & language > Speech > Add voices.
6. Optional offline brain: install Ollama, run `ollama pull gemma3`. Used when there is no key, the daily limit is near, or Private mode is on.

## Hands-free privacy
- Off by default. Only runs after you turn it on, and only with a Groq key, not in Private mode, not while paused.
- Audio is cut into speech pieces on your laptop. A piece is sent to Groq Whisper only after speech was detected. With "only after I say Nexus" on, a piece without the word is thrown away after that check (so room speech does reach Groq for the check). Nothing is saved.
- Uses your Groq audio limit (about 2,000 requests/day, 28,800 seconds/day per their page for Developer plan). Wake-word mode still sends every piece of speech for the check.
- Quiet fan noise can trigger it; talking near the mic is best.

## Permissions
- Auto: remember, list memory, reminders, open normal links, list folders you allowed.
- Asks you (Approve button): open files, read files, write notes, forget memory, login/payment-looking links.
- Strong: anything like submit/send/pay needs you to type `yes submit`. Not shipped in slice 1; the gate is tested.
- The model only proposes. The permission engine decides. Pause blocks everything. Actions are logged to actions.log.

## Tests
`npm test` (16 tests, mock servers, no key needed).

## Not verified yet (could not test from the build machine)
Hands-free on real Windows mics (tested only with a fake audio file), male voice names on his Windows (Linux test machine has no voices), Real Groq calls, real Ollama/gemma3 tool use and speed, Tamil/Tanglish speech quality, mic in Electron on Windows, click-through and dragging on Windows, transparent window on your GPU, always-on-top over fullscreen games, tray icon, Windows install steps. Key encryption uses Windows DPAPI via Electron safeStorage; tested only with the fallback path.

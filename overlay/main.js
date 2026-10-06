const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, shell, safeStorage, dialog, nativeImage, Notification, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const { createSettings } = require("./src/settings");
const { createMemory } = require("./src/memory");
const { createEngine } = require("./src/perm");
const { buildTools } = require("./src/tools");
const { createBrain } = require("./src/brain");

if (process.env.NEXUS_USERDATA) app.setPath("userData", process.env.NEXUS_USERDATA);
if (process.env.NEXUS_NO_SANDBOX) app.commandLine.appendSwitch("no-sandbox");
if (!app.requestSingleInstanceLock()) app.quit();

let win, tray, settings, memory, engine, brain;
const pending = new Map();
let seq = 0;

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

function ask(req) { // ask the user in the overlay; resolves with true/false or typed text
  return new Promise((resolve) => {
    const id = ++seq; pending.set(id, resolve);
    if (win && !win.isVisible()) win.show();
    send("approval:request", { id, ...req });
  });
}
ipcMain.on("approval:answer", (_e, id, answer) => { const r = pending.get(id); if (r) { pending.delete(id); r(answer); } });

function logAction(entry) {
  try {
    const f = path.join(app.getPath("userData"), "actions.log");
    fs.appendFileSync(f, JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
}

function remind(minutes, text) {
  setTimeout(() => {
    send("say", "Reminder: " + text);
    try { new Notification({ title: "Nexus reminder", body: text }).show(); } catch {}
  }, minutes * 60 * 1000);
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 470, H = 740;
  win = new BrowserWindow({
    width: W, height: H, x: wa.x + wa.width - W - 8, y: wa.y + wa.height - H,
    transparent: true, frame: false, resizable: false, hasShadow: false, skipTaskbar: true,
    alwaysOnTop: true, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true, { forward: true }); // click-through until the mouse is over her
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => win.show());
}
ipcMain.on("ui:interactive", (_e, v) => {
  if (!win) return;
  if (v) win.setIgnoreMouseEvents(false); else win.setIgnoreMouseEvents(true, { forward: true });
});

function state() {
  const s = settings.get();
  return {
    private: s.private, paused: s.paused, speak: s.speak, voiceName: s.voiceName, handsFree: s.handsFree, wakeWord: s.wakeWord, groqModel: s.groqModel, ollamaModel: s.ollamaModel,
    allowedFolders: s.allowedFolders, hasKey: settings.hasKey(),
    tokens: settings.tokensToday(), tokenLimit: s.tokenLimitPerDay,
    facts: memory.facts(), history: memory.history().slice(-20),
    encryption: safeStorage.isEncryptionAvailable()
  };
}

app.whenReady().then(() => {
  const dir = app.getPath("userData");
  settings = createSettings(dir, safeStorage);
  memory = createMemory(dir);
  const tools = buildTools({ memory, settings, shell, notesDir: path.join(app.getPath("documents"), "Nexus notes"), remind });
  engine = createEngine({ tools, ask, log: logAction, isPaused: () => settings.get().paused });
  brain = createBrain({ settings, memory, tools, engine, notify: (e) => send("notice", e) });

  ipcMain.handle("state:get", () => state());
  ipcMain.handle("chat:send", async (_e, text) => {
    try { return await brain.chat(String(text).slice(0, 2000)); }
    catch (e) { return { text: "I could not answer: " + e.message, brain: "none", error: true }; }
  });
  ipcMain.handle("stt:transcribe", async (_e, buf, mime, lang) => {
    try { return { text: await brain.transcribe(Buffer.from(buf), mime, lang) }; } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle("settings:set", (_e, p) => { settings.set(p); return state(); });
  ipcMain.handle("key:save", (_e, k) => { try { const r = settings.saveKey(k); return { ...r, state: state() }; } catch (e) { return { error: e.message }; } });
  ipcMain.handle("key:remove", () => { settings.removeKey(); return state(); });
  ipcMain.handle("folder:add", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (!r.canceled && r.filePaths[0]) { const s = settings.get(); settings.set({ allowedFolders: [...new Set([...s.allowedFolders, r.filePaths[0]])] }); }
    return state();
  });
  ipcMain.handle("memory:forget", (_e, id) => { memory.forget(id); return state(); });
  ipcMain.handle("chat:clear", () => { memory.clearHistory(); return state(); });

  createWindow();

  const img = nativeImage.createFromPath(path.join(__dirname, "renderer", "assets", "nexus.png")).resize({ width: 24, height: 32 });
  tray = new Tray(img);
  const rebuild = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: win.isVisible() ? "Hide Nexus" : "Show Nexus", click: () => { win.isVisible() ? win.hide() : win.show(); rebuild(); } },
    { label: "Talk (Ctrl+Shift+Space)", click: () => { win.show(); send("hotkey", "talk"); } },
    { label: "Private mode (local only)", type: "checkbox", checked: settings.get().private, click: (i) => { settings.set({ private: i.checked }); send("notice", { type: "state" }); } },
    { label: "Hands-free listening (Ctrl+Shift+M)", type: "checkbox", checked: settings.get().handsFree, click: (i) => { settings.set({ handsFree: i.checked }); send("notice", { type: "state" }); } },
    { label: "Pause all actions (Ctrl+Shift+P)", type: "checkbox", checked: settings.get().paused, click: (i) => { settings.set({ paused: i.checked }); send("notice", { type: "state" }); } },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]));
  tray.setToolTip("Nexus"); rebuild(); tray.on("click", () => { win.isVisible() ? win.hide() : win.show(); rebuild(); });

  globalShortcut.register("Control+Shift+Space", () => { win.show(); send("hotkey", "talk"); });
  globalShortcut.register("Control+Shift+M", () => { settings.set({ handsFree: !settings.get().handsFree }); send("notice", { type: "state" }); rebuild(); });
  globalShortcut.register("Control+Shift+P", () => { settings.set({ paused: !settings.get().paused }); send("notice", { type: "state" }); rebuild(); });
});
app.on("window-all-closed", (e) => e.preventDefault());
app.on("will-quit", () => globalShortcut.unregisterAll());

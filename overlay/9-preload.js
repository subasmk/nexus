const { contextBridge, ipcRenderer } = require("electron");
const on = (ch, fn) => ipcRenderer.on(ch, (_e, d) => fn(d));
contextBridge.exposeInMainWorld("nexus", {
  interactive: (v) => ipcRenderer.send("ui:interactive", !!v),
  send: (text) => ipcRenderer.invoke("chat:send", text),
  transcribe: (buf, mime, lang) => ipcRenderer.invoke("stt:transcribe", buf, mime, lang),
  getState: () => ipcRenderer.invoke("state:get"),
  setSettings: (p) => ipcRenderer.invoke("settings:set", p),
  saveKey: (k) => ipcRenderer.invoke("key:save", k),
  removeKey: () => ipcRenderer.invoke("key:remove"),
  addFolder: () => ipcRenderer.invoke("folder:add"),
  forgetFact: (id) => ipcRenderer.invoke("memory:forget", id),
  clearChat: () => ipcRenderer.invoke("chat:clear"),
  answerApproval: (id, answer) => ipcRenderer.send("approval:answer", id, answer),
  onApproval: (fn) => on("approval:request", fn),
  onSay: (fn) => on("say", fn),
  onNotice: (fn) => on("notice", fn),
  onHotkey: (fn) => on("hotkey", fn)
});

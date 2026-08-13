const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  getInfo: () => ipcRenderer.invoke("desktop:get-info"),
  chooseWorkspace: () => ipcRenderer.invoke("desktop:choose-workspace"),
});

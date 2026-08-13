const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  getInfo: () => ipcRenderer.invoke("desktop:get-info"),
  chooseWorkspace: () => ipcRenderer.invoke("desktop:choose-workspace"),
  importMedia: () => ipcRenderer.invoke("desktop:import-media"),
  createCaptureWorkflow: (input) => ipcRenderer.invoke("desktop:create-capture-workflow", input),
  importTake: (shootTaskId) => ipcRenderer.invoke("desktop:import-take", shootTaskId),
  selectTake: (input) => ipcRenderer.invoke("desktop:select-take", input),
  openWorkspaceFile: (relativePath) => ipcRenderer.invoke("desktop:open-workspace-file", relativePath),
});

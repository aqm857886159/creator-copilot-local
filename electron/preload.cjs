const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  getInfo: () => ipcRenderer.invoke("desktop:get-info"),
  chooseWorkspace: () => ipcRenderer.invoke("desktop:choose-workspace"),
  importMedia: () => ipcRenderer.invoke("desktop:import-media"),
  searchAssets: (query) => ipcRenderer.invoke("desktop:search-assets", query),
  researchAccount: (input) => ipcRenderer.invoke("desktop:research-account", input),
  createCaptureWorkflow: (input) => ipcRenderer.invoke("desktop:create-capture-workflow", input),
  importTake: (shootTaskId) => ipcRenderer.invoke("desktop:import-take", shootTaskId),
  selectTake: (input) => ipcRenderer.invoke("desktop:select-take", input),
  proposeEdit: (projectId) => ipcRenderer.invoke("desktop:propose-edit", projectId),
  renderEdit: (input) => ipcRenderer.invoke("desktop:render-edit", input),
  openWorkspaceFile: (relativePath) => ipcRenderer.invoke("desktop:open-workspace-file", relativePath),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
});

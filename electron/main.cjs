const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");

const isDevelopment = !app.isPackaged && !process.argv.includes("--load-dist");

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#f4f0e8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (isDevelopment) {
    void window.loadURL("http://127.0.0.1:4316");
  } else {
    void window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("desktop:get-info", () => ({
  appVersion: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
}));

ipcMain.handle("desktop:choose-workspace", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "选择本地创作工作区",
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, path: null };
  }
  return { canceled: false, path: result.filePaths[0] };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

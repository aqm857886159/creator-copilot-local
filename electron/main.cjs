const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { createHash, randomUUID } = require("node:crypto");
const { mkdirSync, realpathSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const isDevelopment = !app.isPackaged && !process.argv.includes("--load-dist");
let selectedWorkspacePath = null;
let desktopRuntimePromise = null;
let catalog = null;
let workspaceId = null;

async function getDesktopRuntime() {
  if (!desktopRuntimePromise) {
    const runtimeRoot = path.join(__dirname, "..", "dist-electron", "packages");
    desktopRuntimePromise = Promise.all([
      import(pathToFileURL(path.join(runtimeRoot, "media", "src", "index.js")).href),
      import(pathToFileURL(path.join(runtimeRoot, "creation", "src", "index.js")).href),
      import(pathToFileURL(path.join(runtimeRoot, "exchange", "src", "index.js")).href),
      import(pathToFileURL(path.join(runtimeRoot, "storage", "src", "catalog.js")).href),
    ]).then(([media, creation, exchange, storage]) => ({ media, creation, exchange, storage, mediaImporter: new media.LocalMediaImporter() }));
  }
  return desktopRuntimePromise;
}

function workspaceIdForPath(workspacePath) {
  return `workspace-${createHash("sha256").update(workspacePath).digest("hex").slice(0, 20)}`;
}

async function initializeWorkspace(workspacePath) {
  const runtime = await getDesktopRuntime();
  const canonicalWorkspacePath = realpathSync(workspacePath);
  const metadataDirectory = path.join(canonicalWorkspacePath, ".creator-copilot");
  mkdirSync(metadataDirectory, { recursive: true });
  const nextCatalog = new runtime.storage.SqliteCatalog(path.join(metadataDirectory, "catalog.sqlite"));
  const nextWorkspaceId = workspaceIdForPath(canonicalWorkspacePath);
  try {
    if (!nextCatalog.getWorkspace(nextWorkspaceId)) {
      const now = new Date().toISOString();
      nextCatalog.createWorkspace({ id: nextWorkspaceId, name: path.basename(canonicalWorkspacePath), rootPath: canonicalWorkspacePath, schemaVersion: 1, defaultLocale: "zh-CN", createdAt: now, updatedAt: now });
    }
  } catch (error) {
    nextCatalog.close();
    throw error;
  }
  if (catalog) catalog.close();
  catalog = nextCatalog;
  workspaceId = nextWorkspaceId;
  selectedWorkspacePath = canonicalWorkspacePath;
  return canonicalWorkspacePath;
}

function requireWorkspace() {
  if (!selectedWorkspacePath || !catalog || !workspaceId) throw new Error("请先选择工作区");
  return { workspacePath: selectedWorkspacePath, catalog, workspaceId };
}

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
  const workspacePath = await initializeWorkspace(result.filePaths[0]);
  return { canceled: false, path: workspacePath };
});

ipcMain.handle("desktop:import-media", async () => {
  if (!selectedWorkspacePath) return { ok: false, errorCode: "workspace_not_selected", message: "请先选择工作区" };
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    title: "导入一段视频素材",
    filters: [{ name: "视频", extensions: ["mp4", "mov", "m4v", "webm", "mkv", "avi"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, errorCode: "cancelled", message: "已取消导入" };
  try {
    const runtime = await getDesktopRuntime();
    const imported = await runtime.mediaImporter.import({ workspaceRoot: selectedWorkspacePath, sourcePath: result.filePaths[0] });
    return {
      ok: true,
      sourceName: path.basename(result.filePaths[0]),
      durationMs: imported.probe.durationMs ?? null,
      streams: imported.probe.streams.map(({ kind, codec, width, height, frameRate, sampleRate, channels, rotation }) => ({ kind, codec, width, height, frameRate, sampleRate, channels, rotation })),
      artifacts: [imported.source, imported.proxy, imported.thumbnail],
    };
  } catch (error) {
    return { ok: false, errorCode: "media_import_failed", message: error instanceof Error ? error.message : "媒体导入失败" };
  }
});

ipcMain.handle("desktop:create-capture-workflow", async (_event, raw) => {
  try {
    const workspace = requireWorkspace();
    if (!raw || typeof raw.projectTitle !== "string" || !raw.projectTitle.trim()) throw new Error("项目标题不能为空");
    if (!Array.isArray(raw.blocks) || raw.blocks.length === 0 || raw.blocks.length > 30) throw new Error("脚本段落数量必须在 1–30 之间");
    if (!Array.isArray(raw.shots) || raw.shots.length === 0 || raw.shots.length > 60) throw new Error("分镜数量必须在 1–60 之间");
    const runtime = await getDesktopRuntime();
    const now = new Date().toISOString();
    const projectId = `project-${randomUUID()}`;
    const scriptId = `script-${randomUUID()}`;
    const storyboardId = `storyboard-${randomUUID()}`;
    const capturePackageId = `capture-${randomUUID()}`;
    const blocks = raw.blocks.map((block, index) => ({
      schemaVersion: 1,
      id: `${scriptId}-block-${String(index + 1).padStart(2, "0")}`,
      order: index,
      kind: block.kind,
      text: String(block.text ?? "").trim(),
      emphasis: [],
      evidenceIds: [],
      visualNeed: block.visualNeed,
    }));
    const estimatedDurationMs = blocks.reduce((total, block) => total + Math.max(1500, Math.round(block.text.length * 260)), 0);
    const script = runtime.creation.ScriptSchema.parse({ schemaVersion: 1, id: scriptId, projectId, revision: 1, status: "approved", blocks, estimatedDurationMs, createdAt: now, updatedAt: now });
    const shotDrafts = raw.shots.map((shot, index) => {
      const scriptBlock = blocks[Number(shot.scriptBlockIndex)];
      if (!scriptBlock) throw new Error(`第 ${index + 1} 个分镜没有对应脚本段落`);
      return {
        id: `${storyboardId}-shot-${String(index + 1).padStart(2, "0")}`,
        order: index,
        scriptBlockIds: [scriptBlock.id],
        purpose: shot.purpose,
        mode: shot.mode,
        framing: shot.framing || undefined,
        cameraDirection: String(shot.cameraDirection ?? "").trim() || undefined,
        actionDescription: String(shot.actionDescription ?? "").trim(),
        targetMs: Number(shot.targetMs),
        sourceRequirement: shot.sourceRequirement,
      };
    });
    const storyboard = runtime.creation.createStoryboard({ id: storyboardId, script, shots: shotDrafts, createdAt: now });
    const tasks = runtime.creation.createShootTasks(storyboard, now);
    const capturePackageDraft = runtime.creation.CapturePackageSchema.parse({ schemaVersion: 1, id: capturePackageId, projectId, storyboardRevision: storyboard.revision, format: "html", relativePath: `capture-packages/${capturePackageId}/index.html`, taskIds: tasks.map((task) => task.id), status: "draft", createdAt: now, updatedAt: now });
    const capturePackage = await runtime.creation.exportCapturePackage({ workspaceRoot: workspace.workspacePath, projectTitle: raw.projectTitle.trim(), capturePackage: capturePackageDraft, storyboard, tasks });
    workspace.catalog.saveCaptureWorkflow({ project: { id: projectId, workspaceId: workspace.workspaceId, title: raw.projectTitle.trim(), stage: "capture", revision: 1, payload: { scriptId, storyboardId, capturePackageId, taskIds: tasks.map((task) => task.id) }, createdAt: now, updatedAt: now }, script, storyboard, tasks, capturePackage });
    return { ok: true, projectId, script, storyboard, tasks, capturePackage };
  } catch (error) {
    return { ok: false, errorCode: "capture_workflow_failed", message: error instanceof Error ? error.message : "拍摄包生成失败" };
  }
});

ipcMain.handle("desktop:propose-edit", async (_event, projectId) => {
  try {
    const workspace = requireWorkspace();
    if (typeof projectId !== "string" || !projectId) throw new Error("项目 ID 无效");
    const project = workspace.catalog.getProject(projectId);
    if (!project || project.workspaceId !== workspace.workspaceId) throw new Error("项目不存在或不属于当前工作区");
    const payload = project.payload;
    const script = typeof payload.scriptId === "string" ? workspace.catalog.getScript(payload.scriptId) : undefined;
    const storyboard = typeof payload.storyboardId === "string" ? workspace.catalog.getStoryboard(payload.storyboardId) : undefined;
    const taskIds = Array.isArray(payload.taskIds) ? payload.taskIds.filter((taskId) => typeof taskId === "string") : [];
    const tasks = taskIds.map((taskId) => workspace.catalog.getShootTask(taskId)).filter(Boolean);
    if (!script || !storyboard || tasks.length === 0) throw new Error("项目还没有完整的脚本、分镜或拍摄任务");
    const takesByTask = {};
    const assetFacts = {};
    for (const task of tasks) {
      const takes = workspace.catalog.listTakes(task.id);
      takesByTask[task.id] = takes;
      for (const take of takes) {
        const artifact = workspace.catalog.getArtifact(take.assetId);
        if (artifact) assetFacts[take.assetId] = { contentHash: artifact.contentHash, durationMs: take.durationMs };
      }
    }
    const runtime = await getDesktopRuntime();
    const result = runtime.exchange.proposeEditFromCapture({ projectId, script, storyboard, tasks, takesByTask, assetFacts, now: new Date().toISOString() });
    return { ok: true, ...result, project: { id: project.id, title: project.title } };
  } catch (error) {
    return { ok: false, errorCode: "edit_proposal_failed", message: error instanceof Error ? error.message : "AI 剪辑提案生成失败" };
  }
});

ipcMain.handle("desktop:render-edit", async (_event, raw) => {
  try {
    const workspace = requireWorkspace();
    if (!raw || typeof raw.projectId !== "string" || !raw.proposal) throw new Error("剪辑提案参数无效");
    const runtime = await getDesktopRuntime();
    const proposal = runtime.exchange.EditProposalSchema.parse(raw.proposal);
    const project = workspace.catalog.getProject(raw.projectId);
    if (!project || project.workspaceId !== workspace.workspaceId) throw new Error("项目不存在或不属于当前工作区");
    const payload = project.payload;
    const taskIds = Array.isArray(payload.taskIds) ? payload.taskIds.filter((taskId) => typeof taskId === "string") : [];
    const takes = taskIds.flatMap((taskId) => workspace.catalog.listTakes(taskId));
    const takeByAssetId = new Map(takes.map((take) => [take.assetId, take]));
    const assets = {};
    for (const operation of proposal.operations.filter((operation) => operation.status !== "rejected")) {
      const artifact = workspace.catalog.getArtifact(operation.sourceAssetId);
      const take = takeByAssetId.get(operation.sourceAssetId);
      if (!artifact || !take || !take.durationMs) throw new Error(`素材事实不完整：${operation.sourceAssetId}`);
      const absolutePath = path.resolve(workspace.workspacePath, artifact.relativePath);
      const probe = await new runtime.media.FfmpegToolchain().probe(absolutePath).catch(() => null);
      assets[operation.sourceAssetId] = { assetId: operation.sourceAssetId, relativePath: artifact.relativePath, absolutePath, contentHash: artifact.contentHash, durationMs: take.durationMs, hasVideo: true, hasAudio: probe ? probe.streams.some((stream) => stream.kind === "audio") : true };
    }
    const renderId = `render-${raw.projectId}-${randomUUID().slice(0, 8)}`;
    const assetLocks = Object.values(assets).map((asset) => ({ assetId: asset.assetId, contentHash: asset.contentHash }));
    const frozen = runtime.exchange.freezeEditProposal({ proposal, assetLocks, now: new Date().toISOString() });
    const result = await runtime.exchange.exportRenderPackage({ workspaceRoot: workspace.workspacePath, renderId, frozenEditSpec: frozen, assets });
    return { ok: true, renderId, manifest: result.manifest, files: { video: path.relative(workspace.workspacePath, result.outputPath).split(path.sep).join("/"), subtitle: result.subtitlePath ? path.relative(workspace.workspacePath, result.subtitlePath).split(path.sep).join("/") : null, manifest: path.relative(workspace.workspacePath, result.manifestPath).split(path.sep).join("/") } };
  } catch (error) {
    return { ok: false, errorCode: "edit_render_failed", message: error instanceof Error ? error.message : "AI 剪辑导出失败" };
  }
});

ipcMain.handle("desktop:import-take", async (_event, shootTaskId) => {
  try {
    const workspace = requireWorkspace();
    if (typeof shootTaskId !== "string" || !shootTaskId) throw new Error("拍摄任务无效");
    const task = workspace.catalog.getShootTask(shootTaskId);
    if (!task) throw new Error("拍摄任务不存在");
    const result = await dialog.showOpenDialog({ properties: ["openFile"], title: `为“${task.title}”导入 Take`, filters: [{ name: "视频", extensions: ["mp4", "mov", "m4v", "webm", "mkv", "avi"] }] });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, errorCode: "cancelled", message: "已取消导入" };
    const runtime = await getDesktopRuntime();
    const imported = await runtime.mediaImporter.import({ workspaceRoot: workspace.workspacePath, sourcePath: result.filePaths[0] });
    workspace.catalog.insertArtifacts([imported.source, imported.proxy, imported.thumbnail].map((artifact) => ({ ...artifact, workspaceId: workspace.workspaceId })));
    const now = new Date().toISOString();
    const take = runtime.creation.TakeSchema.parse({ schemaVersion: 1, id: `take-${randomUUID()}`, shootTaskId, assetId: imported.source.artifactId, relativePath: imported.source.relativePath, durationMs: imported.probe.durationMs, status: "candidate", createdAt: now, updatedAt: now });
    workspace.catalog.addTake(take);
    return { ok: true, take, task: workspace.catalog.getShootTask(shootTaskId), sourceName: path.basename(result.filePaths[0]), thumbnail: imported.thumbnail };
  } catch (error) {
    return { ok: false, errorCode: "take_import_failed", message: error instanceof Error ? error.message : "Take 导入失败" };
  }
});

ipcMain.handle("desktop:select-take", (_event, input) => {
  try {
    const workspace = requireWorkspace();
    if (!input || typeof input.shootTaskId !== "string" || typeof input.takeId !== "string") throw new Error("Take 选择参数无效");
    const selection = workspace.catalog.selectTakeForTask(input.shootTaskId, input.takeId);
    return { ok: true, ...selection };
  } catch (error) {
    return { ok: false, errorCode: "take_selection_failed", message: error instanceof Error ? error.message : "Take 选择失败" };
  }
});

ipcMain.handle("desktop:open-workspace-file", async (_event, relativePath) => {
  try {
    const workspace = requireWorkspace();
    if (typeof relativePath !== "string" || !relativePath) throw new Error("文件路径无效");
    const absolutePath = path.resolve(workspace.workspacePath, relativePath);
    const root = realpathSync(workspace.workspacePath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) throw new Error("文件路径越过工作区");
    const canonicalPath = realpathSync(absolutePath);
    if (canonicalPath !== root && !canonicalPath.startsWith(`${root}${path.sep}`)) throw new Error("文件路径越过工作区");
    const message = await shell.openPath(canonicalPath);
    if (message) throw new Error(message);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "无法打开文件" };
  }
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

app.on("before-quit", () => {
  if (catalog) {
    catalog.close();
    catalog = null;
  }
});

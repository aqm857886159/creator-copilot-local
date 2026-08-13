const { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } = require("electron");
const { createHash, randomUUID } = require("node:crypto");
const { existsSync, mkdirSync, mkdtempSync, realpathSync } = require("node:fs");
const { mkdir: makeDirectory, readFile, rm: removeFile, stat: statFile, writeFile } = require("node:fs/promises");
const os = require("node:os");
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
      import(pathToFileURL(path.join(runtimeRoot, "analysis", "src", "index.js")).href),
      import(pathToFileURL(path.join(runtimeRoot, "creation", "src", "index.js")).href),
      import(pathToFileURL(path.join(runtimeRoot, "exchange", "src", "index.js")).href),
      import(pathToFileURL(path.join(runtimeRoot, "storage", "src", "catalog.js")).href),
      import(pathToFileURL(path.join(runtimeRoot, "providers", "src", "index.js")).href),
      import(pathToFileURL(path.join(runtimeRoot, "agent-runtime", "src", "index.js")).href),
      import(pathToFileURL(path.join(runtimeRoot, "research", "src", "index.js")).href),
      import(pathToFileURL(path.join(runtimeRoot, "publishing", "src", "index.js")).href),
    ]).then(([media, analysis, creation, exchange, storage, providers, agentRuntime, research, publishing]) => ({ media, analysis, creation, exchange, storage, providers, agentRuntime, research, publishing, mediaImporter: new media.LocalMediaImporter() }));
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

function getEditAgent(runtime) {
  const providerKey = process.env.AI_EDIT_PROVIDER ?? "local-fallback";
  if (providerKey === "apimart" && process.env.APIMART_API_KEY) {
    const modelKey = process.env.AI_EDIT_MODEL ?? "gpt-5-nano";
    const adapter = process.env.AI_EDIT_ADAPTER ?? "ai-sdk";
    if (adapter === "ai-sdk") {
      const configuredBaseUrl = process.env.APIMART_BASE_URL ?? "https://api.apimart.ai";
      const baseUrl = configuredBaseUrl.replace(/\/+$/, "").endsWith("/v1") ? configuredBaseUrl : `${configuredBaseUrl.replace(/\/+$/, "")}/v1`;
      const generator = new runtime.providers.AiSdkStructuredGenerator({ apiKey: process.env.APIMART_API_KEY, baseUrl });
      return new runtime.agentRuntime.AiSdkEditAgentRuntime(generator, modelKey);
    }
    const provider = new runtime.providers.ApiMartClient({ apiKey: process.env.APIMART_API_KEY, baseUrl: process.env.APIMART_BASE_URL ?? "https://api.apimart.ai" });
    return new runtime.agentRuntime.ProviderEditAgentRuntime(provider, modelKey);
  }
  return new runtime.agentRuntime.LocalEditAgentRuntime();
}

function getTikHubConnector(runtime) {
  if (!process.env.TIKHUB_API_KEY) throw new Error("TikHub API key 未配置");
  return new runtime.providers.TikHubDouyinConnector({ apiKey: process.env.TIKHUB_API_KEY, baseUrl: process.env.TIKHUB_BASE_URL ?? "https://api.tikhub.dev" });
}

function analysisWorkerScriptPath() {
  const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "electron", "analysis-worker.cjs");
  return app.isPackaged && existsSync(unpacked) ? unpacked : path.join(__dirname, "analysis-worker.cjs");
}

function runAnalysisWorker(payload) {
  if (!utilityProcess || typeof utilityProcess.fork !== "function") throw new Error("当前 Electron 不支持 utility process");
  const workerPath = analysisWorkerScriptPath();
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const worker = utilityProcess.fork(workerPath);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.kill();
      reject(new Error("媒体分析 worker 超时"));
    }, 10 * 60 * 1000);
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
      worker.kill();
    };
    worker.on("message", (message) => {
      if (!message || message.requestId !== requestId) return;
      finish(() => {
        if (message.ok) resolve(message.result);
        else reject(new Error(typeof message.error === "string" ? message.error : "媒体分析 worker 失败"));
      });
    });
    worker.on("exit", (code) => {
      if (settled) return;
      finish(() => reject(new Error(`媒体分析 worker 异常退出（${code ?? "unknown"}）`)));
    });
    worker.postMessage({ requestId, payload });
  });
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
  return window;
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
    const workspace = requireWorkspace();
    workspace.catalog.insertArtifacts([imported.source, imported.proxy, imported.thumbnail].map((artifact) => ({ ...artifact, workspaceId: workspace.workspaceId })));
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

ipcMain.handle("desktop:search-assets", async (_event, rawQuery) => {
  try {
    const workspace = requireWorkspace();
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    const artifacts = workspace.catalog.listArtifacts(workspace.workspaceId);
    const facts = workspace.catalog.searchAnalysisFacts({ workspaceId: workspace.workspaceId, query, limit: 50 });
    const matchingArtifactIds = new Set(facts.map((fact) => fact.artifactId));
    const visibleArtifacts = query ? artifacts.filter((artifact) => matchingArtifactIds.has(artifact.artifactId) || `${artifact.relativePath} ${artifact.kind} ${artifact.mimeType}`.toLowerCase().includes(query.toLowerCase())) : artifacts;
    return { ok: true, artifacts: visibleArtifacts, facts };
  } catch (error) {
    return { ok: false, errorCode: "asset_search_failed", message: error instanceof Error ? error.message : "素材搜索失败" };
  }
});

ipcMain.handle("desktop:research-account", async (_event, raw) => {
  try {
    const workspace = requireWorkspace();
    if (!raw || typeof raw.sourceInput !== "string" || !raw.sourceInput.trim()) throw new Error("请输入抖音主页链接或 sec_user_id");
    const count = raw.count === undefined ? 20 : Number(raw.count);
    const runtime = await getDesktopRuntime();
    const report = await runtime.research.buildAccountResearchReport({ workspaceId: workspace.workspaceId, sourceInput: raw.sourceInput.trim(), count, connector: getTikHubConnector(runtime), now: new Date().toISOString() });
    workspace.catalog.saveResearchReport(report);
    return { ok: true, report };
  } catch (error) {
    return { ok: false, errorCode: "account_research_failed", message: error instanceof Error ? error.message : "对标账号分析失败" };
  }
});

ipcMain.handle("desktop:download-research-media", async (_event, raw) => {
  try {
    const workspace = requireWorkspace();
    if (!raw || typeof raw.reportId !== "string" || !Array.isArray(raw.awemeIds)) throw new Error("研究素材选择参数无效");
    const awemeIds = [...new Set(raw.awemeIds.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
    if (awemeIds.length < 1 || awemeIds.length > 5) throw new Error("一次只能选择 1–5 条作品进行本地化");
    const report = workspace.catalog.getResearchReport(raw.reportId);
    if (!report || report.workspaceId !== workspace.workspaceId) throw new Error("研究报告不存在或不属于当前工作区");
    const selected = report.videos.filter((video) => awemeIds.includes(video.awemeId));
    if (selected.length !== awemeIds.length) throw new Error("选择的作品不在当前研究报告中");
    const runtime = await getDesktopRuntime();
    const connector = getTikHubConnector(runtime);
    const attachments = [];
    const failed = [];
    const downloaded = [];
    for (const video of selected) {
      if (video.artifactIds.length > 0) {
        attachments.push({ awemeId: video.awemeId, artifactIds: video.artifactIds, attachedAt: new Date().toISOString() });
        downloaded.push({ awemeId: video.awemeId, reused: true, artifactIds: video.artifactIds });
        continue;
      }
      const temporaryPath = path.join(os.tmpdir(), `creator-copilot-research-${randomUUID()}.mp4`);
      try {
        const playUrl = await connector.fetchHighestQualityPlayUrl({ awemeId: video.awemeId, shareUrl: video.shareUrl, region: "CN" });
        await runtime.media.downloadRemoteFile({ url: playUrl.url, destinationPath: temporaryPath, maxBytes: 1024 * 1024 * 1024 });
        const imported = await runtime.mediaImporter.import({ workspaceRoot: workspace.workspacePath, sourcePath: temporaryPath, maxBytes: 1024 * 1024 * 1024 });
        workspace.catalog.insertArtifacts([imported.source, imported.proxy, imported.thumbnail].map((artifact) => ({ ...artifact, workspaceId: workspace.workspaceId })));
        const artifactIds = [imported.source.artifactId, imported.proxy.artifactId, imported.thumbnail.artifactId];
        attachments.push({ awemeId: video.awemeId, artifactIds, attachedAt: new Date().toISOString() });
        downloaded.push({ awemeId: video.awemeId, reused: false, artifactIds });
      } catch (error) {
        failed.push({ awemeId: video.awemeId, message: error instanceof Error ? error.message : "下载或导入失败" });
      } finally {
        await removeFile(temporaryPath, { force: true }).catch(() => undefined);
      }
    }
    let updated = runtime.research.attachResearchMedia(report, attachments);
    updated = runtime.research.markResearchMediaFailures(updated, failed.map((item) => item.awemeId));
    workspace.catalog.saveResearchReport(updated);
    if (downloaded.length === 0) return { ok: false, errorCode: "research_media_download_failed", message: failed[0]?.message ?? "没有作品成功本地化", report: updated, failed };
    return { ok: true, report: updated, downloaded, failed };
  } catch (error) {
    return { ok: false, errorCode: "research_media_download_failed", message: error instanceof Error ? error.message : "研究素材下载失败" };
  }
});

ipcMain.handle("desktop:analyze-research-media", async (_event, raw) => {
  try {
    const workspace = requireWorkspace();
    if (!raw || typeof raw.reportId !== "string" || !Array.isArray(raw.awemeIds)) throw new Error("媒体分析选择参数无效");
    const awemeIds = [...new Set(raw.awemeIds.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
    if (awemeIds.length < 1 || awemeIds.length > 5) throw new Error("一次只能分析 1–5 条作品");
    const report = workspace.catalog.getResearchReport(raw.reportId);
    if (!report || report.workspaceId !== workspace.workspaceId) throw new Error("研究报告不存在或不属于当前工作区");
    const selected = report.videos.filter((video) => awemeIds.includes(video.awemeId));
    if (selected.length !== awemeIds.length) throw new Error("选择的作品不在当前研究报告中");
    const runtime = await getDesktopRuntime();
    const updates = [];
    const failed = [];
    const jobs = [];
    for (const video of selected) {
      const sourceArtifactId = video.artifactIds[0];
      const artifact = sourceArtifactId ? workspace.catalog.getArtifact(sourceArtifactId) : undefined;
      if (!artifact) {
        failed.push({ awemeId: video.awemeId, message: "作品尚未本地化，无法开始分析" });
        continue;
      }
      const inputHash = `sha256:${createHash("sha256").update(JSON.stringify({ artifactId: artifact.artifactId, contentHash: artifact.contentHash, pipeline: "analysis-v1" })).digest("hex")}`;
      const jobId = `analysis-${artifact.artifactId}`;
      const now = new Date();
      let job = workspace.catalog.getJob(jobId);
      if (!job) {
        const timestamp = now.toISOString();
        workspace.catalog.insertJob({ schemaVersion: 1, id: jobId, kind: "media.analysis", inputHash, state: "queued", attempt: 0, idempotencyKey: `analysis-${artifact.artifactId}-${artifact.contentHash}`, idempotencyScope: workspace.workspaceId, providerKey: "local", artifactIds: [artifact.artifactId], correlationId: randomUUID(), createdAt: timestamp, updatedAt: timestamp });
        job = workspace.catalog.getJob(jobId);
      } else if (job.state === "succeeded") {
        updates.push({ awemeId: video.awemeId, status: video.mediaAnalysisStatus === "completed" ? "completed" : "partial", factIds: video.analysisFactIds, summary: "已复用已完成的本地分析任务。", analyzedAt: now.toISOString() });
        jobs.push({ id: job.id, state: job.state, reused: true });
        continue;
      } else if (["failed", "needs_attention", "timed_out"].includes(job.state)) {
        const recoveryState = job.state === "needs_attention" ? "queued" : "retry_wait";
        workspace.catalog.transitionJob(job.id, job.state, recoveryState, undefined, { retryAfter: now.toISOString(), lastError: undefined });
        job = workspace.catalog.getJob(job.id);
      }
      if (!job) throw new Error(`分析任务创建失败：${artifact.artifactId}`);
      workspace.catalog.recoverExpiredLeases(now);
      const leaseToken = workspace.catalog.claimJob(job.id, "analysis-main", now, 120_000);
      if (!leaseToken) {
        failed.push({ awemeId: video.awemeId, message: "分析任务正在运行或无法取得租约" });
        continue;
      }
      const heartbeatAt = new Date();
      if (!workspace.catalog.heartbeatJob(job.id, "analysis-main", leaseToken, heartbeatAt, 120_000)) {
        failed.push({ awemeId: video.awemeId, message: "分析任务租约已失效，请重试" });
        continue;
      }
      try {
        const absolutePath = path.resolve(workspace.workspacePath, artifact.relativePath);
        const root = realpathSync(workspace.workspacePath);
        if (!existsSync(absolutePath)) throw new Error("本地素材文件不存在");
        const canonicalPath = realpathSync(absolutePath);
        if (canonicalPath !== root && !canonicalPath.startsWith(`${root}${path.sep}`)) throw new Error("分析素材路径越过工作区");
        const probe = await new runtime.media.FfmpegToolchain().probe(canonicalPath);
        const durationMs = probe.durationMs ?? video.durationMs;
        if (!durationMs || durationMs <= 0) throw new Error("素材没有可用时长");
        const createdAt = new Date().toISOString();
        const workerResult = await runAnalysisWorker({ sourcePath: canonicalPath, durationMs, workspaceId: workspace.workspaceId, artifactId: artifact.artifactId, contentHash: artifact.contentHash, createdAt, whisperModelPath: process.env.WHISPER_MODEL_PATH, whisperBinaryPath: process.env.WHISPER_BINARY_PATH, visionScriptPath: process.env.APPLE_VISION_OCR_SCRIPT ?? path.join(process.cwd(), "scripts", "apple-vision-ocr.swift"), visionBinaryPath: process.env.APPLE_VISION_OCR_BINARY, visionSampleIntervalMs: Number(process.env.APPLE_VISION_OCR_INTERVAL_MS ?? 1000) });
        workspace.catalog.saveAnalysisFacts(workerResult.facts);
        workspace.catalog.transitionJob(job.id, "running", "succeeded", leaseToken, { artifactIds: [artifact.artifactId], checkpoint: { shotCount: workerResult.shotCount, factIds: workerResult.facts.map((fact) => fact.id), asrStatus: workerResult.asrStatus, ocrStatus: workerResult.ocrStatus } });
        updates.push({ awemeId: video.awemeId, status: workerResult.asrReady && workerResult.ocrReady ? "completed" : "partial", factIds: workerResult.facts.map((fact) => fact.id), summary: workerResult.summary, analyzedAt: createdAt });
        jobs.push({ id: job.id, state: "succeeded", factCount: workerResult.facts.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : "本地媒体分析失败";
        workspace.catalog.transitionJob(job.id, "running", "failed", leaseToken, { lastError: { code: "MEDIA_ANALYSIS_FAILED", message, retryable: true } });
        failed.push({ awemeId: video.awemeId, message });
        jobs.push({ id: job.id, state: "failed" });
      }
    }
    const updated = runtime.research.attachResearchAnalysis(workspace.catalog.getResearchReport(report.id) ?? report, updates);
    workspace.catalog.saveResearchReport(updated);
    if (updates.length === 0) return { ok: false, errorCode: "research_media_analysis_failed", message: failed[0]?.message ?? "没有作品完成分析", report: updated, failed, jobs };
    return { ok: true, report: updated, failed, jobs };
  } catch (error) {
    return { ok: false, errorCode: "research_media_analysis_failed", message: error instanceof Error ? error.message : "本地媒体分析失败" };
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
    const result = await getEditAgent(runtime).proposeEdit({ projectId, script, storyboard, tasks, takesByTask, assetFacts, now: new Date().toISOString() });
    if (result.status === "ready" && result.proposal) workspace.catalog.saveEditProposal(result.proposal);
    return { ok: true, ...result, project: { id: project.id, title: project.title } };
  } catch (error) {
    return { ok: false, errorCode: "edit_proposal_failed", message: error instanceof Error ? error.message : "AI 剪辑提案生成失败" };
  }
});

ipcMain.handle("desktop:render-edit", async (_event, raw) => {
  let renderRunId = null;
  let renderWorkspace = null;
  let renderRuntime = null;
  try {
    const workspace = requireWorkspace();
    renderWorkspace = workspace;
    if (!raw || typeof raw.projectId !== "string" || !raw.proposal) throw new Error("剪辑提案参数无效");
    const runtime = await getDesktopRuntime();
    renderRuntime = runtime;
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
      const workspaceRoot = realpathSync(workspace.workspacePath);
      if (!existsSync(absolutePath)) throw new Error(`素材文件不存在：${operation.sourceAssetId}`);
      const canonicalAssetPath = realpathSync(absolutePath);
      if (canonicalAssetPath !== workspaceRoot && !canonicalAssetPath.startsWith(`${workspaceRoot}${path.sep}`)) throw new Error(`素材路径越过工作区：${operation.sourceAssetId}`);
      const probe = await new runtime.media.FfmpegToolchain().probe(canonicalAssetPath).catch(() => null);
      assets[operation.sourceAssetId] = { assetId: operation.sourceAssetId, relativePath: artifact.relativePath, absolutePath: canonicalAssetPath, contentHash: artifact.contentHash, durationMs: take.durationMs, hasVideo: true, hasAudio: probe ? probe.streams.some((stream) => stream.kind === "audio") : true };
    }
    const renderId = `render-${raw.projectId}-${randomUUID().slice(0, 8)}`;
    const assetLocks = Object.values(assets).map((asset) => ({ assetId: asset.assetId, contentHash: asset.contentHash }));
    const frozen = runtime.exchange.freezeEditProposal({ proposal, assetLocks, now: new Date().toISOString() });
    if (!workspace.catalog.saveEditProposal(proposal)) throw new Error("剪辑提案版本保存失败");
    if (!workspace.catalog.saveFrozenEditSpec(frozen)) throw new Error("冻结剪辑规格版本冲突");
    renderRunId = `render-${raw.projectId}-${randomUUID().slice(0, 8)}`;
    const renderNow = new Date().toISOString();
    workspace.catalog.saveRenderRun({ schemaVersion: 1, id: renderRunId, projectId: raw.projectId, frozenEditSpecId: frozen.id, state: "running", createdAt: renderNow, updatedAt: renderNow });
    const result = await runtime.exchange.exportRenderPackage({ workspaceRoot: workspace.workspacePath, renderId, frozenEditSpec: frozen, assets });
    workspace.catalog.saveRenderRun({ schemaVersion: 1, id: renderRunId, projectId: raw.projectId, frozenEditSpecId: frozen.id, state: "succeeded", manifestRelativePath: path.relative(workspace.workspacePath, result.manifestPath).split(path.sep).join("/"), manifestHash: result.manifestHash, createdAt: renderNow, updatedAt: new Date().toISOString() });
    return { ok: true, renderId, renderRunId, manifest: result.manifest, files: { video: path.relative(workspace.workspacePath, result.outputPath).split(path.sep).join("/"), subtitle: result.subtitlePath ? path.relative(workspace.workspacePath, result.subtitlePath).split(path.sep).join("/") : null, manifest: path.relative(workspace.workspacePath, result.manifestPath).split(path.sep).join("/") } };
  } catch (error) {
    if (renderRunId && renderWorkspace && renderRuntime) {
      const message = error instanceof Error ? error.message : "AI 剪辑导出失败";
      try {
        const current = renderWorkspace.catalog.getRenderRun(renderRunId);
        if (current) renderWorkspace.catalog.saveRenderRun({ ...current, state: "failed", error: { code: "edit_render_failed", message }, updatedAt: new Date().toISOString() });
      } catch {
        // Preserve the original render error; recovery can inspect a running run after restart.
      }
    }
    return { ok: false, errorCode: "edit_render_failed", message: error instanceof Error ? error.message : "AI 剪辑导出失败" };
  }
});

ipcMain.handle("desktop:export-exchange", async (_event, raw) => {
  try {
    const workspace = requireWorkspace();
    if (!raw || typeof raw.renderRunId !== "string" || !Array.isArray(raw.formats)) throw new Error("交换格式导出参数无效");
    const formats = [...new Set(raw.formats.filter((format) => format === "fcpxml" || format === "otio"))];
    if (formats.length === 0 || formats.length > 2) throw new Error("请选择 FCPXML 或 OTIO");
    const run = workspace.catalog.getRenderRun(raw.renderRunId);
    if (!run || run.state !== "succeeded") throw new Error("只有成功的渲染结果才能导出交换格式");
    const spec = workspace.catalog.getFrozenEditSpec(run.frozenEditSpecId);
    if (!spec || spec.projectId !== run.projectId) throw new Error("冻结剪辑规格不存在");
    const runtime = await getDesktopRuntime();
    const assets = {};
    for (const lock of spec.assetLocks) {
      const artifact = workspace.catalog.getArtifact(lock.assetId);
      if (!artifact) throw new Error(`交换导出缺少素材：${lock.assetId}`);
      const absolutePath = path.resolve(workspace.workspacePath, artifact.relativePath);
      const root = realpathSync(workspace.workspacePath);
      if (!existsSync(absolutePath)) throw new Error(`交换导出素材文件不存在：${lock.assetId}`);
      const canonicalPath = realpathSync(absolutePath);
      if (canonicalPath !== root && !canonicalPath.startsWith(`${root}${path.sep}`)) throw new Error(`交换导出素材越过工作区：${lock.assetId}`);
      const probe = await new runtime.media.FfmpegToolchain().probe(canonicalPath);
      if (!probe.durationMs || probe.durationMs <= 0) throw new Error(`交换导出素材没有有效时长：${lock.assetId}`);
      assets[lock.assetId] = { assetId: lock.assetId, relativePath: artifact.relativePath, absolutePath: canonicalPath, contentHash: artifact.contentHash, durationMs: probe.durationMs, hasAudio: probe.streams.some((stream) => stream.kind === "audio") };
    }
    const ir = runtime.exchange.compileFrozenEditSpec({ spec, assets });
    const outputs = {};
    for (const format of formats) {
      const exchange = format === "fcpxml" ? runtime.exchange.exportFcpXml({ ir, workspaceRoot: workspace.workspacePath }) : runtime.exchange.exportOtio({ ir, workspaceRoot: workspace.workspacePath });
      const relativePath = `exports/${raw.renderRunId}.${format === "fcpxml" ? "fcpxml" : "otio.json"}`;
      const lossRelativePath = `${relativePath}.loss.json`;
      const outputPath = path.resolve(workspace.workspacePath, relativePath);
      const lossPath = path.resolve(workspace.workspacePath, lossRelativePath);
      const root = realpathSync(workspace.workspacePath);
      for (const target of [outputPath, lossPath]) if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("交换导出路径越过工作区");
      await makeDirectory(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, exchange.body, "utf8");
      await writeFile(lossPath, `${JSON.stringify(exchange.report, null, 2)}\n`, "utf8");
      const outputHash = await runtime.media.sha256File(outputPath);
      const lossHash = await runtime.media.sha256File(lossPath);
      const parentArtifactIds = spec.assetLocks.map((lock) => lock.assetId);
      workspace.catalog.insertArtifacts([
        { schemaVersion: 1, artifactId: `exchange-${raw.renderRunId}-${format}`, workspaceId: workspace.workspaceId, kind: `exchange-${format}`, relativePath, mimeType: format === "fcpxml" ? "application/xml" : "application/json", contentHash: outputHash, byteSize: Buffer.byteLength(exchange.body), parentArtifactIds, validationStatus: "valid" },
        { schemaVersion: 1, artifactId: `exchange-${raw.renderRunId}-${format}-loss`, workspaceId: workspace.workspaceId, kind: "exchange-loss-report", relativePath: lossRelativePath, mimeType: "application/json", contentHash: lossHash, byteSize: Buffer.byteLength(JSON.stringify(exchange.report)), parentArtifactIds: [`exchange-${raw.renderRunId}-${format}`], validationStatus: "valid" },
      ]);
      outputs[format] = { relativePath, lossReportPath: lossRelativePath, report: exchange.report };
    }
    return { ok: true, renderRunId: raw.renderRunId, outputs };
  } catch (error) {
    return { ok: false, errorCode: "exchange_export_failed", message: error instanceof Error ? error.message : "交换格式导出失败" };
  }
});

ipcMain.handle("desktop:create-publish-package", async (_event, raw) => {
  try {
    const workspace = requireWorkspace();
    if (!raw || typeof raw.renderRunId !== "string" || typeof raw.title !== "string" || !raw.title.trim()) throw new Error("发布包参数无效");
    const run = workspace.catalog.getRenderRun(raw.renderRunId);
    if (!run || run.state !== "succeeded" || !run.manifestRelativePath) throw new Error("只有成功的渲染结果才能生成发布包");
    const spec = workspace.catalog.getFrozenEditSpec(run.frozenEditSpecId);
    if (!spec || spec.projectId !== run.projectId) throw new Error("发布包对应的冻结剪辑规格不存在");
    const runtime = await getDesktopRuntime();
    const manifestPath = path.resolve(workspace.workspacePath, run.manifestRelativePath);
    const root = realpathSync(workspace.workspacePath);
    if (!existsSync(manifestPath)) throw new Error("渲染 manifest 文件不存在");
    const canonicalManifestPath = realpathSync(manifestPath);
    if (canonicalManifestPath !== root && !canonicalManifestPath.startsWith(`${root}${path.sep}`)) throw new Error("渲染 manifest 越过工作区");
    const renderManifest = runtime.exchange.RenderManifestSchema.parse(JSON.parse(await readFile(canonicalManifestPath, "utf8")));
    const video = renderManifest.outputs.find((output) => output.kind === "video");
    if (!video) throw new Error("渲染 manifest 缺少视频输出");
    const subtitle = renderManifest.outputs.find((output) => output.kind === "subtitle");
    const packageId = `publish-${raw.renderRunId}`;
    const result = await runtime.publishing.exportPublishPackage({
      workspaceRoot: workspace.workspacePath,
      packageId,
      projectId: run.projectId,
      renderRunId: raw.renderRunId,
      platform: typeof raw.platform === "string" && raw.platform.trim() ? raw.platform.trim() : "抖音",
      title: raw.title.trim(),
      description: typeof raw.description === "string" ? raw.description : "",
      hashtags: Array.isArray(raw.hashtags) ? raw.hashtags.filter((tag) => typeof tag === "string") : [],
      rightsNote: typeof raw.rightsNote === "string" ? raw.rightsNote : undefined,
      sourceArtifactIds: spec.assetLocks.map((lock) => lock.assetId),
      sourceFiles: { video: path.resolve(workspace.workspacePath, video.relativePath), subtitle: subtitle ? path.resolve(workspace.workspacePath, subtitle.relativePath) : undefined, manifest: canonicalManifestPath },
    });
    const artifactIds = result.files.map((file) => `publish-${raw.renderRunId}-${file.kind}`);
    const manifestStats = await statFile(result.manifestPath);
    const manifestHash = await runtime.media.sha256File(result.manifestPath);
    workspace.catalog.insertArtifacts([
      ...result.files.map((file, index) => ({ schemaVersion: 1, artifactId: artifactIds[index], workspaceId: workspace.workspaceId, kind: `publish-${file.kind}`, relativePath: file.relativePath, mimeType: file.mimeType, contentHash: file.contentHash, byteSize: file.byteSize, parentArtifactIds: spec.assetLocks.map((lock) => lock.assetId), validationStatus: "valid" })),
      { schemaVersion: 1, artifactId: `publish-${raw.renderRunId}-package-manifest`, workspaceId: workspace.workspaceId, kind: "publish-package-manifest", relativePath: path.relative(workspace.workspacePath, result.manifestPath).split(path.sep).join("/"), mimeType: "application/json", contentHash: manifestHash, byteSize: manifestStats.size, parentArtifactIds: artifactIds, validationStatus: "valid" },
    ]);
    const now = new Date().toISOString();
    const publication = workspace.catalog.savePublication({ schemaVersion: 1, id: `publication-${raw.renderRunId}`, projectId: run.projectId, packageId, platform: result.manifest.platform, status: "draft", createdAt: now, updatedAt: now });
    return { ok: true, packageId, publicationId: publication.id, manifest: result.manifest, packageRelativePath: path.relative(workspace.workspacePath, result.packageDir).split(path.sep).join("/"), manifestRelativePath: path.relative(workspace.workspacePath, result.manifestPath).split(path.sep).join("/") };
  } catch (error) {
    return { ok: false, errorCode: "publish_package_failed", message: error instanceof Error ? error.message : "发布包生成失败" };
  }
});

ipcMain.handle("desktop:list-publications", async () => {
  try {
    const workspace = requireWorkspace();
    return { ok: true, publications: workspace.catalog.listPublicationsForWorkspace(workspace.workspaceId).map((publication) => ({ publication, snapshots: workspace.catalog.listMetricSnapshots(publication.id) })), proposals: workspace.catalog.listReviewMemoryProposals(workspace.workspaceId) };
  } catch (error) {
    return { ok: false, errorCode: "publication_list_failed", message: error instanceof Error ? error.message : "读取发布记录失败" };
  }
});

ipcMain.handle("desktop:record-metrics", async (_event, raw) => {
  try {
    const workspace = requireWorkspace();
    const runtime = await getDesktopRuntime();
    const publication = typeof raw?.publicationId === "string" ? workspace.catalog.getPublication(raw.publicationId) : undefined;
    if (!publication || workspace.catalog.getProject(publication.projectId)?.workspaceId !== workspace.workspaceId) throw new Error("发布记录不存在或不属于当前工作区");
    const snapshot = runtime.publishing.MetricSnapshotSchema.parse({ schemaVersion: 1, id: `metric-${randomUUID()}`, publicationId: publication.id, capturedAt: new Date().toISOString(), window: typeof raw.window === "string" && raw.window.trim() ? raw.window.trim() : "24h", source: "manual", metrics: { views: typeof raw.metrics?.views === "number" ? raw.metrics.views : null, likes: typeof raw.metrics?.likes === "number" ? raw.metrics.likes : null, comments: typeof raw.metrics?.comments === "number" ? raw.metrics.comments : null, shares: typeof raw.metrics?.shares === "number" ? raw.metrics.shares : null, saves: typeof raw.metrics?.saves === "number" ? raw.metrics.saves : null, completionRate: typeof raw.metrics?.completionRate === "number" ? raw.metrics.completionRate : null, averageWatchSeconds: typeof raw.metrics?.averageWatchSeconds === "number" ? raw.metrics.averageWatchSeconds : null, newFollowers: typeof raw.metrics?.newFollowers === "number" ? raw.metrics.newFollowers : null }, notes: typeof raw.notes === "string" ? raw.notes : "" });
    workspace.catalog.saveMetricSnapshot(snapshot);
    return { ok: true, snapshot };
  } catch (error) {
    return { ok: false, errorCode: "metric_record_failed", message: error instanceof Error ? error.message : "指标录入失败" };
  }
});

ipcMain.handle("desktop:propose-review-memory", async (_event, raw) => {
  try {
    const workspace = requireWorkspace();
    const runtime = await getDesktopRuntime();
    const publication = typeof raw?.publicationId === "string" ? workspace.catalog.getPublication(raw.publicationId) : undefined;
    if (!publication || workspace.catalog.getProject(publication.projectId)?.workspaceId !== workspace.workspaceId) throw new Error("发布记录不存在或不属于当前工作区");
    const snapshots = workspace.catalog.listMetricSnapshots(publication.id);
    const proposal = runtime.publishing.proposeReviewMemory({ workspaceId: workspace.workspaceId, sourcePublicationIds: [publication.id], snapshots, statement: typeof raw.statement === "string" ? raw.statement : "", appliesTo: { platforms: [publication.platform] } });
    workspace.catalog.saveReviewMemoryProposal(proposal);
    return { ok: true, proposal };
  } catch (error) {
    return { ok: false, errorCode: "review_memory_failed", message: error instanceof Error ? error.message : "复盘建议生成失败" };
  }
});

ipcMain.handle("desktop:confirm-review-memory", async (_event, proposalId) => {
  try {
    const workspace = requireWorkspace();
    if (typeof proposalId !== "string" || !proposalId) throw new Error("复盘建议无效");
    const proposal = workspace.catalog.getReviewMemoryProposal(proposalId);
    if (!proposal || proposal.workspaceId !== workspace.workspaceId) throw new Error("复盘建议不存在或不属于当前工作区");
    if (!workspace.catalog.confirmReviewMemoryProposal(proposalId)) throw new Error("复盘建议不存在或已经处理");
    return { ok: true, proposal: workspace.catalog.getReviewMemoryProposal(proposalId) };
  } catch (error) {
    return { ok: false, errorCode: "review_memory_confirm_failed", message: error instanceof Error ? error.message : "确认复盘记忆失败" };
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

ipcMain.handle("desktop:open-external", async (_event, rawUrl) => {
  try {
    if (typeof rawUrl !== "string") throw new Error("外部链接无效");
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") throw new Error("仅允许打开 HTTPS 链接");
    await shell.openExternal(url.toString());
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "无法打开外部链接" };
  }
});

app.whenReady().then(() => {
  const window = createWindow();
  if (process.argv.includes("--smoke")) {
    window.webContents.once("did-finish-load", async () => {
      try {
        const result = await window.webContents.executeJavaScript("window.desktop?.getInfo ? window.desktop.getInfo() : null");
        if (!result || typeof result.platform !== "string" || typeof result.arch !== "string") throw new Error("preload IPC smoke 返回值无效");
        const runtime = await getDesktopRuntime();
        const smokeRoot = mkdtempSync(path.join(os.tmpdir(), "creator-copilot-desktop-smoke-"));
        const smokeCatalog = new runtime.storage.SqliteCatalog(path.join(smokeRoot, "catalog.sqlite"));
        const schemaVersion = smokeCatalog.schemaVersion();
        smokeCatalog.close();
        await removeFile(smokeRoot, { recursive: true, force: true });
        console.log(JSON.stringify({ ok: true, smoke: "preload-ipc+runtime-sqlite", platform: result.platform, arch: result.arch, schemaVersion }));
        app.exit(0);
      } catch (error) {
        console.error(JSON.stringify({ ok: false, smoke: "preload-ipc", message: error instanceof Error ? error.message : "preload IPC smoke 失败" }));
        app.exit(1);
      }
    });
  }
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

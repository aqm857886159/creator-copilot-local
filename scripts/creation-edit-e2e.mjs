import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const run = async (binary, args) => {
  const result = await execFile(binary, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return result.stdout;
};

const hashFile = async (filePath) => {
  const { createReadStream } = await import("node:fs");
  return new Promise((resolveHash, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(`sha256:${digest.digest("hex")}`));
  });
};

const root = join(process.cwd(), ".data", "v4-creation-edit-e2e");
const incomingDir = join(root, "incoming");
const metadataDir = join(root, ".creator-copilot");
const fixturePath = join(incomingDir, "phone-take.mp4");
const now = "2026-08-14T00:00:00.000Z";

await rm(root, { recursive: true, force: true });
await mkdir(metadataDir, { recursive: true });
await mkdir(incomingDir, { recursive: true });
await run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", "color=c=0x34495e:s=360x640:r=30:d=2.4",
  "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2.4",
  "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", fixturePath,
]);

const [creation, media, exchange, storage, agentRuntime] = await Promise.all([
  import("../dist-electron/packages/creation/src/index.js"),
  import("../dist-electron/packages/media/src/index.js"),
  import("../dist-electron/packages/exchange/src/index.js"),
  import("../dist-electron/packages/storage/src/catalog.js"),
  import("../dist-electron/packages/agent-runtime/src/index.js"),
]);

const workspaceId = "workspace-v4-creation-edit";
const projectId = "project-v4-creation-edit";
const catalog = new storage.SqliteCatalog(join(metadataDir, "catalog.sqlite"));
catalog.createWorkspace({ id: workspaceId, name: "V4 creation edit E2E", rootPath: root, schemaVersion: 1, defaultLocale: "zh-CN", createdAt: now, updatedAt: now });

const script = creation.ScriptSchema.parse({
  schemaVersion: 1,
  id: "script-v4-creation-edit",
  projectId,
  revision: 1,
  status: "approved",
  blocks: [{ schemaVersion: 1, id: "block-v4-claim", order: 0, kind: "claim", text: "先把一个观点讲清楚，再让画面补足证据。", emphasis: ["观点", "证据"], evidenceIds: [], visualNeed: "support" }],
  estimatedDurationMs: 1800,
  createdAt: now,
  updatedAt: now,
});
const storyboard = creation.createStoryboard({
  id: "storyboard-v4-creation-edit",
  script,
  createdAt: now,
  shots: [{ id: "shot-v4-talking-head", order: 0, scriptBlockIds: [script.blocks[0].id], purpose: "explain", mode: "talking_head", framing: "medium", cameraDirection: "手机竖拍，中景，开头和结尾各多留两秒。", actionDescription: "正面自然口播一个观点，语气像平时和朋友解释问题。", targetMs: 1800, minMs: 1200, maxMs: 2400, sourceRequirement: "shoot_task" }],
});
const tasks = creation.createShootTasks(storyboard, now);
const project = { id: projectId, workspaceId, title: "V4 创作到 AI 粗剪", stage: "creation", revision: 1, payload: { workflow: "deep-talking-head" }, createdAt: now, updatedAt: now };
const capturePackage = creation.CapturePackageSchema.parse({ schemaVersion: 1, id: "capture-v4-creation-edit", projectId, storyboardRevision: storyboard.revision, format: "html", relativePath: "capture/shooting-package.html", taskIds: tasks.map((task) => task.id), status: "draft", createdAt: now, updatedAt: now });
catalog.saveCaptureWorkflow({ project, script, storyboard, tasks, capturePackage });
const exportedCapturePackage = await creation.exportCapturePackage({ workspaceRoot: root, projectTitle: project.title, capturePackage, storyboard, tasks });
catalog.saveCapturePackage(exportedCapturePackage);

const imported = await new media.LocalMediaImporter().import({ workspaceRoot: root, sourcePath: fixturePath });
catalog.insertArtifacts([imported.source, imported.proxy, imported.thumbnail].map((artifact) => ({ ...artifact, workspaceId })));
const task = catalog.getShootTask(tasks[0].id);
if (!task) throw new Error("拍摄任务没有持久化");
const take = creation.TakeSchema.parse({ schemaVersion: 1, id: "take-v4-phone", shootTaskId: task.id, assetId: imported.source.artifactId, relativePath: imported.source.relativePath, capturedAt: now, durationMs: imported.probe.durationMs, status: "candidate", createdAt: now, updatedAt: now });
catalog.addTake(take);
catalog.selectTakeForTask(task.id, take.id);
const selectedTask = catalog.getShootTask(task.id);
const selectedTake = catalog.getTake(take.id);
if (!selectedTask || !selectedTake || selectedTake.status !== "selected") throw new Error("Take 选择没有持久化");

const proposalResult = await new agentRuntime.LocalEditAgentRuntime().proposeEdit({
  projectId,
  script: catalog.getScript(script.id),
  storyboard: catalog.getStoryboard(storyboard.id),
  tasks: [selectedTask],
  takesByTask: { [selectedTask.id]: [selectedTake] },
  assetFacts: { [imported.source.artifactId]: { contentHash: imported.source.contentHash, durationMs: imported.probe.durationMs } },
  now,
});
if (proposalResult.status !== "ready" || !proposalResult.proposal || !proposalResult.assetLocks) throw new Error(`本地 AI 粗剪提案未就绪：${JSON.stringify(proposalResult.missing)}`);
const proposal = exchange.EditProposalSchema.parse({ ...proposalResult.proposal, operations: proposalResult.proposal.operations.map((operation) => ({ ...operation, status: "accepted" })), status: "adopted", updatedAt: now });
catalog.saveEditProposal(proposal);
const frozen = exchange.freezeEditProposal({ proposal, assetLocks: proposalResult.assetLocks, now });
if (!catalog.saveFrozenEditSpec(frozen)) throw new Error("FrozenEditSpec 没有持久化");

const renderId = "render-v4-creation-edit";
const renderJobId = "job-v4-creation-edit";
catalog.insertJob({ schemaVersion: 1, id: renderJobId, kind: "edit.render", inputHash: "sha256:v4-creation-edit", state: "queued", attempt: 0, idempotencyKey: renderJobId, idempotencyScope: workspaceId, correlationId: renderId, artifactIds: [], createdAt: now, updatedAt: now });
const leaseToken = catalog.claimJob(renderJobId, "creation-edit-e2e", new Date(now), 60_000);
if (!leaseToken || !catalog.heartbeatJob(renderJobId, "creation-edit-e2e", leaseToken, new Date(now), 60_000)) throw new Error("渲染 Job lease 失败");
const result = await exchange.exportRenderPackage({
  workspaceRoot: root,
  renderId,
  frozenEditSpec: frozen,
  assets: { [imported.source.artifactId]: { assetId: imported.source.artifactId, relativePath: imported.source.relativePath, absolutePath: join(root, imported.source.relativePath), contentHash: imported.source.contentHash, durationMs: imported.probe.durationMs, hasVideo: true, hasAudio: imported.probe.streams.some((stream) => stream.kind === "audio") } },
});
const outputArtifacts = result.manifest.outputs.map((output) => ({ schemaVersion: 1, artifactId: `artifact-${renderId}-${output.kind}`, workspaceId, kind: `render-${output.kind}`, relativePath: output.relativePath, mimeType: output.mimeType, contentHash: output.contentHash, byteSize: output.byteSize, parentArtifactIds: [imported.source.artifactId], validationStatus: "valid" }));
const manifestStats = await stat(result.manifestPath);
outputArtifacts.push({ schemaVersion: 1, artifactId: `artifact-${renderId}-manifest`, workspaceId, kind: "render-manifest", relativePath: `exports/${renderId}.manifest.json`, mimeType: "application/json", contentHash: result.manifestHash, byteSize: manifestStats.size, parentArtifactIds: [imported.source.artifactId], validationStatus: "valid" });
catalog.insertArtifacts(outputArtifacts);
if (!catalog.transitionJob(renderJobId, "running", "succeeded", leaseToken, { artifactIds: outputArtifacts.map((artifact) => artifact.artifactId), checkpoint: { manifestHash: result.manifestHash } })) throw new Error("渲染 Job 完成状态没有持久化");
catalog.saveRenderRun({ schemaVersion: 1, id: renderId, projectId, frozenEditSpecId: frozen.id, state: "succeeded", manifestRelativePath: `exports/${renderId}.manifest.json`, manifestHash: result.manifestHash, createdAt: now, updatedAt: new Date().toISOString() });

const probe = JSON.parse(await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", result.outputPath]));
const outputStats = await stat(result.outputPath);
const persistedJob = catalog.getJob(renderJobId);
const persistedArtifacts = catalog.listArtifacts(workspaceId);
catalog.close();
console.log(JSON.stringify({
  ok: true,
  workflow: ["script", "storyboard", "capture-package", "import-take", "select-take", "ai-edit-proposal", "freeze", "render"],
  capturePackage: exportedCapturePackage.relativePath,
  imported: { sourceArtifactId: imported.source.artifactId, proxyArtifactId: imported.proxy.artifactId, thumbnailArtifactId: imported.thumbnail.artifactId, durationMs: imported.probe.durationMs },
  proposal: { id: proposal.id, provider: proposalResult.provider.providerKey, operationCount: proposal.operations.length, status: proposal.status },
  frozen: { id: frozen.id, authoredSpecHash: frozen.authoredSpecHash, durationMs: frozen.durationMs },
  render: { id: renderId, video: `exports/${renderId}.mp4`, subtitle: Boolean(result.subtitlePath), manifest: `exports/${renderId}.manifest.json`, byteSize: outputStats.size, durationMs: Math.round(Number(probe.format.duration) * 1000), width: probe.streams.find((stream) => stream.codec_type === "video")?.width, height: probe.streams.find((stream) => stream.codec_type === "video")?.height },
  persistence: { schemaVersion: 8, jobState: persistedJob?.state, attempt: persistedJob?.attempt, artifactCount: persistedArtifacts.length, renderArtifactCount: outputArtifacts.length },
}));

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
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const root = join(process.cwd(), ".data", "v4-render-recovery-smoke");
const incomingDir = join(root, "incoming");
const metadataDir = join(root, ".creator-copilot");
const fixturePath = join(incomingDir, "recovery-source.mp4");
const workspaceId = "workspace-v4-render-recovery";
const projectId = "project-v4-render-recovery";
const renderRunId = "render-v4-recovery";
const jobId = `job-${renderRunId}`;
const now = "2026-08-14T00:00:00.000Z";

await rm(root, { recursive: true, force: true });
await mkdir(metadataDir, { recursive: true });
await mkdir(incomingDir, { recursive: true });
await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x455a64:s=360x640:r=30:d=1.6", "-f", "lavfi", "-i", "sine=frequency=500:sample_rate=48000:duration=1.6", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", fixturePath]);

const [media, exchange, storage] = await Promise.all([
  import("../dist-electron/packages/media/src/index.js"),
  import("../dist-electron/packages/exchange/src/index.js"),
  import("../dist-electron/packages/storage/src/catalog.js"),
]);

let catalog = new storage.SqliteCatalog(join(metadataDir, "catalog.sqlite"));
catalog.createWorkspace({ id: workspaceId, name: "V4 render recovery", rootPath: root, schemaVersion: 1, defaultLocale: "zh-CN", createdAt: now, updatedAt: now });
catalog.createProject({ id: projectId, workspaceId, title: "渲染恢复 smoke", stage: "edit", revision: 1, payload: {}, createdAt: now, updatedAt: now });
const imported = await new media.LocalMediaImporter().import({ workspaceRoot: root, sourcePath: fixturePath });
catalog.insertArtifacts([imported.source, imported.proxy, imported.thumbnail].map((artifact) => ({ ...artifact, workspaceId })));
const proposal = exchange.EditProposalSchema.parse({
  schemaVersion: 1,
  id: "proposal-v4-recovery",
  projectId,
  basedOn: { scriptRevision: 1, storyboardRevision: 1 },
  durationMs: 1_200,
  operations: [{ id: "recovery-clip", shotId: "shot-recovery", sourceAssetId: imported.source.artifactId, sourceSegment: { startMs: 0, endMs: 1_200 }, timeline: { startMs: 0, endMs: 1_200 }, role: "a_roll", reason: "恢复同一条已确认的口播片段", evidenceIds: ["shot-recovery"], confidence: 1, status: "accepted" }],
  subtitles: [{ id: "recovery-subtitle", timeline: { startMs: 0, endMs: 1_200 }, text: "恢复同一个冻结方案。" }],
  outputProfile: exchange.DEFAULT_VERTICAL_PROFILE,
  rationale: [{ operationId: "recovery-clip", shotId: "shot-recovery", reason: "不重新调用 AI", confidence: 1 }],
  status: "adopted",
  createdAt: now,
  updatedAt: now,
});
catalog.saveEditProposal(proposal);
const frozen = exchange.freezeEditProposal({ proposal, assetLocks: [{ assetId: imported.source.artifactId, contentHash: imported.source.contentHash }], now });
catalog.saveFrozenEditSpec(frozen);
catalog.saveRenderRun({ schemaVersion: 1, id: renderRunId, projectId, frozenEditSpecId: frozen.id, state: "running", createdAt: now, updatedAt: now });
catalog.insertJob({ schemaVersion: 1, id: jobId, kind: "edit.render", inputHash: "sha256:recovery", state: "queued", attempt: 0, idempotencyKey: renderRunId, idempotencyScope: workspaceId, correlationId: renderRunId, artifactIds: [], createdAt: now, updatedAt: now });

const firstLease = catalog.claimJob(jobId, "render-crash-worker", new Date(now), 1_000);
assert(firstLease, "第一次渲染没有取得 lease");
assert(catalog.heartbeatJob(jobId, "render-crash-worker", firstLease, new Date(now), 1_000), "第一次渲染 heartbeat 失败");
catalog.close();

catalog = new storage.SqliteCatalog(join(metadataDir, "catalog.sqlite"));
const recoveredCount = catalog.recoverExpiredLeases(new Date("2026-08-14T00:00:02.000Z"));
assert(recoveredCount === 1, `启动恢复数量错误：${recoveredCount}`);
assert(catalog.getJob(jobId)?.state === "queued", "过期 lease 没有恢复为 queued");
assert(catalog.getRenderRun(renderRunId)?.state === "running", "恢复不应丢失原 render run");

const failedLease = catalog.claimJob(jobId, "render-failing-worker", new Date("2026-08-14T00:00:03.000Z"), 60_000);
assert(failedLease && catalog.heartbeatJob(jobId, "render-failing-worker", failedLease, new Date("2026-08-14T00:00:03.000Z"), 60_000), "失败尝试没有取得 lease");
assert(catalog.transitionJob(jobId, "running", "failed", failedLease, { lastError: { code: "INJECTED_RENDER_FAILURE", message: "模拟 FFmpeg 进程崩溃", retryable: true } }), "注入失败状态没有持久化");
catalog.saveRenderRun({ ...catalog.getRenderRun(renderRunId), state: "failed", error: { code: "injected_render_failure", message: "模拟 FFmpeg 进程崩溃" }, updatedAt: new Date("2026-08-14T00:00:04.000Z").toISOString() });
assert(catalog.transitionJob(jobId, "failed", "retry_wait", undefined, { retryAfter: "2026-08-14T00:00:04.000Z", lastError: undefined }), "失败任务没有进入 retry_wait");
assert(catalog.transitionJob(jobId, "retry_wait", "queued"), "retry_wait 没有重新排队");

const retryLease = catalog.claimJob(jobId, "render-retry-worker", new Date("2026-08-14T00:00:05.000Z"), 60_000);
assert(retryLease && catalog.heartbeatJob(jobId, "render-retry-worker", retryLease, new Date("2026-08-14T00:00:05.000Z"), 60_000), "重试没有取得 lease");
const retryJob = catalog.getJob(jobId);
assert(retryJob?.attempt === 3, `重试 attempt 应为 3（含崩溃尝试），实际为 ${retryJob?.attempt}`);
const renderId = `${renderRunId}-attempt-${retryJob.attempt}`;
const result = await exchange.exportRenderPackage({
  workspaceRoot: root,
  renderId,
  frozenEditSpec: frozen,
  assets: { [imported.source.artifactId]: { assetId: imported.source.artifactId, relativePath: imported.source.relativePath, absolutePath: join(root, imported.source.relativePath), contentHash: imported.source.contentHash, durationMs: imported.probe.durationMs, hasVideo: true, hasAudio: true } },
});
const outputArtifacts = result.manifest.outputs.map((output) => ({ schemaVersion: 1, artifactId: `artifact-${renderId}-${output.kind}`, workspaceId, kind: `render-${output.kind}`, relativePath: output.relativePath, mimeType: output.mimeType, contentHash: output.contentHash, byteSize: output.byteSize, parentArtifactIds: [imported.source.artifactId], validationStatus: "valid" }));
const manifestStats = await stat(result.manifestPath);
outputArtifacts.push({ schemaVersion: 1, artifactId: `artifact-${renderId}-manifest`, workspaceId, kind: "render-manifest", relativePath: `exports/${renderId}.manifest.json`, mimeType: "application/json", contentHash: result.manifestHash, byteSize: manifestStats.size, parentArtifactIds: [imported.source.artifactId], validationStatus: "valid" });
catalog.insertArtifacts(outputArtifacts);
assert(catalog.transitionJob(jobId, "running", "succeeded", retryLease, { artifactIds: outputArtifacts.map((artifact) => artifact.artifactId), checkpoint: { renderRunId, renderId, manifestHash: result.manifestHash } }), "重试完成状态没有持久化");
catalog.saveRenderRun({ ...catalog.getRenderRun(renderRunId), state: "succeeded", manifestRelativePath: `exports/${renderId}.manifest.json`, manifestHash: result.manifestHash, updatedAt: new Date().toISOString() });
const persistedRun = catalog.getRenderRun(renderRunId);
const persistedJob = catalog.getJob(jobId);
const outputStats = await stat(result.outputPath);
catalog.close();
assert(persistedRun?.frozenEditSpecId === frozen.id, "重试改变了 FrozenEditSpec");
assert(persistedRun?.state === "succeeded" && persistedJob?.state === "succeeded", "重试没有成功收口");
console.log(JSON.stringify({ ok: true, renderRunId, frozenEditSpecId: frozen.id, recoveredLeaseCount: recoveredCount, attempt: persistedJob.attempt, renderId, outputRelativePath: `exports/${renderId}.mp4`, outputByteSize: outputStats.size, manifestHash: result.manifestHash }));

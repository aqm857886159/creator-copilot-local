import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(process.cwd(), ".data", "v6-analysis-recovery-smoke");
const metadataDir = join(root, ".creator-copilot");
const databasePath = join(metadataDir, "catalog.sqlite");
const workspaceId = "workspace-v6-analysis-recovery";
// Use the process clock as the lease CAS compares against the current main-process
// time; offsets below still make crash/restart ordering deterministic.
const now = new Date();
const at = (offsetMs) => new Date(now.getTime() + offsetMs);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

await rm(root, { recursive: true, force: true });
await mkdir(metadataDir, { recursive: true });

const { SqliteCatalog } = await import("../dist-electron/packages/storage/src/catalog.js");
let catalog = new SqliteCatalog(databasePath);
catalog.createWorkspace({ id: workspaceId, name: "V6 analysis recovery", rootPath: root, schemaVersion: 1, defaultLocale: "zh-CN", createdAt: now.toISOString(), updatedAt: now.toISOString() });
catalog.insertJob({ schemaVersion: 1, id: "analysis-crash", kind: "media.analysis", inputHash: "sha256:analysis-crash", state: "queued", attempt: 0, idempotencyKey: "analysis-crash-key", idempotencyScope: workspaceId, providerKey: "local", artifactIds: ["asset-crash"], correlationId: "analysis-run-crash", createdAt: now.toISOString(), updatedAt: now.toISOString() });

const firstLease = catalog.claimJob("analysis-crash", "analysis-crash-worker", now, 1_000);
assert(firstLease, "分析崩溃尝试没有取得 lease");
assert(catalog.heartbeatJob("analysis-crash", "analysis-crash-worker", firstLease, now, 1_000), "分析崩溃尝试 heartbeat 失败");
catalog.close();

catalog = new SqliteCatalog(databasePath);
assert(catalog.recoverExpiredLeases(at(2_000)) === 1, "应用重启没有回收过期分析 lease");
assert(catalog.getJob("analysis-crash")?.state === "queued", "过期分析任务没有恢复为 queued");
assert(!catalog.heartbeatJob("analysis-crash", "analysis-crash-worker", firstLease, at(2_100), 60_000), "旧分析 worker 仍能续租，存在 stale lease 风险");

const retryLease = catalog.claimJob("analysis-crash", "analysis-retry-worker", at(3_000), 60_000);
assert(retryLease && retryLease !== firstLease, "恢复后的分析任务没有生成新的 lease token");
assert(!catalog.transitionJob("analysis-crash", "running", "succeeded", firstLease), "旧分析 worker 仍能写入新尝试");
assert(catalog.heartbeatJob("analysis-crash", "analysis-retry-worker", retryLease, at(3_000), 60_000), "恢复后的分析任务 heartbeat 失败");
assert(catalog.transitionJob("analysis-crash", "running", "failed", retryLease, { lastError: { code: "INJECTED_ANALYSIS_FAILURE", message: "模拟本地分析 worker 崩溃", retryable: true } }), "分析失败状态没有持久化");
assert(catalog.transitionJob("analysis-crash", "failed", "retry_wait", undefined, { retryAfter: at(4_000).toISOString(), lastError: undefined }), "分析失败没有进入 retry_wait");
assert(catalog.transitionJob("analysis-crash", "retry_wait", "queued"), "分析 retry_wait 没有重新排队");
const finalLease = catalog.claimJob("analysis-crash", "analysis-final-worker", at(5_000), 60_000);
assert(finalLease && catalog.getJob("analysis-crash")?.attempt === 3, "分析重试 attempt 没有按尝试次数递增");
assert(catalog.heartbeatJob("analysis-crash", "analysis-final-worker", finalLease, at(5_000), 60_000), "最终分析尝试 heartbeat 失败");
assert(catalog.transitionJob("analysis-crash", "running", "succeeded", finalLease, { checkpoint: { factIds: ["fact-shot-1"], shotCount: 1 } }), "分析成功状态没有持久化");
const completed = catalog.getJob("analysis-crash");
assert(completed?.state === "succeeded" && !completed.leaseToken && !completed.workerId, "分析终态仍残留 worker lease");

catalog.insertJob({ schemaVersion: 1, id: "analysis-cancel", kind: "media.analysis", inputHash: "sha256:analysis-cancel", state: "queued", attempt: 0, idempotencyKey: "analysis-cancel-key", idempotencyScope: workspaceId, providerKey: "local", artifactIds: ["asset-cancel"], correlationId: "analysis-run-cancel", createdAt: now.toISOString(), updatedAt: now.toISOString() });
const cancelLease = catalog.claimJob("analysis-cancel", "analysis-cancel-worker", at(6_000), 60_000);
assert(cancelLease && catalog.heartbeatJob("analysis-cancel", "analysis-cancel-worker", cancelLease, at(6_000), 60_000), "取消分析尝试 heartbeat 失败");
assert(catalog.transitionJob("analysis-cancel", "running", "cancelled", cancelLease, { lastError: { code: "MEDIA_ANALYSIS_CANCELLED", message: "用户取消分析", retryable: false } }), "用户取消分析没有持久化");
const cancelled = catalog.getJob("analysis-cancel");
assert(cancelled?.state === "cancelled" && !cancelled.leaseToken && !cancelled.workerId, "取消后的分析任务仍残留 lease");

catalog.close();
console.log(JSON.stringify({ ok: true, workflow: ["worker-crash", "restart-recover", "stale-lease-reject", "retry", "cancel"], jobs: { recovered: "analysis-crash", finalState: completed?.state, attempts: completed?.attempt, cancelled: cancelled?.state } }));

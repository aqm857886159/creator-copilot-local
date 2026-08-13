import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SqliteCatalog } from "./catalog";
import type { JobRecord } from "../../contracts/src/index";
import { ScriptSchema, createShootTasks, createStoryboard, type Take } from "../../creation/src/index";
import { DEFAULT_VERTICAL_PROFILE, EditProposalSchema, freezeEditProposal } from "../../exchange/src/index";
import { transcriptFacts, parseWhisperJson } from "../../analysis/src/index";
import { AccountResearchReportSchema, TopicRadarReportSchema } from "../../research/src/index";
import { MetricSnapshotSchema, proposeReviewMemory } from "../../publishing/src/index";

function fixtureJob(overrides: Partial<JobRecord> = {}): JobRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: "job-1",
    kind: "media.proxy",
    inputHash: "sha256:input",
    state: "queued",
    attempt: 0,
    idempotencyKey: "job-idem-1",
    idempotencyScope: "workspace-1",
    correlationId: "corr-1",
    artifactIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("SqliteCatalog", () => {
  it("migrates, persists facts, and restores from a copied database", () => {
    const root = mkdtempSync(join(tmpdir(), "creator-copilot-catalog-"));
    const dbPath = join(root, "catalog.sqlite");
    const copyPath = join(root, "catalog-copy.sqlite");
    const catalog = new SqliteCatalog(dbPath);
    const now = new Date().toISOString();
    catalog.createWorkspace({ id: "workspace-1", name: "测试工作区", rootPath: root, schemaVersion: 1, defaultLocale: "zh-CN", createdAt: now, updatedAt: now });
    catalog.createProject({ id: "project-1", workspaceId: "workspace-1", title: "测试项目", stage: "script", revision: 1, payload: { source: "fixture" }, createdAt: now, updatedAt: now });
    catalog.insertArtifact({ schemaVersion: 1, artifactId: "artifact-1", workspaceId: "workspace-1", kind: "proxy", relativePath: "derived/proxy.mp4", mimeType: "video/mp4", contentHash: "sha256:proxy", byteSize: 12, parentArtifactIds: [], validationStatus: "valid" });
    expect(catalog.schemaVersion()).toBe(8);
    expect(catalog.getProject("project-1")?.payload).toEqual({ source: "fixture" });
    expect(catalog.getArtifact("artifact-1")?.relativePath).toBe("derived/proxy.mp4");
    expect(catalog.updateProject("project-1", 0, { title: "不应覆盖" })).toBe(false);
    expect(catalog.updateProject("project-1", 1, { stage: "shoot" })).toBe(true);
    expect(catalog.getProject("project-1")?.revision).toBe(2);
    catalog.saveReceipt({ idempotencyScope: "workspace-1", idempotencyKey: "command-1", inputHash: "sha256:input", receipt: {
      schemaVersion: 1, commandId: "command-1", correlationId: "corr-1", status: "accepted", target: { type: "project", id: "project-1" }, newRevision: 2, eventIds: [], jobIds: [], artifactIds: [], approvalRequired: false,
    }});
    catalog.appendEvent({ id: "event-1", aggregateType: "project", aggregateId: "project-1", aggregateRevision: 2, type: "project.updated", payload: { stage: "shoot" }, actorType: "user", correlationId: "corr-1", occurredAt: now });
    expect(catalog.getReceipt("workspace-1", "command-1")?.receipt.status).toBe("accepted");
    catalog.checkpoint();
    catalog.close();
    const bytes = readFileSync(dbPath);
    writeFileSync(copyPath, bytes);
    const restored = new SqliteCatalog(copyPath);
    expect(restored.getWorkspace("workspace-1")?.name).toBe("测试工作区");
    restored.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("claims jobs once, heartbeats, and recovers expired local leases", () => {
    const root = mkdtempSync(join(tmpdir(), "creator-copilot-jobs-"));
    const catalog = new SqliteCatalog(join(root, "catalog.sqlite"));
    catalog.insertJob(fixtureJob());
    catalog.enqueueOutbox({ id: "outbox-1", kind: "project.updated", payload: { projectId: "project-1" }, idempotencyKey: "outbox-key", idempotencyScope: "workspace-1", state: "queued", attempt: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const now = new Date("2026-08-14T00:00:00.000Z");
    const leaseToken = catalog.claimJob("job-1", "worker-a", now, 1000);
    expect(leaseToken).toEqual(expect.any(String));
    expect(catalog.claimJob("job-1", "worker-b", now, 1000)).toBeNull();
    const outboxLeaseToken = catalog.claimOutbox("outbox-1", "worker-a", now, 1000);
    expect(outboxLeaseToken).toEqual(expect.any(String));
    expect(catalog.claimOutbox("outbox-1", "worker-b", now, 1000)).toBeNull();
    expect(catalog.markOutboxSent("outbox-1", "worker-a", outboxLeaseToken! as string, new Date("2026-08-14T00:00:00.500Z"))).toBe(true);
    expect(catalog.recoverExpiredOutboxClaims(new Date("2026-08-14T00:00:02.000Z"))).toBe(0);
    expect(catalog.heartbeatJob("job-1", "worker-a", leaseToken! as string, new Date("2026-08-14T00:00:00.500Z"), 1000)).toBe(true);
    expect(catalog.recoverExpiredLeases(new Date("2026-08-14T00:00:02.000Z"))).toBe(1);
    expect(catalog.getJob("job-1")?.state).toBe("queued");
    catalog.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("fences stale workers and rejects changed receipt inputs", () => {
    const root = mkdtempSync(join(tmpdir(), "creator-copilot-fence-"));
    const catalog = new SqliteCatalog(join(root, "catalog.sqlite"));
    catalog.insertJob(fixtureJob());
    const first = catalog.claimJob("job-1", "worker-a", new Date("2026-08-14T00:00:00.000Z"), 1000)!;
    catalog.recoverExpiredLeases(new Date("2026-08-14T00:00:01.000Z"));
    const second = catalog.claimJob("job-1", "worker-b", new Date("2026-08-14T00:00:02.000Z"), 1000)!;
    expect(second).not.toBe(first);
    expect(catalog.heartbeatJob("job-1", "worker-a", first, new Date("2026-08-14T00:00:02.100Z"), 1000)).toBe(false);
    expect(catalog.heartbeatJob("job-1", "worker-b", second, new Date("2026-08-14T00:00:02.100Z"), 1000)).toBe(true);
    const accepted = { schemaVersion: 1 as const, commandId: "cmd-a", correlationId: "corr-a", status: "accepted" as const, target: { type: "project", id: "project-1" }, eventIds: [], jobIds: [], artifactIds: [], approvalRequired: false };
    catalog.saveReceipt({ idempotencyScope: "scope", idempotencyKey: "key", inputHash: "hash-a", receipt: accepted });
    expect(() => catalog.saveReceipt({ idempotencyScope: "scope", idempotencyKey: "key", inputHash: "hash-b", receipt: { ...accepted, commandId: "cmd-b" } })).toThrow("IDEMPOTENCY_KEY_REUSE");
    catalog.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps recovery transitions reachable after clearing a worker lease", () => {
    const root = mkdtempSync(join(tmpdir(), "creator-copilot-recovery-"));
    const catalog = new SqliteCatalog(join(root, "catalog.sqlite"));
    const now = new Date();
    catalog.insertJob(fixtureJob({ id: "recovery-job", idempotencyKey: "recovery-key" }));
    const leaseToken = catalog.claimJob("recovery-job", "worker-a", now, 60_000);
    expect(leaseToken).toEqual(expect.any(String));
    expect(catalog.heartbeatJob("recovery-job", "worker-a", leaseToken!, now, 60_000)).toBe(true);
    expect(catalog.transitionJob("recovery-job", "running", "retry_wait", leaseToken!, { retryAfter: new Date(now.getTime() + 1_000).toISOString() })).toBe(true);
    expect(catalog.getJob("recovery-job")?.leaseToken).toBeUndefined();
    expect(catalog.transitionJob("recovery-job", "retry_wait", "queued")).toBe(true);
    expect(catalog.getJob("recovery-job")?.state).toBe("queued");
    catalog.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("commits domain facts, events, outbox, and receipt atomically", () => {
    const root = mkdtempSync(join(tmpdir(), "creator-copilot-command-"));
    const catalog = new SqliteCatalog(join(root, "catalog.sqlite"));
    const now = new Date().toISOString();
    catalog.createWorkspace({ id: "workspace-1", name: "测试工作区", rootPath: root, schemaVersion: 1, defaultLocale: "zh-CN", createdAt: now, updatedAt: now });
    const command = {
      schemaVersion: 1 as const,
      commandId: "cmd-create-project",
      name: "project.create",
      target: { type: "project", id: "project-atomic" },
      actor: { type: "user" as const, id: "user-1" },
      idempotencyKey: "idem-atomic",
      idempotencyScope: "workspace-1",
      correlationId: "corr-atomic",
      input: { title: "原子项目" },
    };
    let handlerCalls = 0;
    const first = catalog.executeCommand(command, () => {
      handlerCalls += 1;
      catalog.createProject({ id: "project-atomic", workspaceId: "workspace-1", title: "原子项目", stage: "script", revision: 1, payload: {}, createdAt: now, updatedAt: now });
      return {
        receipt: { schemaVersion: 1, commandId: command.commandId, correlationId: command.correlationId, status: "accepted", target: command.target, newRevision: 1, eventIds: ["event-atomic"], jobIds: [], artifactIds: [], approvalRequired: false },
        events: [{ id: "event-atomic", aggregateType: "project", aggregateId: "project-atomic", aggregateRevision: 1, type: "project.created", payload: {}, actorType: "user", correlationId: command.correlationId, occurredAt: now }],
        outbox: [{ id: "outbox-atomic", kind: "project.created", payload: { projectId: "project-atomic" }, idempotencyKey: "outbox-atomic", idempotencyScope: "workspace-1", state: "queued", attempt: 0, createdAt: now, updatedAt: now }],
      };
    });
    expect(first.status).toBe("accepted");
    expect(catalog.getProject("project-atomic")?.title).toBe("原子项目");
    expect(catalog.executeCommand({ ...command, commandId: "cmd-create-project-retry" }, () => { handlerCalls += 1; throw new Error("不应重复执行"); }).status).toBe("duplicate");
    expect(handlerCalls).toBe(1);

    const rollbackCommand = { ...command, commandId: "cmd-rollback", idempotencyKey: "idem-rollback", target: { type: "project", id: "project-rollback" } };
    expect(() => catalog.executeCommand(rollbackCommand, () => {
      catalog.createProject({ id: "project-rollback", workspaceId: "workspace-1", title: "回滚项目", stage: "script", revision: 1, payload: {}, createdAt: now, updatedAt: now });
      throw new Error("模拟崩溃");
    })).toThrow("模拟崩溃");
    expect(catalog.getProject("project-rollback")).toBeUndefined();
    catalog.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects symlink escape and upgrades a legacy v1 lease schema", () => {
    const root = mkdtempSync(join(tmpdir(), "creator-copilot-legacy-"));
    const outside = mkdtempSync(join(tmpdir(), "creator-copilot-outside-"));
    const dbPath = join(root, "catalog.sqlite");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE schema_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      INSERT INTO schema_meta(key, value) VALUES ('schema_version', '1');
      CREATE TABLE workspaces (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, root_path TEXT NOT NULL, schema_version INTEGER NOT NULL, default_locale TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE jobs (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, input_hash TEXT NOT NULL, state TEXT NOT NULL, attempt INTEGER NOT NULL, idempotency_key TEXT NOT NULL, idempotency_scope TEXT NOT NULL, provider_key TEXT, external_job_id TEXT, worker_id TEXT, lease_expires_at TEXT, heartbeat_at TEXT, retry_after TEXT, checkpoint_json TEXT, source_run_id TEXT, correlation_id TEXT NOT NULL, artifact_ids_json TEXT NOT NULL, last_error_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (idempotency_scope, idempotency_key));
      CREATE TABLE artifacts (artifact_id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, relative_path TEXT NOT NULL, mime_type TEXT NOT NULL, content_hash TEXT NOT NULL, byte_size INTEGER NOT NULL, parent_artifact_ids_json TEXT NOT NULL, source_revision INTEGER, validation_status TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (workspace_id, relative_path));
    `);
    legacy.close();
    const catalog = new SqliteCatalog(dbPath);
    expect(catalog.schemaVersion()).toBe(8);
    catalog.insertJob(fixtureJob({ id: "legacy-job", idempotencyKey: "legacy-job-key" }));
    catalog.enqueueOutbox({ id: "legacy-outbox", kind: "legacy", payload: {}, idempotencyKey: "legacy-outbox-key", idempotencyScope: "workspace-1", state: "queued", attempt: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    catalog.createWorkspace({ id: "workspace-1", name: "工作区", rootPath: root, schemaVersion: 1, defaultLocale: "zh-CN", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    symlinkSync(outside, join(root, "outside-link"));
    expect(() => catalog.insertArtifact({ schemaVersion: 1, artifactId: "escape", workspaceId: "workspace-1", kind: "source", relativePath: "outside-link/video.mp4", mimeType: "video/mp4", contentHash: "sha256:x", byteSize: 1, parentArtifactIds: [], validationStatus: "pending" })).toThrow("资产真实路径越过工作区");
    catalog.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("persists script, storyboard, capture tasks, and multiple take selection", () => {
    const root = mkdtempSync(join(tmpdir(), "creator-copilot-creation-store-"));
    const dbPath = join(root, "catalog.sqlite");
    const catalog = new SqliteCatalog(dbPath);
    const now = "2026-08-14T00:00:00.000Z";
    catalog.createWorkspace({ id: "workspace-creation", name: "创作工作区", rootPath: root, schemaVersion: 1, defaultLocale: "zh-CN", createdAt: now, updatedAt: now });
    catalog.createProject({ id: "project-creation", workspaceId: "workspace-creation", title: "观点视频", stage: "script", revision: 1, payload: {}, createdAt: now, updatedAt: now });
    const script = ScriptSchema.parse({ schemaVersion: 1, id: "script-creation", projectId: "project-creation", revision: 1, status: "approved", blocks: [{ schemaVersion: 1, id: "block-creation", order: 0, kind: "claim", text: "表达需要画面变化。", emphasis: [], evidenceIds: [], visualNeed: "must_show" }], estimatedDurationMs: 5_000, createdAt: now, updatedAt: now });
    expect(catalog.saveScript(script)).toBe(true);
    expect(catalog.saveScript(script)).toBe(false);
    const storyboard = createStoryboard({ id: "storyboard-creation", script, createdAt: now, shots: [{ id: "shot-creation", order: 0, scriptBlockIds: ["block-creation"], purpose: "explain", mode: "talking_head", actionDescription: "面对镜头说出观点。", targetMs: 5_000, sourceRequirement: "shoot_task" }] });
    expect(catalog.saveStoryboard(storyboard)).toBe(true);
    const task = createShootTasks(storyboard, now)[0];
    catalog.saveShootTask(task);
    catalog.saveCapturePackage({ schemaVersion: 1, id: "capture-creation", projectId: "project-creation", storyboardRevision: 1, format: "html", relativePath: "capture-packages/capture-creation/index.html", taskIds: [task.id], status: "ready", createdAt: now, updatedAt: now });
    for (const index of [1, 2]) {
      catalog.insertArtifact({ schemaVersion: 1, artifactId: `artifact-take-${index}`, workspaceId: "workspace-creation", kind: "source", relativePath: `originals/take-${index}.mp4`, mimeType: "video/mp4", contentHash: `sha256:take-${index}`, byteSize: index, parentArtifactIds: [], validationStatus: "valid" });
      const take: Take = { schemaVersion: 1, id: `take-${index}`, shootTaskId: task.id, assetId: `artifact-take-${index}`, relativePath: `originals/take-${index}.mp4`, status: "candidate", createdAt: now, updatedAt: now };
      expect(catalog.addTake(take)).toBe(true);
    }
    expect(catalog.listTakes(task.id)).toHaveLength(2);
    const selected = catalog.selectTakeForTask(task.id, "take-2");
    expect(selected.takes.find((take) => take.id === "take-2")?.status).toBe("selected");
    expect(catalog.getShootTask(task.id)?.status).toBe("accepted");
    const proposal = EditProposalSchema.parse({ schemaVersion: 1, id: "proposal-creation", projectId: "project-creation", basedOn: { scriptRevision: 1, storyboardRevision: 1 }, durationMs: 1000, operations: [{ id: "operation-creation", shotId: "shot-creation", sourceAssetId: "artifact-take-2", sourceSegment: { startMs: 0, endMs: 1000 }, timeline: { startMs: 0, endMs: 1000 }, role: "a_roll", reason: "保持口播连续", evidenceIds: ["shot-creation"], confidence: 0.9, status: "suggested" }], subtitles: [{ id: "subtitle-creation", timeline: { startMs: 0, endMs: 1000 }, text: "表达需要画面变化。" }], outputProfile: DEFAULT_VERTICAL_PROFILE, rationale: [{ operationId: "operation-creation", shotId: "shot-creation", reason: "对应口播主线", confidence: 0.9 }], status: "previewed", createdAt: now, updatedAt: now });
    expect(catalog.saveEditProposal(proposal)).toBe(true);
    expect(catalog.getEditProposal(proposal.id)?.operations[0].shotId).toBe("shot-creation");
    const frozen = freezeEditProposal({ proposal, assetLocks: [{ assetId: "artifact-take-2", contentHash: "sha256:take-2" }], now });
    expect(catalog.saveFrozenEditSpec(frozen)).toBe(true);
    expect(catalog.getFrozenEditSpec(frozen.id)?.authoredSpecHash).toBe(frozen.authoredSpecHash);
    catalog.saveRenderRun({ schemaVersion: 1, id: "render-run-creation", projectId: "project-creation", frozenEditSpecId: frozen.id, state: "running", createdAt: now, updatedAt: now });
    catalog.saveRenderRun({ schemaVersion: 1, id: "render-run-creation", projectId: "project-creation", frozenEditSpecId: frozen.id, state: "succeeded", manifestRelativePath: "exports/render.manifest.json", manifestHash: "sha256:manifest", createdAt: now, updatedAt: now });
    expect(catalog.getRenderRun("render-run-creation")).toMatchObject({ state: "succeeded", manifestHash: "sha256:manifest" });
    const publication = catalog.savePublication({ schemaVersion: 1, id: "publication-creation", projectId: "project-creation", packageId: "publish-render-run-creation", platform: "抖音", status: "published", publishedAt: now, createdAt: now, updatedAt: now });
    const metrics = MetricSnapshotSchema.parse({ schemaVersion: 1, id: "metric-creation", publicationId: publication.id, capturedAt: now, window: "24h", source: "manual", metrics: { views: 1200, likes: 90, comments: 12, shares: 8, saves: 11, completionRate: 0.38, averageWatchSeconds: 16, newFollowers: 5 }, notes: "手动录入" });
    catalog.saveMetricSnapshot(metrics);
    const memory = proposeReviewMemory({ workspaceId: "workspace-creation", sourcePublicationIds: [publication.id], snapshots: [metrics], statement: "先讲具体经验再给结论，完播表现值得继续验证。", appliesTo: { formats: ["真人深度口播"], platforms: ["抖音"] }, now });
    catalog.saveReviewMemoryProposal(memory);
    expect(catalog.getMetricSnapshot(metrics.id)?.metrics.views).toBe(1200);
    expect(catalog.getReviewMemoryProposal(memory.id)?.status).toBe("candidate");
    expect(catalog.confirmReviewMemoryProposal(memory.id, now)).toBe(true);
    expect(catalog.getReviewMemoryProposal(memory.id)?.status).toBe("confirmed");
    const analysisSegments = parseWhisperJson({ segments: [{ start: 0, end: 1.2, text: "观点需要画面证据" }, { start: 1.2, end: 2.4, text: "素材库可以搜索" }] });
    catalog.saveAnalysisFacts(transcriptFacts({ workspaceId: "workspace-creation", artifactId: "artifact-take-2", segments: analysisSegments, providerKey: "whisper.cpp", modelKey: "ggml-small", contentHash: "sha256:take-2", createdAt: now }));
    expect(catalog.searchAnalysisFacts({ workspaceId: "workspace-creation", query: "素材库" })[0]?.text).toContain("素材库");
    expect(catalog.searchAnalysisFacts({ workspaceId: "workspace-creation", query: "观点", kind: "transcript" })).toHaveLength(1);
    const report = AccountResearchReportSchema.parse({ schemaVersion: 1, id: "research-creation", workspaceId: "workspace-creation", providerKey: "tikhub", sourceInput: "https://www.douyin.com/user/fixture", secUserId: "MS4wLjABAAAAfixture", profile: { nickname: "参考账号", followerCount: 1000 }, videos: [], coverage: { requested: 20, received: 0, metadataAnalyzed: 0, mediaAnalyzed: 0, missingMedia: 0, hasMore: false, note: "metadata only" }, findings: [], evidence: [], createdAt: now });
    catalog.saveResearchReport(report);
    expect(catalog.getResearchReport(report.id)?.profile.nickname).toBe("参考账号");
    const topicReport = TopicRadarReportSchema.parse({ schemaVersion: 1, id: "topic-radar-creation", workspaceId: "workspace-creation", providerKey: "tikhub", query: { schemaVersion: 1, sources: ["low_fan"], keyword: "深度口播", dateWindow: 24, pageSize: 2 }, quote: { schemaVersion: 1, id: "topic-quote-creation", workspaceId: "workspace-creation", query: { schemaVersion: 1, sources: ["low_fan"], keyword: "深度口播", dateWindow: 24, pageSize: 2 }, lines: [{ source: "low_fan", endpoint: "/api/v1/douyin/billboard/fetch_hot_total_low_fan_list", costUsd: 0.001 }], totalCostUsd: 0.001, currency: "USD", quotedAt: now, expiresAt: "2026-08-14T00:10:00.000Z" }, status: "completed", signals: [], opportunities: [], runs: [{ schemaVersion: 1, source: "low_fan", endpoint: "/api/v1/douyin/billboard/fetch_hot_total_low_fan_list", jobId: "job-topic", quotedCostUsd: 0.001, status: "succeeded", itemCount: 0 }], createdAt: now });
    catalog.saveTopicRadarReport(topicReport);
    expect(catalog.listTopicRadarReports("workspace-creation")).toHaveLength(1);
    catalog.close();
    const restored = new SqliteCatalog(dbPath);
    expect(restored.getScript(script.id)?.blocks[0].text).toContain("画面变化");
    expect(restored.getStoryboard(storyboard.id)?.shots[0].selectedTakeId).toBeUndefined();
    expect(restored.getCapturePackage("capture-creation")?.status).toBe("ready");
    expect(restored.getTake("take-2")?.status).toBe("selected");
    expect(restored.getEditProposal("proposal-creation")?.status).toBe("previewed");
    expect(restored.getRenderRun("render-run-creation")?.state).toBe("succeeded");
    expect(restored.listPublications("project-creation")).toHaveLength(1);
    expect(restored.listMetricSnapshots(publication.id)).toHaveLength(1);
    expect(restored.getReviewMemoryProposal(memory.id)?.status).toBe("confirmed");
    expect(restored.searchAnalysisFacts({ workspaceId: "workspace-creation", query: "画面" })).toHaveLength(1);
    expect(restored.listResearchReports("workspace-creation")).toHaveLength(1);
    expect(restored.getTopicRadarReport("topic-radar-creation")?.status).toBe("completed");
    restored.close();
    rmSync(root, { recursive: true, force: true });
  });
});

import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SqliteCatalog } from "./catalog";
import type { JobRecord } from "../../contracts/src/index";

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
    expect(catalog.schemaVersion()).toBe(2);
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
    expect(catalog.schemaVersion()).toBe(2);
    catalog.insertJob(fixtureJob({ id: "legacy-job", idempotencyKey: "legacy-job-key" }));
    catalog.enqueueOutbox({ id: "legacy-outbox", kind: "legacy", payload: {}, idempotencyKey: "legacy-outbox-key", idempotencyScope: "workspace-1", state: "queued", attempt: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    catalog.createWorkspace({ id: "workspace-1", name: "工作区", rootPath: root, schemaVersion: 1, defaultLocale: "zh-CN", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    symlinkSync(outside, join(root, "outside-link"));
    expect(() => catalog.insertArtifact({ schemaVersion: 1, artifactId: "escape", workspaceId: "workspace-1", kind: "source", relativePath: "outside-link/video.mp4", mimeType: "video/mp4", contentHash: "sha256:x", byteSize: 1, parentArtifactIds: [], validationStatus: "pending" })).toThrow("资产真实路径越过工作区");
    catalog.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});

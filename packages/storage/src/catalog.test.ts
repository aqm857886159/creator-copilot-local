import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(catalog.schemaVersion()).toBe(1);
    expect(catalog.getProject("project-1")?.payload).toEqual({ source: "fixture" });
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
    const now = new Date("2026-08-14T00:00:00.000Z");
    expect(catalog.claimJob("job-1", "worker-a", now, 1000)).toBe(true);
    expect(catalog.claimJob("job-1", "worker-b", now, 1000)).toBe(false);
    expect(catalog.heartbeatJob("job-1", "worker-a", new Date("2026-08-14T00:00:00.500Z"), 1000)).toBe(true);
    expect(catalog.recoverExpiredLeases(new Date("2026-08-14T00:00:02.000Z"))).toBe(1);
    expect(catalog.getJob("job-1")?.state).toBe("queued");
    catalog.close();
    rmSync(root, { recursive: true, force: true });
  });
});

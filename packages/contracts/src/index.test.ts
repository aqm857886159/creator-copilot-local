import { describe, expect, it } from "vitest";
import {
  ArtifactManifestSchema,
  CommandEnvelopeSchema,
  CommandReceiptSchema,
  InMemoryCommandRegistry,
  assertJobTransition,
  canTransitionJob,
  isSafeWorkspaceRelativePath,
} from "./index";

const baseCommand = {
  schemaVersion: 1 as const,
  commandId: "cmd-1",
  name: "project.create",
  target: { type: "workspace", id: "workspace-1" },
  actor: { type: "user" as const, id: "user-1" },
  idempotencyKey: "idem-1",
  idempotencyScope: "workspace-1",
  correlationId: "corr-1",
  input: { title: "测试项目" },
};

const receipt = {
  schemaVersion: 1 as const,
  commandId: "cmd-1",
  correlationId: "corr-1",
  status: "accepted" as const,
  target: { type: "workspace", id: "workspace-1" },
  newRevision: 1,
  eventIds: ["event-1"],
  jobIds: [],
  artifactIds: [],
  approvalRequired: false,
};

describe("versioned command contracts", () => {
  it("rejects unknown fields and validates receipts", () => {
    expect(CommandEnvelopeSchema.safeParse({ ...baseCommand, unexpected: true }).success).toBe(false);
    expect(CommandReceiptSchema.parse(receipt).status).toBe("accepted");
  });

  it("deduplicates the same command and rejects changed input", async () => {
    const registry = new InMemoryCommandRegistry();
    let calls = 0;
    registry.register("project.create", () => {
      calls += 1;
      return receipt;
    });
    await expect(registry.execute(baseCommand)).resolves.toMatchObject({ status: "accepted" });
    await expect(registry.execute(baseCommand)).resolves.toMatchObject({ status: "duplicate" });
    await expect(registry.execute({ ...baseCommand, input: { title: "另一个项目" } })).rejects.toThrow("幂等键");
    expect(calls).toBe(1);
  });
});

describe("job and artifact boundaries", () => {
  it("allows recoverable job transitions and rejects terminal rewrites", () => {
    expect(canTransitionJob("running", "retry_wait")).toBe(true);
    expect(canTransitionJob("succeeded", "running")).toBe(false);
    expect(() => assertJobTransition("succeeded", "running")).toThrow("非法任务状态迁移");
  });

  it("rejects absolute and parent-traversing artifact paths", () => {
    expect(isSafeWorkspaceRelativePath("derived/proxy.mp4")).toBe(true);
    expect(isSafeWorkspaceRelativePath("../outside.mp4")).toBe(false);
    expect(ArtifactManifestSchema.safeParse({
      schemaVersion: 1,
      artifactId: "artifact-1",
      workspaceId: "workspace-1",
      kind: "proxy",
      relativePath: "/tmp/proxy.mp4",
      mimeType: "video/mp4",
      contentHash: "sha256:abc",
      byteSize: 10,
      parentArtifactIds: [],
      validationStatus: "valid",
    }).success).toBe(false);
  });
});

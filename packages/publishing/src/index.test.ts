import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MetricSnapshotSchema, exportPublishPackage, proposeReviewMemory } from "./index";

describe("manual publishing and review contracts", () => {
  it("exports a local package with hashes and a manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "creator-copilot-publish-"));
    await mkdir(join(root, "exports"), { recursive: true });
    await writeFile(join(root, "exports", "video.mp4"), "video-bytes");
    await writeFile(join(root, "exports", "video.srt"), "1\n00:00:00,000 --> 00:00:01,000\n观点\n");
    await writeFile(join(root, "exports", "video.manifest.json"), "{\"renderId\":\"render-1\"}\n");
    const result = await exportPublishPackage({ workspaceRoot: root, packageId: "package-1", projectId: "project-1", renderRunId: "render-run-1", platform: "抖音", title: "把观点讲清楚", description: "一条深度口播", hashtags: ["#表达", "表达"], rightsNote: "自有素材", sourceArtifactIds: ["artifact-video"], sourceFiles: { video: join(root, "exports", "video.mp4"), subtitle: join(root, "exports", "video.srt"), manifest: join(root, "exports", "video.manifest.json") }, createdAt: "2026-08-14T00:00:00.000Z" });
    expect(result.manifest.files.map((file) => file.kind)).toEqual(["video", "subtitle", "manifest"]);
    expect(result.manifest.hashtags).toEqual(["表达"]);
    expect(await readFile(result.manifestPath, "utf8")).toContain("package-1");
  });

  it("requires metric evidence before proposing creator memory", () => {
    const snapshot = MetricSnapshotSchema.parse({ schemaVersion: 1, id: "metric-1", publicationId: "publication-1", capturedAt: "2026-08-14T01:00:00.000Z", window: "24h", source: "manual", metrics: { views: 1000, likes: 80, comments: 12, shares: 5, saves: 9, completionRate: 0.42, averageWatchSeconds: 18, newFollowers: 4 }, notes: "手动录入" });
    const proposal = proposeReviewMemory({ workspaceId: "workspace-1", sourcePublicationIds: ["publication-1"], snapshots: [snapshot], statement: "这条内容的观点先行结构在 24 小时内保持了较好的完播表现。", appliesTo: { formats: ["真人深度口播"], platforms: ["抖音"] }, now: "2026-08-14T02:00:00.000Z" });
    expect(proposal).toMatchObject({ status: "candidate", evidenceSnapshotIds: ["metric-1"], confidence: 0.63 });
    expect(() => proposeReviewMemory({ workspaceId: "workspace-1", sourcePublicationIds: ["publication-1"], snapshots: [], statement: "没有证据也应该记住" })).toThrow("至少需要一条指标证据");
  });
});

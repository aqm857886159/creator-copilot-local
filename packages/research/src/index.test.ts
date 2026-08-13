import { describe, expect, it } from "vitest";
import { buildAccountResearchReport } from "./index";

describe("benchmark account research", () => {
  it("builds a metadata-first evidence report with explicit coverage", async () => {
    const connector = {
      providerKey: "tikhub",
      resolveSecUserId: async () => "MS4wLjABAAAAfixture",
      fetchProfile: async () => ({ secUserId: "MS4wLjABAAAAfixture", nickname: "参考账号", followerCount: 1000, raw: {} }),
      fetchUserPosts: async () => ({ providerKey: "tikhub" as const, source: "public" as const, fetchedAt: "2026-08-14T00:00:00.000Z", cursor: 0, hasMore: true, responseHash: "sha256:posts", items: [{ awemeId: "aweme-1", description: "一个观点", createTime: "2026-08-13T00:00:00.000Z", durationMs: 12_000, statistics: { digg_count: 42 }, raw: {} }] }),
    };
    const report = await buildAccountResearchReport({ workspaceId: "workspace-1", sourceInput: "https://www.douyin.com/user/fixture", connector, count: 20, now: "2026-08-14T00:00:00.000Z" });
    expect(report).toMatchObject({ providerKey: "tikhub", secUserId: "MS4wLjABAAAAfixture", coverage: { requested: 20, received: 1, mediaAnalyzed: 0, missingMedia: 1, hasMore: true }, videos: [{ awemeId: "aweme-1", mediaAnalysisStatus: "metadata_only" }] });
    expect(report.evidence.some((evidence) => evidence.type === "coverage")).toBe(true);
  });

  it("rejects an unbounded first request", async () => {
    await expect(buildAccountResearchReport({ workspaceId: "workspace-1", sourceInput: "fixture", connector: { providerKey: "tikhub", resolveSecUserId: async () => "id", fetchProfile: async () => ({ secUserId: "id", raw: {} }), fetchUserPosts: async () => ({ providerKey: "tikhub", source: "public", fetchedAt: "2026-08-14T00:00:00.000Z", cursor: 0, hasMore: false, items: [], responseHash: "sha256:x" }) }, count: 21 })).rejects.toThrow("1–20");
  });
});

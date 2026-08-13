import { describe, expect, it } from "vitest";
import { attachResearchAnalysis, attachResearchMedia, buildAccountResearchReport, createTopicRadarQuote, createTopicRadarReport, normalizeTopicRadarQuery } from "./index";

describe("benchmark account research", () => {
  it("builds a metadata-first evidence report with explicit coverage", async () => {
    const connector = {
      providerKey: "tikhub",
      resolveSecUserId: async () => "MS4wLjABAAAAfixture",
      fetchProfile: async () => ({ secUserId: "MS4wLjABAAAAfixture", nickname: "参考账号", followerCount: 1000, raw: {} }),
      fetchUserPosts: async () => ({ providerKey: "tikhub" as const, source: "public" as const, fetchedAt: "2026-08-14T00:00:00.000Z", cursor: 0, hasMore: true, responseHash: "sha256:posts", items: [{ awemeId: "aweme-1", description: "一个观点", createTime: "2026-08-13T00:00:00.000Z", durationMs: 12_000, statistics: { digg_count: 42 }, raw: {} }] }),
      fetchHighestQualityPlayUrl: async () => ({ awemeId: "aweme-1", url: "https://cdn.example/video.mp4", responseHash: "sha256:download" }),
    };
    const report = await buildAccountResearchReport({ workspaceId: "workspace-1", sourceInput: "https://www.douyin.com/user/fixture", connector, count: 20, now: "2026-08-14T00:00:00.000Z" });
    expect(report).toMatchObject({ providerKey: "tikhub", secUserId: "MS4wLjABAAAAfixture", coverage: { requested: 20, received: 1, mediaAnalyzed: 0, missingMedia: 1, hasMore: true }, videos: [{ awemeId: "aweme-1", mediaAnalysisStatus: "metadata_only" }] });
    expect(report.evidence.some((evidence) => evidence.type === "coverage")).toBe(true);
    const attached = attachResearchMedia(report, [{ awemeId: "aweme-1", artifactIds: ["source-1", "proxy-1"], attachedAt: "2026-08-14T00:01:00.000Z" }]);
    expect(attached.videos[0]).toMatchObject({ mediaAnalysisStatus: "queued", artifactIds: ["source-1", "proxy-1"] });
    expect(attached.coverage.missingMedia).toBe(0);
    const analyzed = attachResearchAnalysis(attached, [{ awemeId: "aweme-1", status: "partial", factIds: ["fact-shot-1"], summary: "检测到 3 个镜头；中文 ASR/OCR 尚未配置。", analyzedAt: "2026-08-14T00:02:00.000Z" }]);
    expect(analyzed.videos[0]).toMatchObject({ mediaAnalysisStatus: "partial", analysisFactIds: ["fact-shot-1"] });
    expect(analyzed.coverage.mediaPartiallyAnalyzed).toBe(1);
    expect(analyzed.evidence.some((evidence) => evidence.type === "media_fact")).toBe(true);
  });

  it("rejects an unbounded first request", async () => {
    await expect(buildAccountResearchReport({ workspaceId: "workspace-1", sourceInput: "fixture", connector: { providerKey: "tikhub", resolveSecUserId: async () => "id", fetchProfile: async () => ({ secUserId: "id", raw: {} }), fetchUserPosts: async () => ({ providerKey: "tikhub", source: "public", fetchedAt: "2026-08-14T00:00:00.000Z", cursor: 0, hasMore: false, items: [], responseHash: "sha256:x" }), fetchHighestQualityPlayUrl: async () => ({ awemeId: "id", url: "https://cdn.example/video.mp4", responseHash: "sha256:x" }) }, count: 21 })).rejects.toThrow("1–20");
  });

  it("quotes only bounded, unique discovery sources and creates evidence-linked opportunities", () => {
    const query = normalizeTopicRadarQuery({ schemaVersion: 1, sources: ["low_fan", "search_hot"], keyword: "深度口播", dateWindow: 24, pageSize: 2 });
    const quote = createTopicRadarQuote({ workspaceId: "workspace-1", query, now: "2026-08-14T00:00:00.000Z", prices: {
      low_fan: { endpoint: "/api/v1/douyin/billboard/fetch_hot_total_low_fan_list", costUsd: 0.001, allowFreeCredit: true, allowDiscount: true, rateLimit: "10/second" },
      high_completion: { endpoint: "/api/v1/douyin/billboard/fetch_hot_total_high_play_list", costUsd: 0.001, allowFreeCredit: true, allowDiscount: true, rateLimit: "10/second" },
      search_hot: { endpoint: "/api/v1/douyin/billboard/fetch_hot_total_search_list", costUsd: 0.001, allowFreeCredit: true, allowDiscount: true, rateLimit: "10/second" },
    }});
    expect(quote.totalCostUsd).toBe(0.002);
    const report = createTopicRadarReport({ workspaceId: "workspace-1", quote, runs: [
      { schemaVersion: 1, source: "low_fan", endpoint: quote.lines[0].endpoint, jobId: "job-low", quotedCostUsd: 0.001, status: "succeeded", itemCount: 1, responseHash: "sha256:low" },
      { schemaVersion: 1, source: "search_hot", endpoint: quote.lines[1].endpoint, jobId: "job-search", quotedCostUsd: 0.001, status: "failed", itemCount: 0, error: { code: "RATE_LIMIT", message: "稍后重试", retryable: true } },
    ], results: [{ source: "low_fan", billboard: { providerKey: "tikhub", kind: "low_fan", fetchedAt: "2026-08-14T00:00:00.000Z", page: 1, pageSize: 1, total: 1, responseHash: "sha256:low", items: [{ awemeId: "aweme-1", title: "一个反常识观点", followerCount: 800, playCount: 120000, raw: { fans_cnt: 800, play_cnt: 120000 } }] } }] , createdAt: "2026-08-14T00:00:00.000Z" });
    expect(report.status).toBe("partial");
    expect(report.signals[0]).toMatchObject({ source: "low_fan", sourceId: "aweme-1" });
    expect(report.opportunities[0].evidenceIds).toContain(report.signals[0].id);
  });

  it("rejects duplicate discovery sources and page sizes above the provider safety bound", () => {
    expect(() => normalizeTopicRadarQuery({ schemaVersion: 1, sources: ["low_fan", "low_fan"], keyword: "", dateWindow: 24, pageSize: 2 })).toThrow("来源不能重复");
    expect(() => normalizeTopicRadarQuery({ schemaVersion: 1, sources: ["low_fan"], keyword: "", dateWindow: 24, pageSize: 21 })).toThrow();
  });
});

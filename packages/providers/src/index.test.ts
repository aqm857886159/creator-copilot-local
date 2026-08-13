import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiSdkStructuredGenerator, ApiMartClient, ProviderRequestError, TikHubDouyinConnector } from "./index";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": "request-test" } });
}

describe("provider adapters", () => {
  it("normalizes APIMart model catalog and chat without leaking credentials", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const client = new ApiMartClient({ apiKey: "secret-test-key", baseUrl: "https://api.example.test", fetcher: async (input, init) => {
      calls.push({ url: String(input), body: typeof init?.body === "string" ? init.body : undefined });
      if (String(input).includes("/v1/models")) return jsonResponse({ data: [{ id: "model-a", supported_endpoint_types: ["chat", "vision"] }] });
      return jsonResponse({ model: "model-a", choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } });
    } });
    await expect(client.listModels()).resolves.toEqual([expect.objectContaining({ modelKey: "model-a", capabilities: ["chat", "vision"], capabilitySource: "declared" })]);
    const result = await client.chat({ modelKey: "model-a", messages: [{ role: "user", content: "只回复 JSON" }], responseFormat: { type: "json_object" }, maxTokens: 32 });
    expect(result).toMatchObject({ providerKey: "apimart", text: "{\"ok\":true}", usage: { totalTokens: 7 } });
    expect(JSON.stringify(calls)).not.toContain("secret-test-key");
    expect(calls[1].body).toContain("response_format");
  });

  it("turns APIMart auth/rate errors into the shared error contract", async () => {
    const client = new ApiMartClient({ apiKey: "secret-test-key", baseUrl: "https://api.example.test", fetcher: async () => jsonResponse({ error: { code: "invalid_api_key", message: "invalid key" } }, 401) });
    await expect(client.chat({ modelKey: "model-a", messages: [{ role: "user", content: "hello" }] })).rejects.toSatisfy((error: unknown) => error instanceof ProviderRequestError && error.normalized.category === "auth" && error.normalized.retryable === false);
  });

  it("uses AI SDK structured output with one non-retried OpenAI-compatible request", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: typeof init?.body === "string" ? init.body : undefined });
      return jsonResponse({
        id: "response-ai-sdk",
        model: "model-structured",
        choices: [{ index: 0, message: { role: "assistant", content: "{\"answer\":\"ok\",\"score\":1}" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
      });
    };
    const generator = new AiSdkStructuredGenerator({ apiKey: "secret-test-key", baseUrl: "https://api.example.test/v1", fetcher });
    const result = await generator.generate({
      modelKey: "model-structured",
      system: "只输出结构化结果。",
      prompt: "返回 ok。",
      schema: z.object({ answer: z.literal("ok"), score: z.number().int() }).strict(),
      name: "FixtureAnswer",
      maxOutputTokens: 64,
    });
    expect(result).toMatchObject({ output: { answer: "ok", score: 1 }, responseModelId: "model-structured", usage: { totalTokens: 13 } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.test/v1/chat/completions");
    expect(calls[0].body).toContain("json_schema");
    expect(JSON.parse(calls[0].body ?? "{}")).toMatchObject({ stream: false });
    expect(JSON.stringify(result)).not.toContain("secret-test-key");
  });

  it("rejects invalid AI SDK structured output without retrying a billed request", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ id: "response-invalid", model: "model-structured", choices: [{ index: 0, message: { role: "assistant", content: "{\"answer\":42}" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } });
    };
    const generator = new AiSdkStructuredGenerator({ apiKey: "secret-test-key", baseUrl: "https://api.example.test/v1", fetcher });
    await expect(generator.generate({ modelKey: "model-structured", system: "fixture", prompt: "fixture", schema: z.object({ answer: z.string() }).strict(), name: "InvalidFixture" })).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("normalizes TikHub public profile and bounded post pagination", async () => {
    const urls: string[] = [];
    const connector = new TikHubDouyinConnector({ apiKey: "secret-test-key", baseUrl: "https://api.example.test", fetcher: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("get_sec_user_id")) return jsonResponse({ data: { sec_user_id: "MS4wLjABAAAAexample" } });
      if (url.includes("handler_user_profile")) return jsonResponse({ data: { nickname: "测试账号", follower_count: 1234 } });
      return jsonResponse({ data: { aweme_list: [{ aweme_id: "aweme-1", desc: "一个观点", create_time: 1_700_000_000, video: { duration: 2_500, cover: "https://cdn.example/cover.jpg" } }], has_more: true } });
    } });
    await expect(connector.resolveSecUserId("https://www.douyin.com/user/example")).resolves.toBe("MS4wLjABAAAAexample");
    await expect(connector.fetchProfile("MS4wLjABAAAAexample")).resolves.toMatchObject({ nickname: "测试账号", followerCount: 1234 });
    await expect(connector.fetchUserPosts({ secUserId: "MS4wLjABAAAAexample", count: 20 })).resolves.toMatchObject({ hasMore: true, items: [{ awemeId: "aweme-1", durationMs: 2500 }] });
    expect(urls.some((url) => url.includes("count=20"))).toBe(true);
    await expect(connector.fetchUserPosts({ secUserId: "MS4wLjABAAAAexample", count: 21 })).rejects.toThrow("1–20");
  });

  it("reads dynamic TikHub endpoint pricing before a discovery request", async () => {
    const connector = new TikHubDouyinConnector({ apiKey: "secret-test-key", baseUrl: "https://api.example.test", fetcher: async (input) => {
      expect(String(input)).toContain("get_endpoint_info");
      return jsonResponse({ data: { endpoint_uri: "/api/v1/douyin/billboard/fetch_hot_total_low_fan_list", endpoint_cost: 0.001, allow_free_credit: true, allow_discount: true, rate_limit: "10/second", endpoint_type: "self-operated" } });
    } });
    await expect(connector.getEndpointInfo("/api/v1/douyin/billboard/fetch_hot_total_low_fan_list")).resolves.toEqual({ endpoint: "/api/v1/douyin/billboard/fetch_hot_total_low_fan_list", costUsd: 0.001, allowFreeCredit: true, allowDiscount: true, rateLimit: "10/second", endpointType: "self-operated" });
    await expect(connector.getEndpointInfo("https://unsafe.example/path")).rejects.toThrow();
  });

  it("normalizes bounded low-fan and search-hot discovery evidence", async () => {
    const bodies: string[] = [];
    const connector = new TikHubDouyinConnector({ apiKey: "secret-test-key", baseUrl: "https://api.example.test", fetcher: async (input, init) => {
      bodies.push(typeof init?.body === "string" ? init.body : "");
      if (String(input).includes("low_fan")) return jsonResponse({ data: { code: 200, data: { page: { page: 1, page_size: 2, total: 9 }, objs: [{ item_id: "aweme-1", item_title: "一个反常识观点", fans_cnt: 800, play_cnt: 120_000, publish_time: 1_700_000_000, score: 98, like_rate: 0.12 }] }, extra: { now: 1 }, message: "ok" } });
      return jsonResponse({ data: { code: 200, data: { page_num: 1, page_size: 2, total_count: 8, search_list: [{ key_word: "深度口播", search_score: 88, trends: [{ date: "20260814", value: 42 }] }] }, extra: { now: 1 }, message: "ok" } });
    } });
    await expect(connector.fetchBillboardPosts({ kind: "low_fan", pageSize: 2, dateWindow: 24 })).resolves.toMatchObject({ kind: "low_fan", total: 9, items: [{ awemeId: "aweme-1", followerCount: 800, playCount: 120_000, likeRate: 0.12 }] });
    await expect(connector.fetchSearchHotList({ pageSize: 2, dateWindow: 24 })).resolves.toMatchObject({ total: 8, items: [{ keyword: "深度口播", score: 88, trends: [{ date: "20260814", value: 42 }] }] });
    expect(bodies.every((body) => JSON.parse(body).page_size === 2)).toBe(true);
    await expect(connector.fetchBillboardPosts({ kind: "low_fan", pageSize: 21 })).rejects.toThrow();
  });

  it("rejects TikHub business errors even when HTTP status is 200", async () => {
    const connector = new TikHubDouyinConnector({ apiKey: "secret-test-key", baseUrl: "https://api.example.test", fetcher: async () => jsonResponse({ code: 429, message: "too many requests" }) });
    await expect(connector.fetchSearchHotList({ pageSize: 2 })).rejects.toSatisfy((error: unknown) => error instanceof ProviderRequestError && error.normalized.category === "rate_limit" && error.normalized.retryable === true);
  });

  it("only accepts HTTPS high-quality media URLs", async () => {
    const connector = new TikHubDouyinConnector({ apiKey: "secret-test-key", baseUrl: "https://api.example.test", fetcher: async () => jsonResponse({ data: { original_video_url: "https://cdn.example/video.mp4" } }) });
    await expect(connector.fetchHighestQualityPlayUrl({ awemeId: "aweme-1", region: "CN" })).resolves.toMatchObject({ awemeId: "aweme-1", url: "https://cdn.example/video.mp4" });
    const unsafe = new TikHubDouyinConnector({ apiKey: "secret-test-key", baseUrl: "https://api.example.test", fetcher: async () => jsonResponse({ data: { original_video_url: "http://cdn.example/video.mp4" } }) });
    await expect(unsafe.fetchHighestQualityPlayUrl({ awemeId: "aweme-1" })).rejects.toSatisfy((error: unknown) => error instanceof ProviderRequestError && error.normalized.code === "VIDEO_URL_UNSAFE");
  });
});

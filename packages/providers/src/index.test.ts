import { describe, expect, it } from "vitest";
import { ApiMartClient, ProviderRequestError, TikHubDouyinConnector } from "./index";

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
});

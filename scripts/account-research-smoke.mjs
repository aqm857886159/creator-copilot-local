/**
 * A deliberately bounded TikHub account-research smoke.
 *
 * This is opt-in twice: the caller must enable the live check and explicitly
 * confirm the quoted spend. It never downloads media, requests a second page,
 * or prints credentials/account identifiers.
 */
if (process.env.ACCOUNT_RESEARCH_LIVE !== "1") {
  console.log("Account research smoke skipped. Set ACCOUNT_RESEARCH_LIVE=1 to quote the bounded live checks.");
  process.exit(0);
}

if (process.env.ACCOUNT_RESEARCH_CONFIRM !== "1") {
  throw new Error("Live account research is gated. Set ACCOUNT_RESEARCH_CONFIRM=1 after reviewing the cost quote.");
}

const { TikHubDouyinConnector } = await import("../dist-electron/packages/providers/src/index.js");

const apiKey = process.env.TIKHUB_API_KEY;
if (!apiKey) throw new Error("TIKHUB_API_KEY 未配置；请从 .env.example 创建本机 .env");

const connector = new TikHubDouyinConnector({
  apiKey,
  baseUrl: process.env.TIKHUB_BASE_URL ?? "https://api.tikhub.dev",
});
const secUserId = process.env.TIKHUB_SMOKE_SEC_USER_ID ?? "MS4wLjABAAAAW9FWcqS7RdQAWPd2AA5fL_ilmqsIFUCQ_Iym6Yh9_cUa6ZRqVLjVQSUjlHrfXY1Y";
const maxCostUsd = Number(process.env.ACCOUNT_RESEARCH_MAX_COST_USD ?? "0.02");
if (!Number.isFinite(maxCostUsd) || maxCostUsd < 0) throw new Error("ACCOUNT_RESEARCH_MAX_COST_USD 必须是非负数字");

const profileEndpoint = "/api/v1/douyin/app/v3/handler_user_profile";
const postsEndpoint = "/api/v1/douyin/app/v3/fetch_user_post_videos";
const profilePrice = await connector.getEndpointInfo(profileEndpoint);
// The provider rate-limits endpoint metadata aggressively; keep these calls sequential.
const postsPrice = await connector.getEndpointInfo(postsEndpoint);
const quotedCostUsd = profilePrice.costUsd + postsPrice.costUsd;
console.log(JSON.stringify({
  provider: "tikhub",
  check: "account_research_quote",
  requestedPosts: 1,
  endpointCount: 2,
  quotedCostUsd,
  maxCostUsd,
  profileRateLimit: profilePrice.rateLimit ?? null,
  postsRateLimit: postsPrice.rateLimit ?? null,
}));
if (quotedCostUsd > maxCostUsd) {
  throw new Error(`报价 ${quotedCostUsd} USD 超过 ACCOUNT_RESEARCH_MAX_COST_USD=${maxCostUsd}`);
}

const profile = await connector.fetchProfile(secUserId);
const posts = await connector.fetchUserPosts({ secUserId, maxCursor: 0, count: 1, sortType: 0 });
console.log(JSON.stringify({
  ok: Boolean(profile.secUserId) && posts.items.length <= 1,
  provider: "tikhub",
  check: "account_research_metadata_first",
  profileFields: ["secUserId", "nickname", "followerCount", "awemeCount"].filter((field) => {
    const value = profile[field];
    return value !== undefined && value !== null && value !== "";
  }),
  postCount: posts.items.length,
  hasMore: posts.hasMore,
  metadataOnly: posts.items.length === 0,
  responseHashPresent: Boolean(posts.responseHash),
}));

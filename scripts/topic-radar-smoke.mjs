import { TikHubDouyinConnector } from "../dist-electron/packages/providers/src/index.js";
import { TOPIC_RADAR_ENDPOINTS, createTopicRadarQuote, normalizeTopicRadarQuery } from "../dist-electron/packages/research/src/index.js";

if (!process.env.TIKHUB_API_KEY) throw new Error("TIKHUB_API_KEY 未配置；请从 .env.example 创建本机 .env");

const source = process.env.TOPIC_RADAR_SOURCE ?? "low_fan";
if (!(source in TOPIC_RADAR_ENDPOINTS)) throw new Error(`不支持的 TOPIC_RADAR_SOURCE：${source}`);
const keyword = (process.env.TOPIC_RADAR_KEYWORD ?? "深度口播").trim().slice(0, 100);
const query = normalizeTopicRadarQuery({ schemaVersion: 1, sources: [source], keyword, dateWindow: 24, pageSize: 1 });
const connector = new TikHubDouyinConnector({ apiKey: process.env.TIKHUB_API_KEY, baseUrl: process.env.TIKHUB_BASE_URL ?? "https://api.tikhub.dev" });
const price = await connector.getEndpointInfo(TOPIC_RADAR_ENDPOINTS[source]);
const quote = createTopicRadarQuote({ workspaceId: "smoke-workspace", query, prices: { [source]: price }, now: new Date().toISOString() });
console.log(JSON.stringify({ mode: process.env.TOPIC_RADAR_BILLED_SMOKE === "1" ? "bounded-paid" : "quote-only", source, endpoint: price.endpoint, costUsd: quote.totalCostUsd, rateLimit: price.rateLimit ?? null, pageSize: 1 }));

if (process.env.TOPIC_RADAR_BILLED_SMOKE !== "1") process.exit(0);

const result = source === "search_hot"
  ? await connector.fetchSearchHotList({ page: 1, pageSize: 1, dateWindow: 24, keyword })
  : await connector.fetchBillboardPosts({ kind: source, page: 1, pageSize: 1, dateWindow: 24, keyword });
console.log(JSON.stringify({ mode: "bounded-paid", source, itemCount: result.items.length, responseHash: result.responseHash }));

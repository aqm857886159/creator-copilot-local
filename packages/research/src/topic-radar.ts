import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TikHubBillboardPage, TikHubEndpointInfo, TikHubSearchTrend } from "../../providers/src/index.js";

const id = z.string().min(1);
const isoDate = z.string().datetime({ offset: true });

export const TopicRadarSourceSchema = z.enum(["low_fan", "high_completion", "search_hot"]);
export type TopicRadarSource = z.infer<typeof TopicRadarSourceSchema>;

export const TOPIC_RADAR_ENDPOINTS: Record<TopicRadarSource, string> = {
  low_fan: "/api/v1/douyin/billboard/fetch_hot_total_low_fan_list",
  high_completion: "/api/v1/douyin/billboard/fetch_hot_total_high_play_list",
  search_hot: "/api/v1/douyin/billboard/fetch_hot_total_search_list",
};

export const TopicRadarQuerySchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(TopicRadarSourceSchema).min(1).max(3),
  keyword: z.string().max(100),
  dateWindow: z.union([z.literal(1), z.literal(24), z.literal(72), z.literal(168)]),
  pageSize: z.number().int().positive().max(20),
}).strict().superRefine((value, context) => {
  if (new Set(value.sources).size !== value.sources.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["sources"], message: "来源不能重复" });
});
export type TopicRadarQuery = z.infer<typeof TopicRadarQuerySchema>;

const TopicRadarQuoteLineSchema = z.object({
  source: TopicRadarSourceSchema,
  endpoint: id,
  costUsd: z.number().nonnegative(),
  rateLimit: z.string().optional(),
  endpointType: z.string().optional(),
}).strict();

export const TopicRadarQuoteSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  workspaceId: id,
  query: TopicRadarQuerySchema,
  lines: z.array(TopicRadarQuoteLineSchema).min(1).max(3),
  totalCostUsd: z.number().nonnegative(),
  currency: z.literal("USD"),
  quotedAt: isoDate,
  expiresAt: isoDate,
}).strict();
export type TopicRadarQuote = z.infer<typeof TopicRadarQuoteSchema>;

export const TopicRadarSignalSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  source: TopicRadarSourceSchema,
  kind: z.enum(["post", "search_term"]),
  label: z.string().min(1).max(200),
  detail: z.string().min(1).max(500),
  metrics: z.record(z.number()),
  sourceId: id,
  sourceUrl: z.string().url().optional(),
  capturedAt: isoDate,
}).strict();
export type TopicRadarSignal = z.infer<typeof TopicRadarSignalSchema>;

export const TopicOpportunitySchema = z.object({
  schemaVersion: z.literal(1),
  id,
  source: TopicRadarSourceSchema,
  title: z.string().min(1).max(200),
  angle: z.string().min(1).max(500),
  whyNow: z.string().min(1).max(500),
  evidenceIds: z.array(id).min(1).max(20),
  status: z.literal("candidate"),
}).strict();
export type TopicOpportunity = z.infer<typeof TopicOpportunitySchema>;

export const TopicRadarSourceRunSchema = z.object({
  schemaVersion: z.literal(1),
  source: TopicRadarSourceSchema,
  endpoint: id,
  jobId: id,
  quotedCostUsd: z.number().nonnegative(),
  status: z.enum(["succeeded", "failed", "submission_unknown"]),
  itemCount: z.number().int().nonnegative(),
  responseHash: id.optional(),
  error: z.object({ code: id, message: id, retryable: z.boolean() }).strict().optional(),
}).strict();
export type TopicRadarSourceRun = z.infer<typeof TopicRadarSourceRunSchema>;

export const TopicRadarReportSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  workspaceId: id,
  providerKey: z.literal("tikhub"),
  query: TopicRadarQuerySchema,
  quote: TopicRadarQuoteSchema,
  status: z.enum(["completed", "partial", "failed"]),
  signals: z.array(TopicRadarSignalSchema).max(200),
  opportunities: z.array(TopicOpportunitySchema).max(100),
  runs: z.array(TopicRadarSourceRunSchema).min(1).max(3),
  createdAt: isoDate,
}).strict();
export type TopicRadarReport = z.infer<typeof TopicRadarReportSchema>;

export type TopicRadarConnector = {
  getEndpointInfo(endpoint: string): Promise<TikHubEndpointInfo>;
  fetchBillboardPosts(input: { kind: "low_fan" | "high_completion"; page: number; pageSize: number; dateWindow: 1 | 24 | 72 | 168; keyword: string }): Promise<TikHubBillboardPage>;
  fetchSearchHotList(input: { page: number; pageSize: number; dateWindow: 1 | 24 | 72 | 168; keyword: string }): Promise<{ items: TikHubSearchTrend[]; total: number; responseHash: string }>;
};

export function normalizeTopicRadarQuery(input: unknown): TopicRadarQuery {
  return TopicRadarQuerySchema.parse(input);
}

export function createTopicRadarQuote(input: { workspaceId: string; query: TopicRadarQuery; prices: Record<TopicRadarSource, TikHubEndpointInfo>; now?: string; ttlMs?: number }): TopicRadarQuote {
  const query = TopicRadarQuerySchema.parse(input.query);
  const quotedAt = input.now ?? new Date().toISOString();
  const expiresAt = new Date(new Date(quotedAt).getTime() + (input.ttlMs ?? 10 * 60_000)).toISOString();
  const lines = query.sources.map((source) => {
    const price = input.prices[source];
    if (!price) throw new Error(`缺少 ${source} 的动态价格`);
    return { source, endpoint: price.endpoint, costUsd: price.costUsd, rateLimit: price.rateLimit, endpointType: price.endpointType };
  });
  return TopicRadarQuoteSchema.parse({ schemaVersion: 1, id: `topic-quote-${randomUUID()}`, workspaceId: id.parse(input.workspaceId), query, lines, totalCostUsd: Number(lines.reduce((sum, line) => sum + line.costUsd, 0).toFixed(6)), currency: "USD", quotedAt, expiresAt });
}

function shorten(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  return normalized.length > 120 ? `${normalized.slice(0, 117)}…` : normalized;
}

function numericMetrics(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.flatMap((key) => typeof value[key] === "number" ? [[key, value[key] as number]] : []));
}

function buildBillboardSignals(source: "low_fan" | "high_completion", page: TikHubBillboardPage, capturedAt: string, quoteId: string) {
  return page.items.map((item, index) => {
    const signalId = `topic-signal-${quoteId}-${source}-${index + 1}`;
    const metrics = numericMetrics(item.raw, ["fans_cnt", "play_cnt", "like_cnt", "follow_cnt", "score", "like_rate", "follow_rate"]);
    const label = shorten(item.title, item.awemeId);
    const detail = source === "low_fan"
      ? `${item.followerCount?.toLocaleString() ?? "未知"} 粉丝账号获得 ${item.playCount?.toLocaleString() ?? "未知"} 播放；这是榜单信号，仍需本地拆解画面和表达。`
      : `榜单综合分 ${item.score ?? "未知"}；不要把榜单名次当成因果结论，下一步核对前 3 秒、时长和镜头节奏。`;
    return TopicRadarSignalSchema.parse({ schemaVersion: 1, id: signalId, source, kind: "post", label, detail, metrics, sourceId: item.awemeId, sourceUrl: item.shareUrl, capturedAt });
  });
}

function buildSearchSignals(page: { items: TikHubSearchTrend[] }, capturedAt: string, quoteId: string) {
  return page.items.map((item, index) => {
    const signalId = `topic-signal-${quoteId}-search-hot-${index + 1}`;
    const first = item.trends[0]?.value;
    const last = item.trends.at(-1)?.value;
    const delta = first !== undefined && last !== undefined ? last - first : undefined;
    return TopicRadarSignalSchema.parse({ schemaVersion: 1, id: signalId, source: "search_hot", kind: "search_term", label: shorten(item.keyword, "未命名搜索词"), detail: `搜索分 ${item.score ?? "未知"}${delta === undefined ? "" : `，窗口趋势变化 ${delta >= 0 ? "+" : ""}${delta}`}；需要结合你的账号定位判断是否值得进入选题库。`, metrics: { ...(item.score === undefined ? {} : { searchScore: item.score }), ...(delta === undefined ? {} : { trendDelta: delta }) }, sourceId: item.keyword, capturedAt });
  });
}

function opportunitiesForSignal(signal: TopicRadarSignal) {
  if (signal.source === "low_fan") return TopicOpportunitySchema.parse({ schemaVersion: 1, id: `opportunity-${signal.id}`, source: signal.source, title: `低粉样本：${signal.label}`, angle: "拆解一个小账号如何把具体经验讲成可传播的观点，再换成你自己的真实案例。", whyNow: signal.detail, evidenceIds: [signal.id], status: "candidate" });
  if (signal.source === "high_completion") return TopicOpportunitySchema.parse({ schemaVersion: 1, id: `opportunity-${signal.id}`, source: signal.source, title: `高完播样本：${signal.label}`, angle: "先拆开头承诺、信息递进和画面变化，再决定你的口播是否需要补拍 B-roll。", whyNow: signal.detail, evidenceIds: [signal.id], status: "candidate" });
  return TopicOpportunitySchema.parse({ schemaVersion: 1, id: `opportunity-${signal.id}`, source: signal.source, title: `搜索机会：${signal.label}`, angle: `围绕“${signal.label}”提出一个你真正有经验的反常识问题，不直接复述热词。`, whyNow: signal.detail, evidenceIds: [signal.id], status: "candidate" });
}

export function createTopicRadarReport(input: { workspaceId: string; quote: TopicRadarQuote; runs: TopicRadarSourceRun[]; results: Array<{ source: TopicRadarSource; billboard?: TikHubBillboardPage; search?: { items: TikHubSearchTrend[]; total: number; responseHash: string } }>; createdAt?: string }): TopicRadarReport {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const signals = input.results.flatMap((result) => result.billboard ? buildBillboardSignals(result.source as "low_fan" | "high_completion", result.billboard, createdAt, input.quote.id) : result.search ? buildSearchSignals(result.search, createdAt, input.quote.id) : []);
  const opportunities = signals.map(opportunitiesForSignal);
  const succeeded = input.runs.filter((run) => run.status === "succeeded").length;
  const status = succeeded === input.runs.length ? "completed" : succeeded > 0 ? "partial" : "failed";
  return TopicRadarReportSchema.parse({ schemaVersion: 1, id: `topic-radar-${randomUUID()}`, workspaceId: input.workspaceId, providerKey: "tikhub", query: input.quote.query, quote: input.quote, status, signals, opportunities, runs: input.runs, createdAt });
}

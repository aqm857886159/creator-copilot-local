import { createHash } from "node:crypto";
import { z } from "zod";

const id = z.string().min(1);

export const ProviderErrorCategorySchema = z.enum(["invalid", "auth", "quota", "rate_limit", "timeout", "provider", "network", "capability"]);
export type ProviderErrorCategory = z.infer<typeof ProviderErrorCategorySchema>;

export const ProviderErrorSchema = z.object({
  schemaVersion: z.literal(1),
  providerKey: id,
  category: ProviderErrorCategorySchema,
  code: id,
  message: id,
  retryable: z.boolean(),
  httpStatus: z.number().int().positive().optional(),
  requestId: id.optional(),
  details: z.record(z.unknown()).optional(),
}).strict();
export type ProviderError = z.infer<typeof ProviderErrorSchema>;

export const ModelDescriptorSchema = z.object({
  schemaVersion: z.literal(1),
  providerKey: id,
  modelKey: id,
  displayName: id,
  capabilities: z.array(z.enum(["chat", "structured_output", "vision", "audio_input", "audio_output", "image_generation", "video_generation", "transcription"])),
  capabilitySource: z.enum(["declared", "inferred", "static_fallback"]),
  contextWindow: z.number().int().positive().optional(),
}).strict();
export type ModelDescriptor = z.infer<typeof ModelDescriptorSchema>;

export const ProviderCapabilityReportSchema = z.object({
  schemaVersion: z.literal(1),
  providerKey: id,
  fetchedAt: z.string().datetime({ offset: true }),
  capabilities: z.array(z.enum(["chat", "structured_output", "vision", "audio_input", "audio_output", "image_generation", "video_generation", "transcription"])),
  source: z.enum(["official", "inferred", "static_fallback"]),
}).strict();
export type ProviderCapabilityReport = z.infer<typeof ProviderCapabilityReportSchema>;

export const StructuredChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1),
}).strict();

export const StructuredChatRequestSchema = z.object({
  modelKey: id,
  messages: z.array(StructuredChatMessageSchema).min(1).max(100),
  maxTokens: z.number().int().positive().max(32_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  responseFormat: z.object({ type: z.literal("json_object") }).strict().optional(),
  timeoutMs: z.number().int().positive().max(120_000).default(60_000),
}).strict();
export type StructuredChatRequest = z.input<typeof StructuredChatRequestSchema>;

export const ProviderChatResultSchema = z.object({
  schemaVersion: z.literal(1),
  providerKey: id,
  modelKey: id,
  text: z.string(),
  finishReason: z.string().optional(),
  requestId: id.optional(),
  usage: z.object({ inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(), totalTokens: z.number().int().nonnegative().optional() }).strict().optional(),
  responseHash: id,
}).strict();
export type ProviderChatResult = z.infer<typeof ProviderChatResultSchema>;

export type ProviderFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ProviderPort {
  readonly providerKey: string;
  listModels(): Promise<ModelDescriptor[]>;
  getCapabilities(): Promise<ProviderCapabilityReport>;
  chat(input: StructuredChatRequest): Promise<ProviderChatResult>;
}

export type TikHubPage<T> = {
  providerKey: "tikhub";
  source: "public";
  fetchedAt: string;
  cursor: number;
  hasMore: boolean;
  items: T[];
  responseHash: string;
};

export type TikHubProfile = {
  secUserId: string;
  nickname?: string;
  signature?: string;
  followerCount?: number;
  followingCount?: number;
  awemeCount?: number;
  raw: Record<string, unknown>;
};

export type TikHubVideoMetadata = {
  awemeId: string;
  description?: string;
  createTime?: string;
  shareUrl?: string;
  durationMs?: number;
  coverUrl?: string;
  statistics?: Record<string, number>;
  raw: Record<string, unknown>;
};

export type TikHubVideoDownload = {
  awemeId: string;
  url: string;
  requestId?: string;
  responseHash: string;
};

export interface ResearchConnector {
  readonly providerKey: string;
  resolveSecUserId(urlOrId: string): Promise<string>;
  fetchProfile(secUserId: string): Promise<TikHubProfile>;
  fetchUserPosts(input: { secUserId: string; maxCursor?: number; count?: number; sortType?: 0 | 1 }): Promise<TikHubPage<TikHubVideoMetadata>>;
  fetchHighestQualityPlayUrl(input: { awemeId: string; shareUrl?: string; region?: string }): Promise<TikHubVideoDownload>;
}

function hashResponse(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function responseRequestId(body: Record<string, unknown>, response: Response) {
  const value = body.request_id ?? body.requestId ?? response.headers.get("x-request-id") ?? undefined;
  return typeof value === "string" && value ? value : undefined;
}

function errorCategory(status: number, body: Record<string, unknown>): ProviderErrorCategory {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 429) return "rate_limit";
  if (status >= 400 && status < 500) return "invalid";
  return "provider";
}

function throwProviderError(providerKey: string, response: Response, body: Record<string, unknown>): never {
  const category = errorCategory(response.status, body);
  const bodyError = typeof body.error === "object" && body.error ? body.error as Record<string, unknown> : undefined;
  const code = String(bodyError?.code ?? body.code ?? `HTTP_${response.status}`);
  const message = String(bodyError?.message ?? body.message ?? "Provider 请求失败").slice(0, 500);
  throw new ProviderRequestError(ProviderErrorSchema.parse({
    schemaVersion: 1,
    providerKey,
    category,
    code,
    message,
    retryable: category === "rate_limit" || category === "timeout" || category === "network" || response.status >= 500,
    httpStatus: response.status,
    requestId: responseRequestId(body, response),
  }));
}

export class ProviderRequestError extends Error {
  readonly normalized: ProviderError;

  constructor(normalized: ProviderError) {
    super(normalized.message);
    this.name = "ProviderRequestError";
    this.normalized = normalized;
  }
}

async function fetchJson(providerKey: string, baseUrl: string, path: string, init: RequestInit, timeoutMs: number, fetcher: ProviderFetch) {
  let response: Response;
  try {
    response = await fetcher(new URL(path, baseUrl), { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new ProviderRequestError(ProviderErrorSchema.parse({ schemaVersion: 1, providerKey, category: timedOut ? "timeout" : "network", code: timedOut ? "TIMEOUT" : "NETWORK_ERROR", message: timedOut ? "Provider 请求超时" : "Provider 网络请求失败", retryable: true }));
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  const objectBody = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  if (!response.ok) throwProviderError(providerKey, response, objectBody);
  return { response, body: objectBody };
}

function bearer(apiKey: string) {
  if (!apiKey) throw new Error("Provider API key 未配置");
  return { Authorization: `Bearer ${apiKey}` };
}

function modelCapabilities(item: Record<string, unknown>) {
  const endpoints = Array.isArray(item.supported_endpoint_types) ? item.supported_endpoint_types.filter((value): value is string => typeof value === "string") : [];
  const capabilities: ModelDescriptor["capabilities"] = [];
  if (endpoints.some((value) => /chat|text|completion/i.test(value))) capabilities.push("chat");
  if (endpoints.some((value) => /vision|image_input/i.test(value))) capabilities.push("vision");
  if (endpoints.some((value) => /audio|transcription|whisper/i.test(value))) capabilities.push("audio_input", "transcription");
  return capabilities.length > 0 ? capabilities : ["chat"];
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => typeof part === "string" ? part : typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text) : "").join("");
  return "";
}

export class ApiMartClient implements ProviderPort {
  readonly providerKey = "apimart" as const;

  constructor(private readonly options: { apiKey: string; baseUrl?: string; fetcher?: ProviderFetch }) {}

  private get baseUrl() { return this.options.baseUrl ?? "https://api.apimart.ai"; }
  private get fetcher() { return this.options.fetcher ?? fetch; }

  async listModels() {
    const result = await fetchJson(this.providerKey, this.baseUrl, "/v1/models?expand=true", { headers: bearer(this.options.apiKey) }, 30_000, this.fetcher);
    const items = Array.isArray(result.body.data) ? result.body.data : Array.isArray(result.body.models) ? result.body.models : [];
    return items.flatMap((item) => {
      if (typeof item !== "object" || !item) return [];
      const raw = item as Record<string, unknown>;
      const modelKey = typeof raw.id === "string" ? raw.id : typeof raw.name === "string" ? raw.name : undefined;
      if (!modelKey) return [];
      return [ModelDescriptorSchema.parse({ schemaVersion: 1, providerKey: this.providerKey, modelKey, displayName: typeof raw.name === "string" ? raw.name : modelKey, capabilities: modelCapabilities(raw), capabilitySource: Array.isArray(raw.supported_endpoint_types) ? "declared" : "inferred", contextWindow: typeof raw.context_length === "number" ? raw.context_length : undefined })];
    });
  }

  async getCapabilities() {
    const models = await this.listModels();
    const capabilities: ProviderCapabilityReport["capabilities"] = [];
    for (const model of models) for (const capability of model.capabilities) if (!capabilities.includes(capability)) capabilities.push(capability);
    return ProviderCapabilityReportSchema.parse({ schemaVersion: 1, providerKey: this.providerKey, fetchedAt: new Date().toISOString(), capabilities, source: models.length > 0 ? "inferred" : "static_fallback" });
  }

  async chat(raw: StructuredChatRequest) {
    const input = StructuredChatRequestSchema.parse(raw);
    const body = {
      model: input.modelKey,
      stream: false,
      messages: input.messages,
      ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
    };
    const result = await fetchJson(this.providerKey, this.baseUrl, "/v1/chat/completions", { method: "POST", headers: { ...bearer(this.options.apiKey), "Content-Type": "application/json" }, body: JSON.stringify(body) }, input.timeoutMs, this.fetcher);
    const choice = Array.isArray(result.body.choices) ? result.body.choices[0] as Record<string, unknown> | undefined : undefined;
    const message = choice && typeof choice.message === "object" && choice.message ? choice.message as Record<string, unknown> : {};
    const payload = ProviderChatResultSchema.parse({ schemaVersion: 1, providerKey: this.providerKey, modelKey: typeof result.body.model === "string" ? result.body.model : input.modelKey, text: messageText(message.content), finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined, requestId: responseRequestId(result.body, result.response), usage: typeof result.body.usage === "object" && result.body.usage ? { inputTokens: Number((result.body.usage as Record<string, unknown>).prompt_tokens) || undefined, outputTokens: Number((result.body.usage as Record<string, unknown>).completion_tokens) || undefined, totalTokens: Number((result.body.usage as Record<string, unknown>).total_tokens) || undefined } : undefined, responseHash: hashResponse(result.body) });
    return payload;
  }
}

function dataPayload(body: Record<string, unknown>) {
  return typeof body.data === "object" && body.data !== null ? body.data as Record<string, unknown> : body;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof record[key] === "string" && record[key]) return record[key] as string;
  return undefined;
}

export class TikHubDouyinConnector implements ResearchConnector {
  readonly providerKey = "tikhub" as const;

  constructor(private readonly options: { apiKey: string; baseUrl?: string; fetcher?: ProviderFetch }) {}

  private get baseUrl() { return this.options.baseUrl ?? "https://api.tikhub.dev"; }
  private get fetcher() { return this.options.fetcher ?? fetch; }
  private async get(path: string, params: Record<string, string | number>) {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return fetchJson(this.providerKey, this.baseUrl, `${url.pathname}${url.search}`, { headers: bearer(this.options.apiKey) }, 30_000, this.fetcher);
  }

  async resolveSecUserId(urlOrId: string) {
    const value = urlOrId.trim();
    if (!value) throw new Error("抖音账号链接不能为空");
    if (/^MS4wLjAB/.test(value)) return value;
    const result = await this.get("/api/v1/douyin/web/get_sec_user_id", { url: value });
    const data = dataPayload(result.body);
    const secUserId = firstString(data, ["sec_user_id", "secUserId"]);
    if (!secUserId) throw new ProviderRequestError(ProviderErrorSchema.parse({ schemaVersion: 1, providerKey: this.providerKey, category: "invalid", code: "SEC_USER_ID_NOT_FOUND", message: "没有从链接解析出抖音账号 ID", retryable: false, requestId: responseRequestId(result.body, result.response) }));
    return secUserId;
  }

  async fetchProfile(secUserId: string) {
    const normalizedId = id.parse(secUserId);
    const result = await this.get("/api/v1/douyin/app/v3/handler_user_profile", { sec_user_id: normalizedId });
    const data = dataPayload(result.body);
    return { secUserId: normalizedId, nickname: firstString(data, ["nickname", "nickname_full"]), signature: firstString(data, ["signature", "desc"]), followerCount: typeof data.follower_count === "number" ? data.follower_count : undefined, followingCount: typeof data.following_count === "number" ? data.following_count : undefined, awemeCount: typeof data.aweme_count === "number" ? data.aweme_count : undefined, raw: data } satisfies TikHubProfile;
  }

  async fetchUserPosts(input: { secUserId: string; maxCursor?: number; count?: number; sortType?: 0 | 1 }) {
    const count = input.count ?? 20;
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("TikHub 作品分页 count 必须在 1–20 之间");
    const cursor = input.maxCursor ?? 0;
    if (!Number.isInteger(cursor) || cursor < 0) throw new Error("TikHub maxCursor 必须是非负整数");
    const result = await this.get("/api/v1/douyin/app/v3/fetch_user_post_videos", { sec_user_id: id.parse(input.secUserId), max_cursor: cursor, count, sort_type: input.sortType ?? 0 });
    const data = dataPayload(result.body);
    const rawItems = Array.isArray(data.aweme_list) ? data.aweme_list : Array.isArray(data.items) ? data.items : Array.isArray(result.body.data) ? result.body.data : [];
    const items = rawItems.flatMap((item) => {
      if (typeof item !== "object" || !item) return [];
      const raw = item as Record<string, unknown>;
      const awemeId = firstString(raw, ["aweme_id", "awemeId", "id"]);
      if (!awemeId) return [];
      const video = typeof raw.video === "object" && raw.video ? raw.video as Record<string, unknown> : {};
      const statistics = typeof raw.statistics === "object" && raw.statistics ? raw.statistics as Record<string, unknown> : {};
      const durationMs = typeof video.duration === "number" ? Math.round(video.duration) : typeof raw.duration === "number" ? Math.round(raw.duration > 100 ? raw.duration : raw.duration * 1000) : undefined;
      return [{ awemeId, description: firstString(raw, ["desc", "description"]), createTime: typeof raw.create_time === "number" ? new Date(raw.create_time * 1000).toISOString() : firstString(raw, ["create_time", "createTime"]), shareUrl: firstString(raw, ["share_url", "shareUrl"]), durationMs, coverUrl: firstString(video, ["cover", "cover_url", "coverUrl"]), statistics: Object.fromEntries(Object.entries(statistics).filter((entry): entry is [string, number] => typeof entry[1] === "number")), raw }];
    });
    return { providerKey: this.providerKey, source: "public" as const, fetchedAt: new Date().toISOString(), cursor, hasMore: Boolean(data.has_more ?? data.hasMore), items, responseHash: hashResponse(result.body) } satisfies TikHubPage<TikHubVideoMetadata>;
  }

  async fetchHighestQualityPlayUrl(input: { awemeId: string; shareUrl?: string; region?: string }) {
    const awemeId = id.parse(input.awemeId);
    const result = await this.get("/api/v1/douyin/app/v3/fetch_video_high_quality_play_url", {
      ...(awemeId ? { aweme_id: awemeId } : {}),
      ...(input.shareUrl ? { share_url: input.shareUrl } : {}),
      ...(input.region ? { region: input.region } : {}),
    });
    const data = dataPayload(result.body);
    const url = firstString(data, ["original_video_url", "video_url", "play_url", "url"]);
    if (!url) throw new ProviderRequestError(ProviderErrorSchema.parse({ schemaVersion: 1, providerKey: this.providerKey, category: "provider", code: "VIDEO_URL_NOT_FOUND", message: "TikHub 未返回可下载的视频地址", retryable: false, requestId: responseRequestId(result.body, result.response) }));
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ProviderRequestError(ProviderErrorSchema.parse({ schemaVersion: 1, providerKey: this.providerKey, category: "provider", code: "VIDEO_URL_INVALID", message: "TikHub 返回的视频地址无效", retryable: false, requestId: responseRequestId(result.body, result.response) }));
    }
    if (parsed.protocol !== "https:") throw new ProviderRequestError(ProviderErrorSchema.parse({ schemaVersion: 1, providerKey: this.providerKey, category: "provider", code: "VIDEO_URL_UNSAFE", message: "TikHub 返回的视频地址不是 HTTPS", retryable: false, requestId: responseRequestId(result.body, result.response) }));
    return { awemeId, url: parsed.toString(), requestId: responseRequestId(result.body, result.response), responseHash: hashResponse(result.body) } satisfies TikHubVideoDownload;
  }
}

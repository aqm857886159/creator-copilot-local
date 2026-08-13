import { z } from "zod";
import type { ResearchConnector, TikHubProfile, TikHubVideoMetadata } from "../../providers/src/index.js";

export * from "./topic-radar.js";

const id = z.string().min(1);

export const BenchmarkVideoSchema = z.object({
  schemaVersion: z.literal(1),
  awemeId: id,
  description: z.string().optional(),
  createTime: z.string().datetime({ offset: true }).optional(),
  shareUrl: z.string().url().optional(),
  durationMs: z.number().int().positive().optional(),
  coverUrl: z.string().url().optional(),
  statistics: z.record(z.number().nonnegative()),
  evidenceIds: z.array(id),
  artifactIds: z.array(id).default([]),
  mediaAnalysisStatus: z.enum(["not_requested", "metadata_only", "queued", "partial", "completed", "failed"]),
  analysisFactIds: z.array(id).default([]),
  analysis: z.object({
    status: z.enum(["partial", "completed"]),
    analyzedAt: z.string().datetime({ offset: true }).optional(),
    summary: z.string().max(500).optional(),
    factCount: z.number().int().nonnegative(),
    shotCount: z.number().int().nonnegative(),
    transcriptCount: z.number().int().nonnegative(),
    ocrCount: z.number().int().nonnegative(),
    missingKinds: z.array(z.enum(["shot", "transcript", "ocr"])).max(3),
    openingText: z.array(z.string().min(1).max(500)).max(8),
    timeline: z.array(z.object({
      id,
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().positive(),
      shotFactId: id.optional(),
      transition: z.string().optional(),
      transcript: z.array(z.object({ factId: id, startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), text: z.string().min(1).max(500) }).strict()).max(30),
      ocr: z.array(z.object({ factId: id, startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), text: z.string().min(1).max(500) }).strict()).max(30),
    }).strict()).max(500),
  }).strict().optional(),
}).strict();
export type BenchmarkVideo = z.infer<typeof BenchmarkVideoSchema>;

export const AccountResearchOpportunitySchema = z.object({
  schemaVersion: z.literal(1),
  id,
  title: z.string().min(1).max(200),
  angle: z.string().min(1).max(500),
  whyNow: z.string().min(1).max(500),
  sourceVideoIds: z.array(id).min(1).max(10),
  evidenceIds: z.array(id).min(1).max(20),
  status: z.literal("candidate"),
}).strict();
export type AccountResearchOpportunity = z.infer<typeof AccountResearchOpportunitySchema>;

export const ResearchEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  type: z.enum(["profile", "video_metadata", "metric", "coverage", "media_fact"]),
  sourceId: id,
  label: id,
  payload: z.record(z.unknown()),
  capturedAt: z.string().datetime({ offset: true }),
}).strict();
export type ResearchEvidence = z.infer<typeof ResearchEvidenceSchema>;

export const AccountResearchReportSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  workspaceId: id,
  providerKey: id,
  sourceInput: id,
  secUserId: id,
  profile: z.object({ nickname: z.string().optional(), signature: z.string().optional(), followerCount: z.number().nonnegative().optional(), followingCount: z.number().nonnegative().optional(), awemeCount: z.number().nonnegative().optional() }).strict(),
  videos: z.array(BenchmarkVideoSchema),
  coverage: z.object({ requested: z.number().int().positive(), received: z.number().int().nonnegative(), metadataAnalyzed: z.number().int().nonnegative(), mediaAnalyzed: z.number().int().nonnegative(), mediaPartiallyAnalyzed: z.number().int().nonnegative().default(0), missingMedia: z.number().int().nonnegative(), hasMore: z.boolean(), note: z.string().min(1) }).strict(),
  findings: z.array(z.object({ id, kind: z.enum(["metadata_pattern", "topic_opportunity", "needs_media_analysis", "media_pattern"]), title: id, detail: z.string().min(1), evidenceIds: z.array(id) }).strict()),
  opportunities: z.array(AccountResearchOpportunitySchema).max(20).default([]),
  evidence: z.array(ResearchEvidenceSchema),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type AccountResearchReport = z.infer<typeof AccountResearchReportSchema>;

export type ResearchMediaAttachment = {
  awemeId: string;
  artifactIds: string[];
  attachedAt: string;
};

export type ResearchAnalysisUpdate = {
  awemeId: string;
  status: "partial" | "completed";
  factIds: string[];
  summary: string;
  analyzedAt: string;
  facts?: ResearchMediaFactSummary["facts"];
};

export type ResearchMediaFactSummary = {
  awemeId: string;
  artifactIds: string[];
  facts: Array<{ id: string; artifactId: string; kind: "transcript" | "ocr" | "shot" | "caption" | "label"; startMs: number; endMs: number; text: string; labels: string[]; contentHash: string }>;
  analyzedAt: string;
};

type ResearchTimelineFact = ResearchMediaFactSummary["facts"][number];

function overlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return Math.min(leftEnd, rightEnd) > Math.max(leftStart, rightStart);
}

function shortText(value: string, max = 90) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function timelineForFacts(awemeId: string, facts: ResearchTimelineFact[]) {
  const shots = facts.filter((fact) => fact.kind === "shot").sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const transcripts = facts.filter((fact) => fact.kind === "transcript").sort((left, right) => left.startMs - right.startMs);
  const ocr = facts.filter((fact) => fact.kind === "ocr").sort((left, right) => left.startMs - right.startMs);
  if (shots.length === 0) return [];
  return shots.map((shot, index) => ({
    id: `timeline-${awemeId}-${index + 1}`,
    startMs: shot.startMs,
    endMs: shot.endMs,
    shotFactId: shot.id,
    transition: shot.labels.find((label) => ["cut", "dissolve", "fade", "unknown"].includes(label)) ?? undefined,
    transcript: transcripts.filter((fact) => overlap(fact.startMs, fact.endMs, shot.startMs, shot.endMs)).slice(0, 30).map((fact) => ({ factId: fact.id, startMs: fact.startMs, endMs: fact.endMs, text: shortText(fact.text, 500) })),
    ocr: ocr.filter((fact) => overlap(fact.startMs, fact.endMs, shot.startMs, shot.endMs)).slice(0, 30).map((fact) => ({ factId: fact.id, startMs: fact.startMs, endMs: fact.endMs, text: shortText(fact.text, 500) })),
  }));
}

function analysisForVideo(awemeId: string, status: ResearchAnalysisUpdate["status"], facts: ResearchTimelineFact[], analyzedAt: string, summary: string) {
  const shots = facts.filter((fact) => fact.kind === "shot");
  const transcripts = facts.filter((fact) => fact.kind === "transcript").sort((left, right) => left.startMs - right.startMs);
  const ocr = facts.filter((fact) => fact.kind === "ocr");
  return {
    status,
    analyzedAt,
    summary: shortText(summary, 500),
    factCount: facts.length,
    shotCount: shots.length,
    transcriptCount: transcripts.length,
    ocrCount: ocr.length,
    missingKinds: (["shot", "transcript", "ocr"] as const).filter((kind) => !facts.some((fact) => fact.kind === kind)),
    openingText: transcripts.filter((fact) => fact.startMs < 3_000).slice(0, 8).map((fact) => shortText(fact.text, 500)),
    timeline: timelineForFacts(awemeId, facts),
  };
}

function profilePayload(profile: TikHubProfile) {
  return { nickname: profile.nickname, signature: profile.signature, followerCount: profile.followerCount, followingCount: profile.followingCount, awemeCount: profile.awemeCount };
}

function publicUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function videoToBenchmark(video: TikHubVideoMetadata, capturedAt: string): { video: BenchmarkVideo; evidence: ResearchEvidence } {
  const evidenceId = `evidence-video-${video.awemeId}`;
  return {
    video: BenchmarkVideoSchema.parse({ schemaVersion: 1, awemeId: video.awemeId, description: video.description, createTime: video.createTime, shareUrl: publicUrl(video.shareUrl), durationMs: video.durationMs, coverUrl: publicUrl(video.coverUrl), statistics: video.statistics ?? {}, evidenceIds: [evidenceId], artifactIds: [], mediaAnalysisStatus: "metadata_only" }),
    evidence: ResearchEvidenceSchema.parse({ schemaVersion: 1, id: evidenceId, type: "video_metadata", sourceId: video.awemeId, label: `作品 ${video.awemeId}`, payload: { description: video.description, createTime: video.createTime, durationMs: video.durationMs, statistics: video.statistics ?? {} }, capturedAt }),
  };
}

export async function buildAccountResearchReport(input: { workspaceId: string; sourceInput: string; connector: ResearchConnector; count?: number; now?: string }) {
  const count = input.count ?? 20;
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("对标账号首轮分析数量必须在 1–20 之间");
  const capturedAt = input.now ?? new Date().toISOString();
  const secUserId = await input.connector.resolveSecUserId(input.sourceInput);
  const profile = await input.connector.fetchProfile(secUserId);
  const posts = await input.connector.fetchUserPosts({ secUserId, count, maxCursor: 0, sortType: 0 });
  const mapped = posts.items.map((video) => videoToBenchmark(video, capturedAt));
  const coverageEvidenceId = `evidence-coverage-${secUserId}-${capturedAt.replace(/[^0-9]/g, "")}`;
  const evidence = [ResearchEvidenceSchema.parse({ schemaVersion: 1, id: `evidence-profile-${secUserId}`, type: "profile", sourceId: secUserId, label: "账号资料快照", payload: profilePayload(profile), capturedAt }), ...mapped.map((item) => item.evidence), ResearchEvidenceSchema.parse({ schemaVersion: 1, id: coverageEvidenceId, type: "coverage", sourceId: secUserId, label: "首轮覆盖范围", payload: { requested: count, received: mapped.length, hasMore: posts.hasMore, mediaAnalysisStatus: "metadata_only" }, capturedAt })];
  const report = AccountResearchReportSchema.parse({ schemaVersion: 1, id: `account-research-${secUserId}-${capturedAt.replace(/[^0-9]/g, "")}`, workspaceId: input.workspaceId, providerKey: posts.providerKey, sourceInput: input.sourceInput, secUserId, profile: profilePayload(profile), videos: mapped.map((item) => item.video), coverage: { requested: count, received: mapped.length, metadataAnalyzed: mapped.length, mediaAnalyzed: 0, mediaPartiallyAnalyzed: 0, missingMedia: mapped.length, hasMore: posts.hasMore, note: "当前为公开元数据首轮；选择具体作品后才下载并执行 ASR/OCR/镜头分析。" }, findings: [{ id: `finding-needs-media-${secUserId}`, kind: "needs_media_analysis", title: "待选择作品做画面拆解", detail: "元数据已取得；请从列表选择 3–5 条，再执行本地媒体分析。", evidenceIds: [coverageEvidenceId] }], evidence, createdAt: capturedAt });
  return report;
}

export function attachResearchMedia(report: AccountResearchReport, attachments: ResearchMediaAttachment[]) {
  const attachmentByAwemeId = new Map(attachments.map((attachment) => [attachment.awemeId, attachment]));
  const videos = report.videos.map((video) => {
    const attachment = attachmentByAwemeId.get(video.awemeId);
    if (!attachment) return video;
    return BenchmarkVideoSchema.parse({ ...video, artifactIds: [...new Set(attachment.artifactIds)], mediaAnalysisStatus: "queued" });
  });
  const missingMedia = videos.filter((video) => video.artifactIds.length === 0).length;
  const updated = AccountResearchReportSchema.parse({
    ...report,
    videos,
    coverage: { ...report.coverage, missingMedia, note: missingMedia === 0 ? "选中作品已本地化，等待 ASR/OCR/镜头分析。" : `已本地化 ${videos.length - missingMedia} 条，仍有 ${missingMedia} 条未下载；可继续选择后补齐。` },
    findings: [{ id: `finding-needs-media-${report.secUserId}`, kind: "needs_media_analysis", title: "本地素材已就绪，等待画面拆解", detail: "已写入素材库。下一步执行 ASR、OCR 和镜头检测，结论会回挂到作品证据。", evidenceIds: report.findings.flatMap((finding) => finding.evidenceIds) }],
  });
  return updated;
}

export function attachResearchAnalysis(report: AccountResearchReport, updates: ResearchAnalysisUpdate[]) {
  const updateByAwemeId = new Map(updates.map((update) => [update.awemeId, update]));
  const evidence = new Map(report.evidence.map((item) => [item.id, item]));
  const videos = report.videos.map((video) => {
    const update = updateByAwemeId.get(video.awemeId);
    if (!update) return video;
    const evidenceId = `evidence-media-${video.awemeId}-${update.analyzedAt.replace(/[^0-9]/g, "")}`;
    evidence.set(evidenceId, ResearchEvidenceSchema.parse({ schemaVersion: 1, id: evidenceId, type: "media_fact", sourceId: video.awemeId, label: "本地媒体分析摘要", payload: { artifactIds: video.artifactIds, factIds: update.factIds, summary: update.summary, analyzedAt: update.analyzedAt }, capturedAt: update.analyzedAt }));
    return BenchmarkVideoSchema.parse({
      ...video,
      mediaAnalysisStatus: update.status,
      analysisFactIds: [...new Set(update.factIds)],
      analysis: update.facts ? analysisForVideo(video.awemeId, update.status, update.facts, update.analyzedAt, update.summary) : video.analysis,
      evidenceIds: [...new Set([...video.evidenceIds, evidenceId])],
    });
  });
  const mediaAnalyzed = videos.filter((video) => video.mediaAnalysisStatus === "completed").length;
  const mediaPartiallyAnalyzed = videos.filter((video) => video.mediaAnalysisStatus === "partial").length;
  return AccountResearchReportSchema.parse({ ...report, videos, evidence: [...evidence.values()], coverage: { ...report.coverage, mediaAnalyzed, mediaPartiallyAnalyzed, note: `已完成 ${mediaAnalyzed} 条，部分完成 ${mediaPartiallyAnalyzed} 条；ASR/OCR 未配置时会保留已完成的镜头事实。` }, findings: [{ id: `finding-analysis-${report.secUserId}`, kind: "needs_media_analysis", title: mediaPartiallyAnalyzed > 0 ? "镜头事实已就绪，仍有分析缺口" : "媒体拆解已完成", detail: mediaPartiallyAnalyzed > 0 ? "镜头切点已写入素材库；请配置中文 ASR/OCR 后补齐文案和画面文字。" : "本地媒体事实已写入素材库，可用于 AI 剪辑提案和账号模式分析。", evidenceIds: videos.flatMap((video) => video.evidenceIds) }] });
}

/**
 * Turn local, time-coded facts into a conservative account-level pattern.
 * This is descriptive evidence, not a causal performance claim: it reports
 * what was actually observed in the selected local copies and leaves topic
 * recommendations to a later, evidence-linked agent step.
 */
export function attachResearchMediaPatterns(report: AccountResearchReport, summaries: ResearchMediaFactSummary[]) {
  if (summaries.length === 0) return report;
  const validSummaries = summaries.filter((summary) => report.videos.some((video) => video.awemeId === summary.awemeId));
  if (validSummaries.length === 0) return report;
  const allFacts = validSummaries.flatMap((summary) => summary.facts);
  const shotFacts = allFacts.filter((fact) => fact.kind === "shot");
  const transcriptFacts = allFacts.filter((fact) => fact.kind === "transcript");
  const ocrFacts = allFacts.filter((fact) => fact.kind === "ocr");
  const shotDurations = shotFacts.map((fact) => fact.endMs - fact.startMs).filter((duration) => duration > 0);
  const averageShotDurationMs = shotDurations.length > 0 ? Math.round(shotDurations.reduce((sum, duration) => sum + duration, 0) / shotDurations.length) : undefined;
  const evidenceId = `evidence-media-pattern-${report.secUserId}-${Math.max(...validSummaries.map((summary) => Date.parse(summary.analyzedAt)))}`;
  const capturedAt = validSummaries.map((summary) => summary.analyzedAt).sort().at(-1) ?? new Date().toISOString();
  const evidence = ResearchEvidenceSchema.parse({ schemaVersion: 1, id: evidenceId, type: "media_fact", sourceId: report.secUserId, label: "选中作品的本地镜头与文字模式", payload: {
    analyzedVideoCount: validSummaries.length,
    totalShotCount: shotFacts.length,
    averageShotDurationMs,
    transcriptSegmentCount: transcriptFacts.length,
    ocrCueCount: ocrFacts.length,
    openingTranscriptSamples: transcriptFacts.filter((fact) => fact.startMs < 3_000).sort((left, right) => left.startMs - right.startMs).slice(0, 5).map((fact) => ({ artifactId: fact.artifactId, startMs: fact.startMs, text: fact.text })),
    artifactIds: [...new Set(validSummaries.flatMap((summary) => summary.artifactIds))],
  }, capturedAt });
  const shotDescription = averageShotDurationMs === undefined ? "镜头时长尚未形成稳定统计" : `平均镜头约 ${(averageShotDurationMs / 1000).toFixed(1)} 秒`;
  const patternFinding = {
    id: `finding-media-pattern-${report.secUserId}`,
    kind: "media_pattern" as const,
    title: `已拆解 ${validSummaries.length} 条作品的镜头与文字事实`,
    detail: `${shotDescription}；共检测 ${shotFacts.length} 个粗切镜头、${transcriptFacts.length} 段 ASR、${ocrFacts.length} 条 OCR。它描述的是已选作品样本，不代表账号整体因果规律。`,
    evidenceIds: [evidenceId],
  };
  const findings = [patternFinding, ...report.findings.filter((finding) => finding.kind !== "media_pattern")];
  const opportunities = validSummaries.flatMap((summary) => {
    const video = report.videos.find((candidate) => candidate.awemeId === summary.awemeId);
    if (!video) return [];
    const transcript = summary.facts.filter((fact) => fact.kind === "transcript").sort((left, right) => left.startMs - right.startMs)[0];
    const sourceEvidenceIds = [...video.evidenceIds, evidenceId];
    const title = transcript ? `把“${shortText(transcript.text, 36)}”换成你的真实案例` : `沿用 ${video.awemeId} 的画面节奏，换成你的观点`;
    const angle = transcript
      ? `保留“先抛具体判断、再展开解释”的开头结构，改用你亲身经历或可核验资料，不复述对标账号原话。`
      : `参考已观察到的镜头切换节奏，补一条能证明你观点的 B-roll，再用自己的口播完成解释。`;
    return [AccountResearchOpportunitySchema.parse({ schemaVersion: 1, id: `account-opportunity-${report.secUserId}-${summary.awemeId}`, title, angle, whyNow: `来自 ${summary.awemeId} 的本地时间码事实；这是待审阅的切入假设，不代表该账号整体因果规律。`, sourceVideoIds: [summary.awemeId], evidenceIds: sourceEvidenceIds.slice(0, 20), status: "candidate" })];
  });
  const opportunityFindings = opportunities.map((opportunity) => ({ id: `finding-${opportunity.id}`, kind: "topic_opportunity" as const, title: opportunity.title, detail: opportunity.angle, evidenceIds: opportunity.evidenceIds }));
  const evidenceById = new Map(report.evidence.map((item) => [item.id, item]));
  evidenceById.set(evidence.id, evidence);
  return AccountResearchReportSchema.parse({ ...report, evidence: [...evidenceById.values()], opportunities, findings: [...opportunityFindings, ...findings.filter((finding) => finding.kind !== "topic_opportunity")] });
}

export function markResearchMediaFailures(report: AccountResearchReport, awemeIds: string[]) {
  const failed = new Set(awemeIds);
  if (failed.size === 0) return report;
  const videos = report.videos.map((video) => failed.has(video.awemeId) && video.artifactIds.length === 0
    ? BenchmarkVideoSchema.parse({ ...video, mediaAnalysisStatus: "failed" })
    : video);
  return AccountResearchReportSchema.parse({
    ...report,
    videos,
    findings: [{ id: `finding-media-failures-${report.secUserId}`, kind: "needs_media_analysis", title: "部分作品未能本地化", detail: "部分作品下载或导入失败；可稍后重试，已成功本地化的素材不重复下载。", evidenceIds: report.findings.flatMap((finding) => finding.evidenceIds) }],
  });
}

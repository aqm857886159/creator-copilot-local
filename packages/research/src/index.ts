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
}).strict();
export type BenchmarkVideo = z.infer<typeof BenchmarkVideoSchema>;

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
  findings: z.array(z.object({ id, kind: z.enum(["metadata_pattern", "topic_opportunity", "needs_media_analysis"]), title: id, detail: z.string().min(1), evidenceIds: z.array(id) }).strict()),
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
};

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
  const evidence = [...report.evidence];
  const videos = report.videos.map((video) => {
    const update = updateByAwemeId.get(video.awemeId);
    if (!update) return video;
    const evidenceId = `evidence-media-${video.awemeId}-${update.analyzedAt.replace(/[^0-9]/g, "")}`;
    evidence.push(ResearchEvidenceSchema.parse({ schemaVersion: 1, id: evidenceId, type: "media_fact", sourceId: video.awemeId, label: "本地媒体分析摘要", payload: { artifactIds: video.artifactIds, factIds: update.factIds, summary: update.summary, analyzedAt: update.analyzedAt }, capturedAt: update.analyzedAt }));
    return BenchmarkVideoSchema.parse({ ...video, mediaAnalysisStatus: update.status, analysisFactIds: [...new Set(update.factIds)], evidenceIds: [...new Set([...video.evidenceIds, evidenceId])] });
  });
  const mediaAnalyzed = videos.filter((video) => video.mediaAnalysisStatus === "completed").length;
  const mediaPartiallyAnalyzed = videos.filter((video) => video.mediaAnalysisStatus === "partial").length;
  return AccountResearchReportSchema.parse({ ...report, videos, evidence, coverage: { ...report.coverage, mediaAnalyzed, mediaPartiallyAnalyzed, note: `已完成 ${mediaAnalyzed} 条，部分完成 ${mediaPartiallyAnalyzed} 条；ASR/OCR 未配置时会保留已完成的镜头事实。` }, findings: [{ id: `finding-analysis-${report.secUserId}`, kind: "needs_media_analysis", title: mediaPartiallyAnalyzed > 0 ? "镜头事实已就绪，仍有分析缺口" : "媒体拆解已完成", detail: mediaPartiallyAnalyzed > 0 ? "镜头切点已写入素材库；请配置中文 ASR/OCR 后补齐文案和画面文字。" : "本地媒体事实已写入素材库，可用于 AI 剪辑提案和账号模式分析。", evidenceIds: videos.flatMap((video) => video.evidenceIds) }] });
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

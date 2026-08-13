import { z } from "zod";
import type { ResearchConnector, TikHubProfile, TikHubVideoMetadata } from "../../providers/src/index.js";

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
  mediaAnalysisStatus: z.enum(["not_requested", "metadata_only", "queued", "completed", "failed"]),
}).strict();
export type BenchmarkVideo = z.infer<typeof BenchmarkVideoSchema>;

export const ResearchEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  type: z.enum(["profile", "video_metadata", "metric", "coverage"]),
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
  coverage: z.object({ requested: z.number().int().positive(), received: z.number().int().nonnegative(), metadataAnalyzed: z.number().int().nonnegative(), mediaAnalyzed: z.number().int().nonnegative(), missingMedia: z.number().int().nonnegative(), hasMore: z.boolean(), note: z.string().min(1) }).strict(),
  findings: z.array(z.object({ id, kind: z.enum(["metadata_pattern", "topic_opportunity", "needs_media_analysis"]), title: id, detail: z.string().min(1), evidenceIds: z.array(id) }).strict()),
  evidence: z.array(ResearchEvidenceSchema),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type AccountResearchReport = z.infer<typeof AccountResearchReportSchema>;

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
    video: BenchmarkVideoSchema.parse({ schemaVersion: 1, awemeId: video.awemeId, description: video.description, createTime: video.createTime, shareUrl: publicUrl(video.shareUrl), durationMs: video.durationMs, coverUrl: publicUrl(video.coverUrl), statistics: video.statistics ?? {}, evidenceIds: [evidenceId], mediaAnalysisStatus: "metadata_only" }),
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
  const report = AccountResearchReportSchema.parse({ schemaVersion: 1, id: `account-research-${secUserId}-${capturedAt.replace(/[^0-9]/g, "")}`, workspaceId: input.workspaceId, providerKey: posts.providerKey, sourceInput: input.sourceInput, secUserId, profile: profilePayload(profile), videos: mapped.map((item) => item.video), coverage: { requested: count, received: mapped.length, metadataAnalyzed: mapped.length, mediaAnalyzed: 0, missingMedia: mapped.length, hasMore: posts.hasMore, note: "当前为公开元数据首轮；选择具体作品后才下载并执行 ASR/OCR/镜头分析。" }, findings: [{ id: `finding-needs-media-${secUserId}`, kind: "needs_media_analysis", title: "待选择作品做画面拆解", detail: "元数据已取得；请从列表选择 3–5 条，再执行本地媒体分析。", evidenceIds: [coverageEvidenceId] }], evidence, createdAt: capturedAt });
  return report;
}

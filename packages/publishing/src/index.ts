import { createHash } from "node:crypto";
import { copyFile, mkdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import { z } from "zod";

const id = z.string().min(1);
const isoDate = z.string().datetime({ offset: true });

export const PublishFileSchema = z.object({
  kind: z.enum(["video", "subtitle", "manifest", "cover"]),
  relativePath: z.string().min(1),
  mimeType: id,
  contentHash: id,
  byteSize: z.number().int().nonnegative(),
}).strict();
export type PublishFile = z.infer<typeof PublishFileSchema>;

export const PublishPackageManifestSchema = z.object({
  schemaVersion: z.literal(1),
  packageId: id,
  projectId: id,
  renderRunId: id,
  platform: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5_000),
  hashtags: z.array(z.string().trim().min(1).max(64)).max(30),
  rightsNote: z.string().max(2_000),
  files: z.array(PublishFileSchema).min(1),
  sourceArtifactIds: z.array(id),
  createdAt: isoDate,
  warnings: z.array(z.string()),
}).strict();
export type PublishPackageManifest = z.infer<typeof PublishPackageManifestSchema>;

export const PublicationSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  projectId: id,
  packageId: id,
  platform: z.string().min(1).max(64),
  status: z.enum(["draft", "published", "failed", "removed"]),
  publishedAt: isoDate.optional(),
  externalId: id.optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Publication = z.infer<typeof PublicationSchema>;

const nullableNonNegative = z.number().nonnegative().nullable();

export const MetricSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  publicationId: id,
  capturedAt: isoDate,
  window: z.string().min(1).max(32),
  source: z.enum(["manual", "connector"]),
  metrics: z.object({
    views: z.number().int().nonnegative().nullable(),
    likes: z.number().int().nonnegative().nullable(),
    comments: z.number().int().nonnegative().nullable(),
    shares: z.number().int().nonnegative().nullable(),
    saves: z.number().int().nonnegative().nullable(),
    completionRate: z.number().min(0).max(1).nullable(),
    averageWatchSeconds: nullableNonNegative,
    newFollowers: z.number().int().nonnegative().nullable(),
  }).strict(),
  sourceEvidenceId: id.optional(),
  notes: z.string().max(2_000),
}).strict();
export type MetricSnapshot = z.infer<typeof MetricSnapshotSchema>;

export const ReviewMemoryProposalSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  workspaceId: id,
  sourcePublicationIds: z.array(id).min(1),
  evidenceSnapshotIds: z.array(id).min(1),
  statement: z.string().trim().min(1).max(2_000),
  confidence: z.number().min(0).max(1),
  appliesTo: z.object({
    pillars: z.array(z.string().min(1)),
    formats: z.array(z.string().min(1)),
    platforms: z.array(z.string().min(1)),
  }).strict(),
  status: z.enum(["candidate", "confirmed", "rejected", "expired"]),
  createdAt: isoDate,
  confirmedAt: isoDate.optional(),
}).strict();
export type ReviewMemoryProposal = z.infer<typeof ReviewMemoryProposalSchema>;

export type PublishSourceFiles = { video: string; subtitle?: string; manifest?: string; cover?: string };

function mimeTypeForPath(path: string) {
  const extension = extname(path).toLowerCase();
  return ({ ".mp4": "video/mp4", ".mov": "video/quicktime", ".srt": "application/x-subrip", ".vtt": "text/vtt", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" } as Record<string, string>)[extension] ?? "application/octet-stream";
}

async function sha256File(path: string) {
  return new Promise<string>((resolveHash, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(`sha256:${digest.digest("hex")}`));
  });
}

function ensureWithin(root: string, target: string) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedRoot !== resolvedTarget && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) throw new Error("发布包路径越过工作区");
}

async function ensureSourceWithin(root: string, sourcePath: string) {
  const canonicalRoot = await realpath(root);
  const canonicalSource = await realpath(sourcePath);
  ensureWithin(canonicalRoot, canonicalSource);
  return canonicalSource;
}

async function copyAtomically(sourcePath: string, targetPath: string) {
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await copyFile(sourcePath, temporaryPath);
  await rename(temporaryPath, targetPath);
}

export async function exportPublishPackage(input: {
  workspaceRoot: string;
  packageId: string;
  projectId: string;
  renderRunId: string;
  platform: string;
  title: string;
  description?: string;
  hashtags?: string[];
  rightsNote?: string;
  sourceArtifactIds: string[];
  sourceFiles: PublishSourceFiles;
  createdAt?: string;
}) {
  const root = await realpath(input.workspaceRoot);
  const packageRelativeDir = `publish/${input.packageId}`;
  const packageDir = resolve(root, packageRelativeDir);
  ensureWithin(root, packageDir);
  await mkdir(packageDir, { recursive: true });
  const entries: Array<{ kind: PublishFile["kind"]; source: string; target: string }> = [
    { kind: "video", source: input.sourceFiles.video, target: "video.mp4" },
    ...(input.sourceFiles.subtitle ? [{ kind: "subtitle" as const, source: input.sourceFiles.subtitle, target: basename(input.sourceFiles.subtitle).toLowerCase().endsWith(".vtt") ? "subtitle.vtt" : "subtitle.srt" }] : []),
    ...(input.sourceFiles.manifest ? [{ kind: "manifest" as const, source: input.sourceFiles.manifest, target: "render.manifest.json" }] : []),
    ...(input.sourceFiles.cover ? [{ kind: "cover" as const, source: input.sourceFiles.cover, target: `cover${extname(input.sourceFiles.cover).toLowerCase() || ".jpg"}` }] : []),
  ];
  const files: PublishFile[] = [];
  for (const entry of entries) {
    const source = await ensureSourceWithin(root, entry.source);
    const destination = resolve(packageDir, entry.target);
    ensureWithin(root, destination);
    const sourceStats = await stat(source);
    if (!sourceStats.isFile() || sourceStats.size === 0) throw new Error(`发布包源文件无效：${entry.kind}`);
    await copyAtomically(source, destination);
    const destinationStats = await stat(destination);
    files.push({ kind: entry.kind, relativePath: relative(root, destination).split(sep).join("/"), mimeType: mimeTypeForPath(destination), contentHash: await sha256File(destination), byteSize: destinationStats.size });
  }
  const manifest = PublishPackageManifestSchema.parse({
    schemaVersion: 1,
    packageId: input.packageId,
    projectId: input.projectId,
    renderRunId: input.renderRunId,
    platform: input.platform,
    title: input.title,
    description: input.description ?? "",
    hashtags: [...new Set((input.hashtags ?? []).map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean))],
    rightsNote: input.rightsNote ?? "请确认视频、音乐、字体和素材均具备发布所需权利。",
    files,
    sourceArtifactIds: [...new Set(input.sourceArtifactIds)],
    createdAt: input.createdAt ?? new Date().toISOString(),
    warnings: ["本发布包不执行平台自动发布；请在目标平台手动确认可见范围、音乐和版权。"],
  });
  const manifestPath = resolve(packageDir, "publish-package.manifest.json");
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, manifestBody, "utf8");
  return { manifest: PublishPackageManifestSchema.parse(manifest), manifestPath, packageDir, files };
}

export function proposeReviewMemory(input: { workspaceId: string; sourcePublicationIds: string[]; snapshots: MetricSnapshot[]; statement: string; appliesTo?: Partial<ReviewMemoryProposal["appliesTo"]>; confidence?: number; now?: string }) {
  const snapshots = input.snapshots.map((snapshot) => MetricSnapshotSchema.parse(snapshot));
  if (snapshots.length === 0) throw new Error("复盘记忆建议至少需要一条指标证据");
  return ReviewMemoryProposalSchema.parse({ schemaVersion: 1, id: `memory-proposal-${Date.now()}`, workspaceId: input.workspaceId, sourcePublicationIds: [...new Set(input.sourcePublicationIds)], evidenceSnapshotIds: snapshots.map((snapshot) => snapshot.id), statement: input.statement, confidence: input.confidence ?? Math.min(0.95, 0.55 + snapshots.length * 0.08), appliesTo: { pillars: input.appliesTo?.pillars ?? [], formats: input.appliesTo?.formats ?? [], platforms: input.appliesTo?.platforms ?? [] }, status: "candidate", createdAt: input.now ?? new Date().toISOString() });
}

import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, dirname, extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { stableStringify } from "../../contracts/src/index.js";
import { ScriptSchema, ShootTaskSchema, StoryboardSchema, TakeSchema, type Script, type ShootTask, type Storyboard, type Take } from "../../creation/src/index.js";

const execFile = promisify(execFileCallback);
const id = z.string().min(1);
const hash = z.string().min(1);
const nonNegativeMs = z.number().int().nonnegative();

export const TimeRangeSchema = z.object({ startMs: nonNegativeMs, endMs: nonNegativeMs }).strict().superRefine((range, context) => {
  if (range.endMs <= range.startMs) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endMs"], message: "时间范围必须大于 0" });
});
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const OutputProfileSchema = z.object({
  container: z.enum(["mp4", "mov", "webm"]),
  videoCodec: z.enum(["h264", "hevc", "vp9", "source"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  videoBitrate: z.number().int().positive().optional(),
  audioCodec: z.enum(["aac", "opus", "pcm"]),
  audioSampleRate: z.number().int().positive(),
  subtitle: z.enum(["none", "srt", "vtt", "burn_in"]),
}).strict();
export type OutputProfile = z.infer<typeof OutputProfileSchema>;

export const SourceClipSchema = z.object({
  id,
  shotId: id.optional(),
  sourceAssetId: id,
  sourceSegment: TimeRangeSchema,
  timeline: TimeRangeSchema,
  role: z.enum(["a_roll", "b_roll", "screen", "generated", "still"]),
  placement: z.enum(["primary", "overlay"]).optional(),
  transform: z.object({ x: z.number().optional(), y: z.number().optional(), scale: z.number().positive().optional(), rotation: z.number().optional(), crop: z.string().optional() }).strict().optional(),
  opacity: z.number().min(0).max(1).optional(),
  volume: z.number().nonnegative().optional(),
}).strict();
export type SourceClip = z.infer<typeof SourceClipSchema>;

export const SubtitleClipSchema = z.object({
  id,
  timeline: TimeRangeSchema,
  text: z.string().min(1),
  styleRef: id.optional(),
}).strict();
export type SubtitleClip = z.infer<typeof SubtitleClipSchema>;

const ProposalOperationSchema = SourceClipSchema.extend({
  reason: z.string().min(1),
  evidenceIds: z.array(id),
  confidence: z.number().min(0).max(1),
  status: z.enum(["suggested", "accepted", "rejected"]),
}).strict();
export type ProposalOperation = z.infer<typeof ProposalOperationSchema>;

export const EditProposalSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  projectId: id,
  basedOn: z.object({ scriptRevision: z.number().int().positive(), storyboardRevision: z.number().int().positive() }).strict(),
  durationMs: z.number().int().positive(),
  operations: z.array(ProposalOperationSchema),
  subtitles: z.array(SubtitleClipSchema),
  outputProfile: OutputProfileSchema,
  rationale: z.array(z.object({ operationId: id, shotId: id.optional(), reason: z.string().min(1), confidence: z.number().min(0).max(1).optional() }).strict()),
  status: z.enum(["draft", "previewed", "partially_adopted", "adopted", "rejected"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type EditProposal = z.infer<typeof EditProposalSchema>;

export const FrozenTrackSchema = z.object({
  id,
  kind: z.enum(["video", "audio", "subtitle", "text", "effect"]),
  layer: z.enum(["primary", "overlay"]).optional(),
  clips: z.array(z.union([SourceClipSchema, SubtitleClipSchema])),
}).strict().superRefine((track, context) => {
  if (track.kind !== "video" && track.kind !== "subtitle") context.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "当前剪辑规格只支持 video/subtitle 轨道" });
  if (track.layer !== undefined && track.kind !== "video") context.addIssue({ code: z.ZodIssueCode.custom, path: ["layer"], message: "只有视频轨道可以声明 primary/overlay" });
  for (const [index, clip] of track.clips.entries()) {
    const sourceClip = "sourceAssetId" in clip;
    if (track.kind === "video" && !sourceClip) context.addIssue({ code: z.ZodIssueCode.custom, path: ["clips", index], message: "视频轨道只能包含视频片段" });
    if (track.kind === "subtitle" && sourceClip) context.addIssue({ code: z.ZodIssueCode.custom, path: ["clips", index], message: "字幕轨道只能包含字幕片段" });
    if (track.kind === "video" && sourceClip) {
      if (track.layer === "primary" && clip.placement !== "primary") context.addIssue({ code: z.ZodIssueCode.custom, path: ["clips", index, "placement"], message: "primary 轨道只能包含 primary 片段" });
      if (track.layer === "overlay" && clip.placement !== "overlay") context.addIssue({ code: z.ZodIssueCode.custom, path: ["clips", index, "placement"], message: "overlay 轨道只能包含 overlay 片段" });
      if (track.layer === undefined && clip.placement !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["clips", index, "placement"], message: "旧单轨片段不能声明 layered placement" });
    }
  }
});
export type FrozenTrack = z.infer<typeof FrozenTrackSchema>;

export const FrozenEditSpecSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  projectId: id,
  revision: z.number().int().positive(),
  sourceProposalId: id.optional(),
  durationMs: z.number().int().positive(),
  tracks: z.array(FrozenTrackSchema),
  outputProfile: OutputProfileSchema,
  assetLocks: z.array(z.object({ assetId: id, contentHash: hash }).strict()),
  authoredSpecHash: hash,
  status: z.enum(["draft", "frozen", "compiled", "rendered", "validated", "delivered"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((spec, context) => {
  const videoTracks = spec.tracks.filter((track) => track.kind === "video");
  const layered = videoTracks.some((track) => track.layer !== undefined);
  const primaryCount = videoTracks.filter((track) => track.layer === "primary").length;
  if (videoTracks.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tracks"], message: "剪辑规格必须包含视频轨道" });
  if (layered && (primaryCount !== 1 || videoTracks.some((track) => track.layer === undefined))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tracks"], message: "layered 剪辑必须且只能有一条 primary 视频轨，且所有视频轨都要声明 layer" });
  if (!layered && videoTracks.length !== 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tracks"], message: "旧单轨剪辑只能有一条视频轨道" });
});
export type FrozenEditSpec = z.infer<typeof FrozenEditSpecSchema>;

export const RenderClipSchema = z.object({
  id,
  shotId: id.optional(),
  sourceAssetId: id,
  sourceRelativePath: z.string().min(1),
  sourceContentHash: hash,
  sourceSegment: TimeRangeSchema,
  timeline: TimeRangeSchema,
  role: z.enum(["a_roll", "b_roll", "screen", "generated", "still"]),
  placement: z.enum(["primary", "overlay"]).optional(),
  opacity: z.number().min(0).max(1).optional(),
  volume: z.number().nonnegative().optional(),
}).strict();
export type RenderClip = z.infer<typeof RenderClipSchema>;

export const RenderTrackSchema = z.object({
  id,
  kind: z.enum(["video", "audio", "subtitle", "text", "effect"]),
  layer: z.enum(["primary", "overlay"]).optional(),
  clips: z.array(z.union([RenderClipSchema, SubtitleClipSchema])),
}).strict().superRefine((track, context) => {
  if (track.kind !== "video" && track.kind !== "subtitle") context.addIssue({ code: z.ZodIssueCode.custom, path: ["kind"], message: "当前 RenderIR 只支持 video/subtitle 轨道" });
  if (track.layer !== undefined && track.kind !== "video") context.addIssue({ code: z.ZodIssueCode.custom, path: ["layer"], message: "只有视频轨道可以声明 primary/overlay" });
  for (const [index, clip] of track.clips.entries()) {
    const renderClip = "sourceAssetId" in clip;
    if (track.kind === "video" && !renderClip) context.addIssue({ code: z.ZodIssueCode.custom, path: ["clips", index], message: "视频轨道只能包含视频片段" });
    if (track.kind === "subtitle" && renderClip) context.addIssue({ code: z.ZodIssueCode.custom, path: ["clips", index], message: "字幕轨道只能包含字幕片段" });
    if (track.kind === "video" && renderClip) {
      if (track.layer === "primary" && clip.placement !== "primary") context.addIssue({ code: z.ZodIssueCode.custom, path: ["clips", index, "placement"], message: "primary 轨道只能包含 primary 片段" });
      if (track.layer === "overlay" && clip.placement !== "overlay") context.addIssue({ code: z.ZodIssueCode.custom, path: ["clips", index, "placement"], message: "overlay 轨道只能包含 overlay 片段" });
      if (track.layer === undefined && clip.placement !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["clips", index, "placement"], message: "旧单轨片段不能声明 layered placement" });
    }
  }
});
export type RenderTrack = z.infer<typeof RenderTrackSchema>;

export const RenderIRSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.literal("render-ir/1"),
  projectId: id,
  frozenEditSpecId: id,
  resolvedSpecHash: hash,
  durationMs: z.number().int().positive(),
  tracks: z.array(RenderTrackSchema),
  outputProfile: OutputProfileSchema,
  deterministic: z.literal(true),
}).strict().superRefine((ir, context) => {
  const videoTracks = ir.tracks.filter((track) => track.kind === "video");
  const layered = videoTracks.some((track) => track.layer !== undefined);
  const primaryCount = videoTracks.filter((track) => track.layer === "primary").length;
  if (videoTracks.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tracks"], message: "RenderIR 必须包含视频轨道" });
  if (layered && (primaryCount !== 1 || videoTracks.some((track) => track.layer === undefined))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tracks"], message: "layered RenderIR 必须且只能有一条 primary 视频轨" });
  if (!layered && videoTracks.length !== 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["tracks"], message: "旧单轨 RenderIR 只能有一条视频轨道" });
});
export type RenderIR = z.infer<typeof RenderIRSchema>;

export const RenderManifestSchema = z.object({
  schemaVersion: z.literal(1),
  renderId: id,
  projectId: id,
  frozenEditSpecId: id,
  resolvedSpecHash: hash,
  outputProfile: OutputProfileSchema,
  durationMs: z.number().int().positive(),
  assets: z.array(z.object({ assetId: id, relativePath: z.string().min(1), contentHash: hash }).strict()),
  outputs: z.array(z.object({ kind: z.enum(["video", "subtitle", "manifest"]), relativePath: z.string().min(1), contentHash: hash, byteSize: z.number().int().nonnegative(), mimeType: id }).strict()),
  renderer: z.object({ name: id, version: id, ffmpegPath: id.optional() }).strict(),
  warnings: z.array(z.string()),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type RenderManifest = z.infer<typeof RenderManifestSchema>;

export const ExchangeLossSchema = z.object({
  kind: z.enum(["subtitle", "transform", "audio", "track", "unsupported"]),
  sourceId: id,
  severity: z.enum(["warning", "error"]),
  message: z.string().min(1),
}).strict();
export type ExchangeLoss = z.infer<typeof ExchangeLossSchema>;

export const ExchangeCapabilityReportSchema = z.object({
  schemaVersion: z.literal(1),
  adapter: z.enum(["fcpxml", "otio"]),
  formatVersion: id,
  supported: z.array(id),
  losses: z.array(ExchangeLossSchema),
}).strict();
export type ExchangeCapabilityReport = z.infer<typeof ExchangeCapabilityReportSchema>;

export const DEFAULT_VERTICAL_PROFILE: OutputProfile = {
  container: "mp4",
  videoCodec: "h264",
  width: 1080,
  height: 1920,
  fps: 30,
  audioCodec: "aac",
  audioSampleRate: 48_000,
  subtitle: "srt",
};

export type RenderAsset = {
  assetId: string;
  relativePath: string;
  absolutePath: string;
  contentHash: string;
  durationMs: number;
  hasVideo?: boolean;
  hasAudio?: boolean;
};

export type CaptureAssetFact = {
  contentHash: string;
  durationMs?: number;
};

export type EditProposalMissingMaterial = {
  shotId: string;
  taskId?: string;
  reason: "take_not_selected" | "asset_fact_missing" | "no_suitable_asset";
  instruction: string;
  required?: boolean;
};

/**
 * A local, auditable fallback proposer. It turns the user's selected Takes into
 * the same EditProposal contract that a model-backed proposer will use later.
 * It never invents an asset: missing or unselected material is returned as a
 * visible gap instead of being silently replaced.
 */
export function proposeEditFromCapture(input: {
  projectId: string;
  script: Script;
  storyboard: Storyboard;
  tasks: ShootTask[];
  takesByTask: Record<string, Take[]>;
  assetFacts: Record<string, CaptureAssetFact>;
  now: string;
}) {
  const script = ScriptSchema.parse(input.script);
  const storyboard = StoryboardSchema.parse(input.storyboard);
  const tasks = input.tasks.map((task) => ShootTaskSchema.parse(task));
  const taskByShot = new Map(tasks.map((task) => [task.shotId, task]));
  const blockById = new Map(script.blocks.map((block) => [block.id, block]));
  const missing: EditProposalMissingMaterial[] = [];
  let cursorMs = 0;
  const operations: ProposalOperation[] = [];
  const subtitles: SubtitleClip[] = [];
  const assetLocks = new Map<string, { assetId: string; contentHash: string }>();

  const roleForShot = (shot: Storyboard["shots"][number]): SourceClip["role"] => shot.mode === "talking_head" ? "a_roll" : shot.mode === "broll" ? "b_roll" : shot.mode === "screen_recording" ? "screen" : shot.mode === "still" ? "still" : "generated";
  const selectedForShot = (shot: Storyboard["shots"][number], required: boolean) => {
    const task = taskByShot.get(shot.id);
    const selectedTake = task ? input.takesByTask[task.id]?.map((take) => TakeSchema.parse(take)).find((take) => take.status === "selected") : undefined;
    if (!task || !selectedTake) {
      missing.push({ shotId: shot.id, taskId: task?.id, reason: "take_not_selected", instruction: task?.instruction ?? shot.actionDescription, required });
      return undefined;
    }
    const assetFact = input.assetFacts[selectedTake.assetId];
    if (!assetFact) {
      missing.push({ shotId: shot.id, taskId: task.id, reason: "asset_fact_missing", instruction: "素材事实尚未准备好，请重新导入或等待素材分析完成", required });
      return undefined;
    }
    const availableMs = assetFact.durationMs ?? selectedTake.durationMs ?? shot.targetMs;
    if (availableMs <= 0) {
      missing.push({ shotId: shot.id, taskId: task.id, reason: "asset_fact_missing", instruction: "素材没有有效时长", required });
      return undefined;
    }
    assetLocks.set(selectedTake.assetId, { assetId: selectedTake.assetId, contentHash: assetFact.contentHash });
    return { task, selectedTake, assetFact, availableMs };
  };

  const shotsByBlock = new Map(script.blocks.map((block) => [block.id, storyboard.shots.filter((shot) => shot.scriptBlockIds.includes(block.id)).sort((left, right) => left.order - right.order)]));
  const layered = script.blocks.length > 0 && script.blocks.every((block) => shotsByBlock.get(block.id)?.some((shot) => shot.mode === "talking_head"));

  if (layered) {
    for (const block of [...script.blocks].sort((left, right) => left.order - right.order)) {
      const blockShots = shotsByBlock.get(block.id) ?? [];
      const primaryShot = blockShots.find((shot) => shot.mode === "talking_head");
      if (!primaryShot) continue;
      const primary = selectedForShot(primaryShot, true);
      if (!primary) continue;
      const primaryDurationMs = Math.min(primaryShot.targetMs, primary.availableMs);
      const blockStartMs = cursorMs;
      const blockEndMs = blockStartMs + primaryDurationMs;
      operations.push({ id: `proposal-op-${primaryShot.id}`, shotId: primaryShot.id, sourceAssetId: primary.selectedTake.assetId, sourceSegment: { startMs: 0, endMs: primaryDurationMs }, timeline: { startMs: blockStartMs, endMs: blockEndMs }, role: "a_roll", placement: "primary", reason: primaryShot.actionDescription, evidenceIds: [primaryShot.id, primary.task.id], confidence: 0.86, status: "suggested" });
      if (block.text.trim()) subtitles.push({ id: `subtitle-${primaryShot.id}`, timeline: { startMs: blockStartMs, endMs: blockEndMs }, text: block.text.trim() });

      let overlayCursorMs = blockStartMs + Math.min(500, Math.floor(primaryDurationMs * 0.15));
      for (const overlayShot of blockShots.filter((shot) => shot.mode !== "talking_head")) {
        const overlay = selectedForShot(overlayShot, false);
        if (!overlay) continue;
        const remainingMs = blockEndMs - overlayCursorMs;
        const overlayDurationMs = Math.min(overlayShot.targetMs, overlay.availableMs, remainingMs);
        if (overlayDurationMs <= 0) {
          missing.push({ shotId: overlayShot.id, taskId: overlay.task.id, reason: "no_suitable_asset", instruction: "当前段落没有足够的主干时长容纳这条补充画面", required: false });
          continue;
        }
        operations.push({ id: `proposal-op-${overlayShot.id}`, shotId: overlayShot.id, sourceAssetId: overlay.selectedTake.assetId, sourceSegment: { startMs: 0, endMs: overlayDurationMs }, timeline: { startMs: overlayCursorMs, endMs: overlayCursorMs + overlayDurationMs }, role: roleForShot(overlayShot), placement: "overlay", reason: overlayShot.actionDescription, evidenceIds: [overlayShot.id, overlay.task.id], confidence: 0.82, status: "suggested", volume: 0 });
        overlayCursorMs += overlayDurationMs;
      }
      cursorMs = blockEndMs;
    }
    if (missing.some((item) => item.required !== false)) return { status: "needs_material" as const, missing };
    if (operations.length === 0 || cursorMs <= 0) return { status: "needs_material" as const, missing: [{ shotId: storyboard.id, reason: "no_suitable_asset" as const, instruction: "没有可用于口播主干的已选素材", required: true }] };
    const proposal = EditProposalSchema.parse({ schemaVersion: 1, id: `proposal-${input.projectId}-${Date.now()}`, projectId: input.projectId, basedOn: { scriptRevision: script.revision, storyboardRevision: storyboard.revision }, durationMs: cursorMs, operations, subtitles, outputProfile: DEFAULT_VERTICAL_PROFILE, rationale: operations.map((operation) => ({ operationId: operation.id, shotId: operation.shotId, reason: operation.reason, confidence: operation.confidence })), status: "previewed", createdAt: input.now, updatedAt: input.now });
    return { status: "ready" as const, missing, proposal, assetLocks: [...assetLocks.values()].sort((left, right) => left.assetId.localeCompare(right.assetId)) };
  }

  for (const shot of [...storyboard.shots].sort((left, right) => left.order - right.order)) {
    const selected = selectedForShot(shot, true);
    if (!selected) continue;
    const durationMs = Math.min(shot.targetMs, selected.availableMs);
    operations.push({ id: `proposal-op-${shot.id}`, shotId: shot.id, sourceAssetId: selected.selectedTake.assetId, sourceSegment: { startMs: 0, endMs: durationMs }, timeline: { startMs: cursorMs, endMs: cursorMs + durationMs }, role: roleForShot(shot), reason: shot.actionDescription, evidenceIds: [shot.id, selected.task.id], confidence: 0.86, status: "suggested" });
    const text = shot.scriptBlockIds.map((blockId) => blockById.get(blockId)?.text).filter((value): value is string => Boolean(value)).join(" ").trim();
    if (text) subtitles.push({ id: `subtitle-${shot.id}`, timeline: { startMs: cursorMs, endMs: cursorMs + durationMs }, text });
    cursorMs += durationMs;
  }
  if (missing.length > 0) return { status: "needs_material" as const, missing };
  const proposal = EditProposalSchema.parse({ schemaVersion: 1, id: `proposal-${input.projectId}-${Date.now()}`, projectId: input.projectId, basedOn: { scriptRevision: script.revision, storyboardRevision: storyboard.revision }, durationMs: cursorMs, operations, subtitles, outputProfile: DEFAULT_VERTICAL_PROFILE, rationale: operations.map((operation) => ({ operationId: operation.id, reason: operation.reason, confidence: operation.confidence })), status: "previewed", createdAt: input.now, updatedAt: input.now });
  return { status: "ready" as const, missing: [], proposal, assetLocks: [...assetLocks.values()].sort((left, right) => left.assetId.localeCompare(right.assetId)) };
}

function sha256Text(value: unknown) {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

async function sha256File(path: string) {
  const { createReadStream } = await import("node:fs");
  return new Promise<string>((resolveHash, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(`sha256:${digest.digest("hex")}`));
  });
}

async function atomicWriteText(targetPath: string, body: string) {
  await mkdir(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, body, "utf8");
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function sortByTimeline<T extends { id: string; timeline: TimeRange }>(clips: T[]) {
  return [...clips].sort((left, right) => left.timeline.startMs - right.timeline.startMs || left.timeline.endMs - right.timeline.endMs || left.id.localeCompare(right.id));
}

function assertTimeline(clips: Array<{ id: string; timeline: TimeRange }>, durationMs: number, label: string) {
  const sorted = sortByTimeline(clips);
  let previousEnd = 0;
  for (const clip of sorted) {
    if (clip.timeline.endMs > durationMs) throw new Error(`${label} ${clip.id} 超出项目时长`);
    if (clip.timeline.startMs < previousEnd) throw new Error(`${label} ${clip.id} 与前一个片段重叠`);
    previousEnd = clip.timeline.endMs;
  }
}

function assertContiguousTimeline(clips: Array<{ id: string; timeline: TimeRange }>, durationMs: number, label: string) {
  const sorted = sortByTimeline(clips);
  assertTimeline(sorted, durationMs, label);
  if (sorted.length === 0 || sorted[0].timeline.startMs !== 0 || sorted[sorted.length - 1].timeline.endMs !== durationMs) {
    throw new Error(`${label} 必须从 0 覆盖到项目结束时间`);
  }
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].timeline.endMs !== sorted[index].timeline.startMs) throw new Error(`${label} 存在未覆盖的时间缺口`);
  }
}

function assertSourceDurationMatchesTimeline(clips: Array<{ id: string; sourceSegment: TimeRange; timeline: TimeRange }>, label: string) {
  for (const clip of clips) {
    const sourceDurationMs = clip.sourceSegment.endMs - clip.sourceSegment.startMs;
    const timelineDurationMs = clip.timeline.endMs - clip.timeline.startMs;
    if (sourceDurationMs !== timelineDurationMs) {
      throw new Error(`${label} ${clip.id} 的源片段时长与成片时长不一致；当前版本不支持隐式变速`);
    }
  }
}

function assertSupportedClipSemantics(clips: Array<{ id: string; placement?: "primary" | "overlay"; transform?: unknown; opacity?: number; volume?: number }>, label: string) {
  for (const clip of clips) {
    if (clip.transform !== undefined) throw new Error(`${label} ${clip.id} 使用了当前剪辑内核尚未实现的画面变换`);
    if (clip.opacity !== undefined && clip.opacity !== 1) throw new Error(`${label} ${clip.id} 使用了当前剪辑内核尚未实现的透明度`);
    if (clip.placement === "overlay") {
      if (clip.volume !== undefined && clip.volume !== 0) throw new Error(`${label} ${clip.id} 的覆盖画面不能接管主音频`);
    } else if (clip.volume !== undefined && clip.volume !== 1) {
      throw new Error(`${label} ${clip.id} 使用了当前剪辑内核尚未实现的主干音量调整`);
    }
  }
}

function assertVideoTrackTimelines(tracks: Array<{ kind: string; layer?: "primary" | "overlay"; clips: Array<SourceClip | RenderClip | SubtitleClip> }>, durationMs: number) {
  const videoTracks = tracks.filter((track) => track.kind === "video");
  const layered = videoTracks.some((track) => track.layer !== undefined);
  const primaryTrack = layered ? videoTracks.find((track) => track.layer === "primary") : videoTracks[0];
  if (!primaryTrack) throw new Error("剪辑规格缺少视频主干轨道");
  assertContiguousTimeline(primaryTrack.clips as Array<SourceClip | RenderClip>, durationMs, layered ? "口播主干" : "视频片段");
  for (const track of videoTracks.filter((track) => track.layer === "overlay")) assertTimeline(track.clips as RenderClip[], durationMs, "画面覆盖");
}

function sourceClipsFromProposal(proposal: EditProposal, selectedOperationIds?: string[]) {
  const selected = selectedOperationIds ? new Set(selectedOperationIds) : undefined;
  const operations = proposal.operations.filter((operation) => operation.status !== "rejected" && (!selected || selected.has(operation.id)));
  if (operations.length === 0) throw new Error("没有可冻结的剪辑操作");
  return sortByTimeline(operations).map(({ reason: _reason, evidenceIds: _evidenceIds, confidence: _confidence, status: _status, ...clip }) => SourceClipSchema.parse(clip));
}

export function freezeEditProposal(input: { proposal: EditProposal; assetLocks: Array<{ assetId: string; contentHash: string }>; selectedOperationIds?: string[]; now?: string }) {
  const proposal = EditProposalSchema.parse(input.proposal);
  const now = input.now ?? proposal.updatedAt;
  const clips = sourceClipsFromProposal(proposal, input.selectedOperationIds);
  assertSourceDurationMatchesTimeline(clips, "视频片段");
  assertSupportedClipSemantics(clips, "视频片段");
  assertTimeline(proposal.subtitles, proposal.durationMs, "字幕");
  const layered = clips.some((clip) => clip.placement !== undefined);
  let videoTracks: FrozenTrack[];
  if (layered) {
    const primaryClips = clips.filter((clip) => clip.placement !== "overlay");
    const overlayClips = clips.filter((clip) => clip.placement === "overlay");
    assertContiguousTimeline(primaryClips, proposal.durationMs, "口播主干");
    assertTimeline(overlayClips, proposal.durationMs, "画面覆盖");
    videoTracks = [
      { id: `${proposal.id}-primary-video`, kind: "video", layer: "primary", clips: primaryClips },
      ...(overlayClips.length > 0 ? [{ id: `${proposal.id}-overlay-video`, kind: "video" as const, layer: "overlay" as const, clips: overlayClips }] : []),
    ];
  } else {
    assertContiguousTimeline(clips, proposal.durationMs, "视频片段");
    videoTracks = [{ id: `${proposal.id}-video`, kind: "video", clips }];
  }
  const tracks: FrozenTrack[] = [...videoTracks, ...(proposal.subtitles.length > 0 ? [{ id: `${proposal.id}-subtitle`, kind: "subtitle" as const, clips: sortByTimeline(proposal.subtitles) }] : [])];
  const candidate = {
    schemaVersion: 1 as const,
    id: `${proposal.id}-frozen-${proposal.updatedAt.replace(/[^0-9]/g, "").slice(-14)}`,
    projectId: proposal.projectId,
    revision: 1,
    sourceProposalId: proposal.id,
    durationMs: proposal.durationMs,
    tracks,
    outputProfile: proposal.outputProfile,
    assetLocks: [...input.assetLocks].sort((left, right) => left.assetId.localeCompare(right.assetId)),
    authoredSpecHash: "pending",
    status: "frozen" as const,
    createdAt: now,
    updatedAt: now,
  };
  const { authoredSpecHash: _pendingAuthoredHash, ...authoredHashInput } = candidate;
  const authoredSpecHash = sha256Text(authoredHashInput);
  return FrozenEditSpecSchema.parse({ ...candidate, authoredSpecHash });
}

export function compileFrozenEditSpec(input: { spec: FrozenEditSpec; assets: Record<string, RenderAsset> }) {
  const spec = FrozenEditSpecSchema.parse(input.spec);
  const { authoredSpecHash, ...authoredSpec } = spec;
  if (sha256Text(authoredSpec) !== authoredSpecHash) throw new Error("FrozenEditSpec 内容与 authoredSpecHash 不一致");
  assertVideoTrackTimelines(spec.tracks, spec.durationMs);
  const locks = new Map(spec.assetLocks.map((lock) => [lock.assetId, lock]));
  const renderTracks: RenderTrack[] = spec.tracks.map((track) => {
    const clips = track.kind === "subtitle" ? sortByTimeline(track.clips as SubtitleClip[]) : sortByTimeline(track.clips as SourceClip[]).map((clip) => {
      const asset = input.assets[clip.sourceAssetId];
      const lock = locks.get(clip.sourceAssetId);
      if (!asset || !lock) throw new Error(`缺少素材锁：${clip.sourceAssetId}`);
      if (asset.contentHash !== lock.contentHash) throw new Error(`素材 hash 已变化：${clip.sourceAssetId}`);
      if (clip.sourceSegment.endMs > asset.durationMs) throw new Error(`素材片段超出源素材时长：${clip.id}`);
      return RenderClipSchema.parse({
        id: clip.id,
        shotId: clip.shotId,
        sourceAssetId: asset.assetId,
        sourceRelativePath: asset.relativePath,
        sourceContentHash: asset.contentHash,
        sourceSegment: clip.sourceSegment,
        timeline: clip.timeline,
        role: clip.role,
        placement: clip.placement,
        opacity: clip.opacity,
        volume: clip.volume,
      });
    });
    if (track.kind === "video") {
      assertSourceDurationMatchesTimeline(clips as RenderClip[], `${track.layer === "overlay" ? "画面覆盖" : "视频主干"}轨道`);
      assertSupportedClipSemantics(clips as RenderClip[], `${track.layer === "overlay" ? "画面覆盖" : "视频主干"}轨道`);
    }
    assertTimeline(clips, spec.durationMs, `${track.kind} 轨道`);
    return RenderTrackSchema.parse({ ...track, clips });
  });
  const ir = RenderIRSchema.parse({
    schemaVersion: 1,
    version: "render-ir/1",
    projectId: spec.projectId,
    frozenEditSpecId: spec.id,
    resolvedSpecHash: sha256Text(spec),
    durationMs: spec.durationMs,
    tracks: renderTracks,
    outputProfile: spec.outputProfile,
    deterministic: true,
  });
  assertVideoTrackTimelines(ir.tracks, ir.durationMs);
  return ir;
}

function xmlEscape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function frameDurationForFps(fps: number) {
  if (Math.abs(fps - 30000 / 1001) < 0.001) return "1001/30000s";
  if (Math.abs(fps - 60000 / 1001) < 0.001) return "1001/60000s";
  return `1/${Math.max(1, Math.round(fps))}s`;
}

function exchangeAssets(ir: RenderIR) {
  const clips = ir.tracks.filter((track) => track.kind === "video").flatMap((track) => track.clips as RenderClip[]);
  const byId = new Map<string, { sourceAssetId: string; sourceRelativePath: string; sourceContentHash: string; availableEndMs: number }>();
  for (const clip of clips) {
    const existing = byId.get(clip.sourceAssetId);
    if (!existing) byId.set(clip.sourceAssetId, { sourceAssetId: clip.sourceAssetId, sourceRelativePath: clip.sourceRelativePath, sourceContentHash: clip.sourceContentHash, availableEndMs: clip.sourceSegment.endMs });
    else existing.availableEndMs = Math.max(existing.availableEndMs, clip.sourceSegment.endMs);
  }
  return [...byId.values()].sort((left, right) => left.sourceAssetId.localeCompare(right.sourceAssetId));
}

export function exportFcpXml(input: { ir: RenderIR; workspaceRoot: string; formatVersion?: string }) {
  const ir = RenderIRSchema.parse(input.ir);
  const root = resolve(input.workspaceRoot);
  const assets = exchangeAssets(ir);
  const losses: ExchangeLoss[] = [];
  const subtitleClips = ir.tracks.filter((track) => track.kind === "subtitle").flatMap((track) => track.clips as SubtitleClip[]);
  if (subtitleClips.length > 0) losses.push({ kind: "subtitle", sourceId: ir.frozenEditSpecId, severity: "warning", message: "基线 FCPXML 适配器保留媒体时间线，但不生成带样式的字幕 Title；请同时使用 SRT。" });
  const overlayTracks = ir.tracks.filter((track) => track.kind === "video" && track.layer === "overlay");
  if (overlayTracks.length > 0) losses.push({ kind: "track", sourceId: ir.frozenEditSpecId, severity: "warning", message: "基线 FCPXML spine 适配器暂不映射 B-roll 覆盖轨；请使用 OTIO 或本地 MP4。" });
  for (const clip of ir.tracks.flatMap((track) => track.clips as Array<RenderClip | SubtitleClip>)) {
    if ("sourceAssetId" in clip && (clip.opacity !== undefined || clip.volume !== undefined)) losses.push({ kind: clip.volume !== undefined ? "audio" : "transform", sourceId: clip.id, severity: "warning", message: "基线 FCPXML 适配器暂不映射 opacity/volume 参数。" });
  }
  const formatVersion = input.formatVersion ?? "1.11";
  const formatId = "format-1";
  const resources = [
    `<format id="${formatId}" name="Creator Copilot" frameDuration="${frameDurationForFps(ir.outputProfile.fps)}" width="${ir.outputProfile.width}" height="${ir.outputProfile.height}"/>`,
    ...assets.map((clip, index) => {
      const path = resolve(root, clip.sourceRelativePath);
      ensureWithin(root, path);
      return `<asset id="asset-${index + 1}" name="${xmlEscape(clip.sourceAssetId)}" src="${xmlEscape(pathToFileURL(path).href)}" start="0s" duration="${seconds(clip.availableEndMs)}s" hasVideo="1" hasAudio="1" format="${formatId}"/>`;
    }),
  ].join("\n    ");
  const assetIds = new Map(assets.map((clip, index) => [clip.sourceAssetId, `asset-${index + 1}`]));
  const spineTrack = ir.tracks.find((track) => track.kind === "video" && track.layer === "primary") ?? ir.tracks.find((track) => track.kind === "video");
  const spine = (spineTrack?.clips as RenderClip[] ?? []).map((clip) => `<asset-clip name="${xmlEscape(clip.id)}" ref="${assetIds.get(clip.sourceAssetId) ?? ""}" offset="${seconds(clip.timeline.startMs)}s" start="${seconds(clip.sourceSegment.startMs)}s" duration="${seconds(clip.sourceSegment.endMs - clip.sourceSegment.startMs)}s"/>`).join("\n        ");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="${xmlEscape(formatVersion)}">\n  <resources>\n    ${resources}\n  </resources>\n  <library>\n    <event name="Creator Copilot">\n      <project name="${xmlEscape(ir.projectId)}">\n        <sequence format="${formatId}" duration="${seconds(ir.durationMs)}s">\n          <spine>\n        ${spine}\n          </spine>\n        </sequence>\n      </project>\n    </event>\n  </library>\n</fcpxml>\n`;
  const report = ExchangeCapabilityReportSchema.parse({ schemaVersion: 1, adapter: "fcpxml", formatVersion, supported: ["video", "audio", "asset references"], losses });
  return { body, report };
}

function otioTime(valueMs: number, fps: number) {
  return { OTIO_SCHEMA: "RationalTime.1", value: Number(((valueMs / 1000) * fps).toFixed(6)), rate: fps };
}

export function exportOtio(input: { ir: RenderIR; workspaceRoot: string }) {
  const ir = RenderIRSchema.parse(input.ir);
  const root = resolve(input.workspaceRoot);
  const losses: ExchangeLoss[] = [];
  const subtitleClips = ir.tracks.filter((track) => track.kind === "subtitle").flatMap((track) => track.clips as SubtitleClip[]);
  if (subtitleClips.length > 0) losses.push({ kind: "subtitle", sourceId: ir.frozenEditSpecId, severity: "warning", message: "OTIO 基线适配器保留视频时间线；字幕请使用同目录 SRT。" });
  const tracks = ir.tracks.filter((track) => track.kind === "video").map((track) => {
    const clips = sortByTimeline(track.clips as RenderClip[]);
    const children: unknown[] = [];
    let cursorMs = 0;
    for (const clip of clips) {
      if (clip.timeline.startMs > cursorMs) children.push({ OTIO_SCHEMA: "Gap.1", name: `Gap ${cursorMs}-${clip.timeline.startMs}`, source_range: { OTIO_SCHEMA: "TimeRange.1", start_time: otioTime(0, ir.outputProfile.fps), duration: otioTime(clip.timeline.startMs - cursorMs, ir.outputProfile.fps) } });
      const absolutePath = resolve(root, clip.sourceRelativePath);
      ensureWithin(root, absolutePath);
      children.push({
        OTIO_SCHEMA: "Clip.2",
        name: clip.id,
        source_range: { OTIO_SCHEMA: "TimeRange.1", start_time: otioTime(clip.sourceSegment.startMs, ir.outputProfile.fps), duration: otioTime(clip.sourceSegment.endMs - clip.sourceSegment.startMs, ir.outputProfile.fps) },
        media_reference: { OTIO_SCHEMA: "ExternalReference.1", target_url: pathToFileURL(absolutePath).href, available_range: { OTIO_SCHEMA: "TimeRange.1", start_time: otioTime(0, ir.outputProfile.fps), duration: otioTime(clip.sourceSegment.endMs, ir.outputProfile.fps) }, metadata: { creatorCopilot: { assetId: clip.sourceAssetId, contentHash: clip.sourceContentHash } } },
      });
      cursorMs = clip.timeline.endMs;
    }
    if (cursorMs < ir.durationMs) children.push({ OTIO_SCHEMA: "Gap.1", name: `Gap ${cursorMs}-${ir.durationMs}`, source_range: { OTIO_SCHEMA: "TimeRange.1", start_time: otioTime(0, ir.outputProfile.fps), duration: otioTime(ir.durationMs - cursorMs, ir.outputProfile.fps) } });
    return { OTIO_SCHEMA: "Track.1", name: track.id, kind: "Video", children };
  });
  const timeline = { OTIO_SCHEMA: "Timeline.1", name: ir.projectId, global_start_time: otioTime(0, ir.outputProfile.fps), duration: otioTime(ir.durationMs, ir.outputProfile.fps), tracks: { OTIO_SCHEMA: "Stack.1", children: tracks } };
  const report = ExchangeCapabilityReportSchema.parse({ schemaVersion: 1, adapter: "otio", formatVersion: "OTIO 1.x JSON", supported: ["video", "audio", "external media references", "content hashes"], losses });
  return { body: `${JSON.stringify(timeline, null, 2)}\n`, report };
}

function srtTimestamp(milliseconds: number) {
  const totalMs = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1_000);
  const ms = totalMs % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function renderSrt(ir: RenderIR) {
  const subtitleTracks = ir.tracks.filter((track) => track.kind === "subtitle");
  const subtitles = subtitleTracks.flatMap((track) => track.clips as SubtitleClip[]).sort((left, right) => left.timeline.startMs - right.timeline.startMs || left.id.localeCompare(right.id));
  return subtitles.map((clip, index) => `${index + 1}\n${srtTimestamp(clip.timeline.startMs)} --> ${srtTimestamp(clip.timeline.endMs)}\n${clip.text.trim()}\n`).join("\n");
}

function ensureWithin(root: string, target: string) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedRoot !== resolvedTarget && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) throw new Error("渲染输出路径越过工作区");
}

function seconds(milliseconds: number) {
  return (milliseconds / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

function codecArgs(profile: OutputProfile) {
  if (profile.container !== "mp4" || profile.videoCodec !== "h264" || profile.audioCodec !== "aac") throw new Error("当前参考剪辑内核只支持 MP4/H.264/AAC；其他格式保留为 OutputProfile 合同");
  return ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", String(profile.audioSampleRate), "-movflags", "+faststart"];
}

export async function renderMp4(input: { ir: RenderIR; assets: Record<string, RenderAsset>; outputPath: string; ffmpegPath?: string; runner?: (binary: string, args: string[]) => Promise<{ stdout: string; stderr: string }> }) {
  const ir = RenderIRSchema.parse(input.ir);
  const videoTracks = ir.tracks.filter((track) => track.kind === "video");
  const primaryTrack = videoTracks.find((track) => track.layer === "primary") ?? videoTracks[0];
  if (!primaryTrack || primaryTrack.clips.length === 0) throw new Error("RenderIR 缺少视频主干轨道");
  if (ir.outputProfile.subtitle === "burn_in") throw new Error("V4b reference renderer 尚未支持烧录字幕，请导出 SRT/VTT");
  const primaryClips = sortByTimeline(primaryTrack.clips as RenderClip[]);
  const overlayClips = videoTracks.filter((track) => track !== primaryTrack && track.layer === "overlay").flatMap((track) => track.clips as RenderClip[]);
  assertSourceDurationMatchesTimeline([...primaryClips, ...overlayClips], "RenderIR 视频片段");
  assertSupportedClipSemantics([...primaryClips, ...overlayClips], "RenderIR 视频片段");
  assertVideoTrackTimelines(ir.tracks, ir.durationMs);
  const assets = [...primaryClips, ...sortByTimeline(overlayClips)].map((clip) => {
    const asset = input.assets[clip.sourceAssetId];
    if (!asset || !isAbsolute(asset.absolutePath)) throw new Error(`缺少素材路径：${clip.sourceAssetId}`);
    return { clip, asset };
  });
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const { clip, asset } of assets) args.push("-ss", seconds(clip.sourceSegment.startMs), "-t", seconds(clip.sourceSegment.endMs - clip.sourceSegment.startMs), "-i", asset.absolutePath);
  const filters: string[] = [];
  const primaryVideoRefs: string[] = [];
  const primaryAudioRefs: string[] = [];
  for (const [index, { clip, asset }] of assets.slice(0, primaryClips.length).entries()) {
    const videoRef = `primary-v${index}`;
    const audioRef = `primary-a${index}`;
    filters.push(`[${index}:v]scale=${ir.outputProfile.width}:${ir.outputProfile.height}:force_original_aspect_ratio=decrease,pad=${ir.outputProfile.width}:${ir.outputProfile.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${ir.outputProfile.fps},format=yuv420p,setpts=PTS-STARTPTS[${videoRef}]`);
    if (asset.hasAudio === false) filters.push(`anullsrc=r=${ir.outputProfile.audioSampleRate}:cl=stereo,atrim=duration=${seconds(clip.sourceSegment.endMs - clip.sourceSegment.startMs)},asetpts=PTS-STARTPTS[${audioRef}]`);
    else filters.push(`[${index}:a]aresample=${ir.outputProfile.audioSampleRate},asetpts=PTS-STARTPTS[${audioRef}]`);
    primaryVideoRefs.push(`[${videoRef}]`);
    primaryAudioRefs.push(`[${audioRef}]`);
  }
  filters.push(`${primaryVideoRefs.map((reference, index) => `${reference}${primaryAudioRefs[index]}`).join("")}concat=n=${primaryClips.length}:v=1:a=1[basev][aout]`);
  let currentVideo = "[basev]";
  for (const [overlayIndex, { clip }] of assets.slice(primaryClips.length).entries()) {
    const inputIndex = primaryClips.length + overlayIndex;
    const overlayRef = `overlay-v${overlayIndex}`;
    const nextVideo = `mixed-v${overlayIndex}`;
    filters.push(`[${inputIndex}:v]scale=${ir.outputProfile.width}:${ir.outputProfile.height}:force_original_aspect_ratio=decrease,pad=${ir.outputProfile.width}:${ir.outputProfile.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${ir.outputProfile.fps},format=yuv420p,setpts=PTS-STARTPTS+${seconds(clip.timeline.startMs)}/TB[${overlayRef}]`);
    filters.push(`${currentVideo}[${overlayRef}]overlay=0:0:eof_action=pass:shortest=0[${nextVideo}]`);
    currentVideo = `[${nextVideo}]`;
  }
  filters.push(`${currentVideo}format=yuv420p[vout]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "[aout]", "-r", String(ir.outputProfile.fps), ...codecArgs(ir.outputProfile), input.outputPath);
  await mkdir(dirname(input.outputPath), { recursive: true });
  const temporaryPath = `${input.outputPath}.tmp-${process.pid}-${Date.now()}${extname(input.outputPath) || ".mp4"}`;
  try {
    const run = input.runner ?? (async (binary, commandArgs) => {
      const result = await execFile(binary, commandArgs, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
      return { stdout: result.stdout, stderr: result.stderr };
    });
    const temporaryArgs = [...args.slice(0, -1), temporaryPath];
    await run(input.ffmpegPath ?? "ffmpeg", temporaryArgs);
    await stat(temporaryPath);
    await rename(temporaryPath, input.outputPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return input.outputPath;
}

async function probeRenderedDurationMs(outputPath: string, ffprobePath = "ffprobe") {
  const result = await execFile(ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", outputPath], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  const secondsValue = Number(result.stdout.trim());
  if (!Number.isFinite(secondsValue) || secondsValue <= 0) throw new Error("ffprobe 没有返回有效的成片时长");
  return Math.round(secondsValue * 1000);
}

export async function exportRenderPackage(input: {
  workspaceRoot: string;
  renderId: string;
  frozenEditSpec: FrozenEditSpec;
  assets: Record<string, RenderAsset>;
  outputRelativePath?: string;
  subtitleRelativePath?: string;
  manifestRelativePath?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
}) {
  const spec = FrozenEditSpecSchema.parse(input.frozenEditSpec);
  const root = resolve(input.workspaceRoot);
  const ir = compileFrozenEditSpec({ spec, assets: input.assets });
  const outputRelativePath = input.outputRelativePath ?? `exports/${input.renderId}.mp4`;
  const subtitleRelativePath = input.subtitleRelativePath ?? `exports/${input.renderId}.srt`;
  const manifestRelativePath = input.manifestRelativePath ?? `exports/${input.renderId}.manifest.json`;
  const outputPath = resolve(root, outputRelativePath);
  const subtitlePath = resolve(root, subtitleRelativePath);
  const manifestPath = resolve(root, manifestRelativePath);
  for (const target of [outputPath, subtitlePath, manifestPath]) ensureWithin(root, target);
  for (const asset of Object.values(input.assets)) {
    if (!isAbsolute(asset.absolutePath)) throw new Error(`素材路径必须是绝对路径：${asset.assetId}`);
    ensureWithin(root, asset.absolutePath);
  }
  await renderMp4({ ir, assets: input.assets, outputPath, ffmpegPath: input.ffmpegPath });
  let renderedDurationMs: number;
  try {
    renderedDurationMs = await probeRenderedDurationMs(outputPath, input.ffprobePath);
  } catch (error) {
    await rm(outputPath, { force: true });
    throw error;
  }
  const durationToleranceMs = Math.max(100, Math.ceil(2000 / ir.outputProfile.fps));
  if (Math.abs(renderedDurationMs - ir.durationMs) > durationToleranceMs) {
    await rm(outputPath, { force: true });
    throw new Error(`成片时长 ${renderedDurationMs}ms 与已确认时间线 ${ir.durationMs}ms 不一致`);
  }
  const subtitleText = renderSrt(ir);
  const outputs: RenderManifest["outputs"] = [];
  const outputHash = await sha256File(outputPath);
  const outputStats = await stat(outputPath);
  outputs.push({ kind: "video", relativePath: relative(root, outputPath).split(sep).join("/"), contentHash: outputHash, byteSize: outputStats.size, mimeType: "video/mp4" });
  if (spec.outputProfile.subtitle === "srt" && subtitleText) {
    await atomicWriteText(subtitlePath, subtitleText);
    const subtitleHash = await sha256File(subtitlePath);
    const subtitleStats = await stat(subtitlePath);
    outputs.push({ kind: "subtitle", relativePath: relative(root, subtitlePath).split(sep).join("/"), contentHash: subtitleHash, byteSize: subtitleStats.size, mimeType: "application/x-subrip" });
  }
  const now = new Date().toISOString();
  const manifest = RenderManifestSchema.parse({
    schemaVersion: 1,
    renderId: input.renderId,
    projectId: spec.projectId,
    frozenEditSpecId: spec.id,
    resolvedSpecHash: ir.resolvedSpecHash,
    outputProfile: spec.outputProfile,
    durationMs: ir.durationMs,
    assets: spec.assetLocks.map((lock) => ({ assetId: lock.assetId, relativePath: input.assets[lock.assetId]?.relativePath ?? "", contentHash: lock.contentHash })),
    outputs,
    renderer: { name: "creator-copilot-reference-renderer", version: "0.1.0", ffmpegPath: input.ffmpegPath ?? "ffmpeg" },
    warnings: [],
    createdAt: now,
  });
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  await atomicWriteText(manifestPath, manifestBody);
  const manifestHash = await sha256File(manifestPath);
  const manifestStats = await stat(manifestPath);
  return { ir, manifest, outputPath, subtitlePath: subtitleText ? subtitlePath : undefined, manifestPath, manifestHash, manifestByteSize: manifestStats.size };
}

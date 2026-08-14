import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
export { AnalysisQualityFixtureSchema, evaluateAnalysisQualityFixture, evaluateOcrQuality, evaluateTranscriptQuality } from "./quality.js";
export type { AnalysisQualityFixture, AnalysisQualityGate, QualityCue } from "./quality.js";
export { AssetCandidateQuerySchema, AssetCandidateSchema, AssetCandidateSetSchema, AssetCandidateSourceSchema, rankAssetCandidates } from "./candidates.js";
export type { AssetCandidate, AssetCandidateQuery, AssetCandidateSearchInput, AssetCandidateSet, AssetCandidateSource } from "./candidates.js";
export { DEFAULT_LOCAL_ANALYSIS_SETTINGS, LocalAnalysisEngineSchema, LocalAnalysisSettingsPatchSchema, LocalAnalysisSettingsSchema, mergeLocalAnalysisSettings, parseLocalAnalysisSettings, workerAnalysisSettings } from "./settings.js";
export type { LocalAnalysisEngine, LocalAnalysisSettings } from "./settings.js";

const execFile = promisify(execFileCallback);
const id = z.string().min(1);
const nonNegativeMs = z.number().int().nonnegative();

export const TranscriptSegmentSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  startMs: nonNegativeMs,
  endMs: z.number().int().positive(),
  text: z.string().min(1),
  language: id.optional(),
  confidence: z.number().min(0).max(1).optional(),
}).strict().superRefine((segment, context) => {
  if (segment.endMs <= segment.startMs) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endMs"], message: "转写片段结束时间必须大于开始时间" });
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const OcrCueSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  startMs: nonNegativeMs,
  endMs: z.number().int().positive(),
  text: z.string().min(1),
  bbox: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().optional(),
  confidence: z.number().min(0).max(1).optional(),
}).strict();
export type OcrCue = z.infer<typeof OcrCueSchema>;

export const ShotFactSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  startMs: nonNegativeMs,
  endMs: z.number().int().positive(),
  detector: id,
  transition: z.enum(["cut", "dissolve", "fade", "unknown"]),
  confidence: z.number().min(0).max(1).optional(),
}).strict().superRefine((shot, context) => {
  if (shot.endMs <= shot.startMs) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endMs"], message: "镜头结束时间必须大于开始时间" });
});
export type ShotFact = z.infer<typeof ShotFactSchema>;

export const AnalysisFactSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  workspaceId: id,
  artifactId: id,
  kind: z.enum(["transcript", "ocr", "shot", "caption", "label"]),
  startMs: nonNegativeMs,
  endMs: z.number().int().positive(),
  text: z.string(),
  labels: z.array(id),
  providerKey: id,
  modelKey: id.optional(),
  contentHash: id,
  analysisRunId: id.optional(),
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((fact, context) => {
  if (fact.endMs <= fact.startMs) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endMs"], message: "分析事实结束时间必须大于开始时间" });
});
export type AnalysisFact = z.infer<typeof AnalysisFactSchema>;

export type AnalysisCommandRunner = (binary: string, args: string[], signal?: AbortSignal) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: AnalysisCommandRunner = async (binary, args, signal) => {
  const result = await execFile(binary, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, signal });
  return { stdout: result.stdout, stderr: result.stderr };
};

export async function prepareWhisperAudio(inputPath: string, options: { runner?: AnalysisCommandRunner; ffmpegPath?: string; signal?: AbortSignal } = {}) {
  const runner = options.runner ?? defaultRunner;
  const outputDirectory = join(tmpdir(), `creator-copilot-whisper-audio-${process.pid}-${Date.now()}`);
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "audio.wav");
  try {
    await runner(options.ffmpegPath ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath], options.signal);
    return { path: outputPath, cleanup: () => rm(outputDirectory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function parseTimestamp(value: unknown, numericUnit: "seconds" | "milliseconds" = "seconds") {
  if (typeof value === "number" && Number.isFinite(value)) return numericUnit === "milliseconds" ? Math.round(value) : Math.round(value * 1000);
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = Number((match[4] ?? "0").padEnd(3, "0"));
  return hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + fraction;
}

function parseWhisperSegment(raw: unknown, index: number, language?: string): TranscriptSegment | undefined {
  if (typeof raw !== "object" || !raw) return undefined;
  const item = raw as Record<string, unknown>;
  const timestamps = typeof item.timestamps === "object" && item.timestamps ? item.timestamps as Record<string, unknown> : {};
  const offsets = typeof item.offsets === "object" && item.offsets ? item.offsets as Record<string, unknown> : {};
  const startValue = timestamps.from ?? item.start ?? item.start_ms;
  const endValue = timestamps.to ?? item.end ?? item.end_ms;
  const startMs = startValue !== undefined ? parseTimestamp(startValue, item.start_ms !== undefined ? "milliseconds" : "seconds") : parseTimestamp(offsets.from, "milliseconds");
  const endMs = endValue !== undefined ? parseTimestamp(endValue, item.end_ms !== undefined ? "milliseconds" : "seconds") : parseTimestamp(offsets.to, "milliseconds");
  const text = typeof item.text === "string" ? item.text.trim() : "";
  if (startMs === undefined || endMs === undefined || endMs <= startMs || !text) return undefined;
  return TranscriptSegmentSchema.parse({ schemaVersion: 1, id: `transcript-${index + 1}`, startMs, endMs, text, language });
}

export function parseWhisperJson(raw: unknown, language?: string) {
  const root = typeof raw === "object" && raw ? raw as Record<string, unknown> : {};
  const candidates = Array.isArray(root.transcription) ? root.transcription : Array.isArray(root.segments) ? root.segments : Array.isArray(root.result) ? root.result : [];
  return candidates.flatMap((segment, index) => {
    try {
      const parsed = parseWhisperSegment(segment, index, language);
      return parsed ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

export class WhisperCppTranscriber {
  constructor(private readonly options: { modelPath: string; binaryPath?: string; language?: string; runner?: AnalysisCommandRunner } ) {}

  async transcribe(inputPath: string, signal?: AbortSignal) {
    if (!this.options.modelPath) throw new Error("whisper.cpp 模型路径未配置");
    const runner = this.options.runner ?? defaultRunner;
    const outputBase = join(tmpdir(), `creator-copilot-whisper-${process.pid}-${Date.now()}`);
    await mkdir(outputBase, { recursive: true });
    const jsonBase = join(outputBase, "transcript");
    try {
      const result = await runner(this.options.binaryPath ?? "whisper-cli", ["-m", this.options.modelPath, "-f", inputPath, "-oj", "-np", "-l", this.options.language ?? "zh", "-of", jsonBase], signal);
      let payload: unknown;
      try {
        payload = JSON.parse(result.stdout);
      } catch {
        const jsonPath = `${jsonBase}.json`;
        payload = JSON.parse(await readFile(jsonPath, "utf8"));
      }
      return parseWhisperJson(payload, this.options.language ?? "zh");
    } finally {
      await rm(outputBase, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Optional Python sidecar adapter for the faster-whisper stack already used
 * by the internal e-cut pipeline. The sidecar is never selected implicitly:
 * callers must provide both a Python executable and an explicit model name or
 * local model directory. This keeps packaged desktop installs honest when a
 * model runtime is not present.
 */
export class FasterWhisperSidecarTranscriber {
  constructor(private readonly options: { modelPath: string; scriptPath: string; pythonPath?: string; language?: string; device?: string; computeType?: string; runner?: AnalysisCommandRunner }) {}

  async transcribe(inputPath: string, signal?: AbortSignal) {
    if (!this.options.modelPath) throw new Error("faster-whisper 模型路径未配置");
    if (!this.options.scriptPath) throw new Error("faster-whisper sidecar 脚本路径未配置");
    const runner = this.options.runner ?? defaultRunner;
    const result = await runner(this.options.pythonPath ?? "python3", [
      this.options.scriptPath,
      "--input", inputPath,
      "--model", this.options.modelPath,
      "--language", this.options.language ?? "zh",
      "--device", this.options.device ?? "cpu",
      "--compute-type", this.options.computeType ?? "int8",
    ], signal);
    let payload: unknown;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      throw new Error("faster-whisper sidecar 没有返回可解析的 JSON");
    }
    return parseWhisperJson(payload, this.options.language ?? "zh");
  }
}

export function parseSceneTimestamps(output: string, durationMs: number) {
  if (!Number.isInteger(durationMs) || durationMs <= 0) throw new Error("镜头检测需要有效的视频时长");
  const timestamps = [...output.matchAll(/pts_time[:=]([0-9]+(?:\.[0-9]+)?)/g)].map((match) => Math.round(Number(match[1]) * 1000)).filter((value) => Number.isFinite(value) && value > 0 && value < durationMs);
  return [...new Set(timestamps)].sort((left, right) => left - right).filter((value, index, values) => index === 0 || value - values[index - 1] >= 50);
}

export class FfmpegSceneDetector {
  constructor(private readonly options: { binaryPath?: string; threshold?: number; runner?: AnalysisCommandRunner } = {}) {}

  async detect(inputPath: string, durationMs: number, signal?: AbortSignal) {
    const threshold = this.options.threshold ?? 0.3;
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) throw new Error("镜头检测 threshold 必须在 0–1 之间");
    const runner = this.options.runner ?? defaultRunner;
    const result = await runner(this.options.binaryPath ?? "ffmpeg", ["-hide_banner", "-i", inputPath, "-an", "-sn", "-dn", "-vf", `select=gt(scene\\,${threshold}),showinfo`, "-f", "null", "-"], signal);
    const cuts = parseSceneTimestamps(`${result.stdout}\n${result.stderr}`, durationMs);
    const boundaries = [0, ...cuts, durationMs];
    return boundaries.slice(0, -1).flatMap((startMs, index) => {
      const endMs = boundaries[index + 1];
      if (endMs <= startMs) return [];
      return [ShotFactSchema.parse({ schemaVersion: 1, id: `shot-${index + 1}`, startMs, endMs, detector: "ffmpeg-scene", transition: index === 0 ? "unknown" : "cut" })];
    });
  }
}

type VisionOcrItem = { path?: string; text?: string; confidence?: number; bbox?: { x?: number; y?: number; width?: number; height?: number } };

export class AppleVisionOcr {
  constructor(private readonly options: { scriptPath: string; binaryPath?: string; ffmpegPath?: string; sampleIntervalMs?: number; runner?: AnalysisCommandRunner }) {}

  async recognize(inputPath: string, durationMs: number, signal?: AbortSignal) {
    if (process.platform !== "darwin") throw new Error("Apple Vision OCR 仅支持 macOS；请改用跨平台 OCR adapter");
    if (!this.options.scriptPath) throw new Error("Apple Vision OCR 脚本路径未配置");
    if (!Number.isInteger(durationMs) || durationMs <= 0) throw new Error("OCR 需要有效的视频时长");
    const sampleIntervalMs = this.options.sampleIntervalMs ?? 1000;
    if (!Number.isInteger(sampleIntervalMs) || sampleIntervalMs < 250) throw new Error("OCR 抽帧间隔不能小于 250ms");
    const runner = this.options.runner ?? defaultRunner;
    const outputDirectory = join(tmpdir(), `creator-copilot-vision-${process.pid}-${Date.now()}`);
    await mkdir(outputDirectory, { recursive: true });
    try {
      await runner(this.options.ffmpegPath ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", inputPath, "-vf", `fps=1/${sampleIntervalMs / 1000}`, "-q:v", "3", join(outputDirectory, "frame-%05d.jpg")], signal);
      const frameNames = (await readdir(outputDirectory)).filter((name) => /^frame-\d+\.jpg$/.test(name)).sort();
      if (frameNames.length === 0) return [];
      const result = await runner(this.options.binaryPath ?? "swift", [this.options.scriptPath, ...frameNames.map((name) => join(outputDirectory, name))], signal);
      const parsed = JSON.parse(result.stdout) as unknown;
      const items = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed && Array.isArray((parsed as { items?: unknown }).items) ? (parsed as { items: unknown[] }).items : [];
      return items.flatMap((raw, index) => {
        if (typeof raw !== "object" || !raw) return [];
        const item = raw as VisionOcrItem;
        const fileName = typeof item.path === "string" ? item.path.split(/[\\/]/).pop() ?? "" : frameNames[index] ?? "";
        const match = fileName.match(/frame-(\d+)\.jpg$/);
        const frameIndex = match ? Math.max(0, Number(match[1]) - 1) : index;
        const startMs = Math.min(durationMs - 1, frameIndex * sampleIntervalMs);
        const endMs = Math.min(durationMs, Math.max(startMs + 1, startMs + sampleIntervalMs));
        const text = typeof item.text === "string" ? item.text.trim() : "";
        if (!text || endMs <= startMs) return [];
        return [OcrCueSchema.parse({ schemaVersion: 1, id: `ocr-${frameIndex + 1}-${index + 1}`, startMs, endMs, text, confidence: typeof item.confidence === "number" ? item.confidence : undefined, bbox: item.bbox && typeof item.bbox.x === "number" && typeof item.bbox.y === "number" && typeof item.bbox.width === "number" && typeof item.bbox.height === "number" ? item.bbox : undefined })];
      });
    } finally {
      await rm(outputDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function normalizeOcrText(text: string) {
  return text.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** Collapse the same persistent overlay across adjacent sampled frames. */
export function mergeOcrCues(cues: OcrCue[], maxGapMs = 1_500) {
  if (!Number.isInteger(maxGapMs) || maxGapMs < 0) throw new Error("OCR 合并间隔必须是非负整数");
  const groups: OcrCue[] = [];
  const latestByText = new Map<string, number>();
  for (const cue of [...cues].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)) {
    const key = normalizeOcrText(cue.text);
    const previousIndex = latestByText.get(key);
    const previous = previousIndex === undefined ? undefined : groups[previousIndex];
    if (previousIndex !== undefined && previous && cue.startMs <= previous.endMs + maxGapMs) {
      groups[previousIndex] = OcrCueSchema.parse({
        ...previous,
        endMs: Math.max(previous.endMs, cue.endMs),
        confidence: Math.max(previous.confidence ?? 0, cue.confidence ?? 0) || undefined,
      });
      latestByText.set(key, previousIndex);
    } else {
      latestByText.set(key, groups.length);
      groups.push(cue);
    }
  }
  return groups.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

function factId(artifactId: string, segmentId: string, analysisRunId?: string) {
  return analysisRunId ? `${artifactId}-${analysisRunId}-${segmentId}` : `${artifactId}-${segmentId}`;
}

export function transcriptFacts(input: { workspaceId: string; artifactId: string; segments: TranscriptSegment[]; providerKey: string; modelKey?: string; contentHash: string; analysisRunId?: string; createdAt: string }) {
  return input.segments.map((segment) => AnalysisFactSchema.parse({ schemaVersion: 1, id: factId(input.artifactId, segment.id, input.analysisRunId), workspaceId: input.workspaceId, artifactId: input.artifactId, kind: "transcript", startMs: segment.startMs, endMs: segment.endMs, text: segment.text, labels: [], providerKey: input.providerKey, modelKey: input.modelKey, contentHash: input.contentHash, analysisRunId: input.analysisRunId, createdAt: input.createdAt }));
}

export function shotFacts(input: { workspaceId: string; artifactId: string; shots: ShotFact[]; providerKey: string; modelKey?: string; contentHash: string; analysisRunId?: string; createdAt: string }) {
  return input.shots.map((shot) => AnalysisFactSchema.parse({ schemaVersion: 1, id: factId(input.artifactId, shot.id, input.analysisRunId), workspaceId: input.workspaceId, artifactId: input.artifactId, kind: "shot", startMs: shot.startMs, endMs: shot.endMs, text: `镜头 ${shot.transition}`, labels: [shot.transition, shot.detector], providerKey: input.providerKey, modelKey: input.modelKey, contentHash: input.contentHash, analysisRunId: input.analysisRunId, createdAt: input.createdAt }));
}

export function ocrFacts(input: { workspaceId: string; artifactId: string; cues: OcrCue[]; providerKey: string; modelKey?: string; contentHash: string; analysisRunId?: string; createdAt: string }) {
  return input.cues.map((cue) => AnalysisFactSchema.parse({ schemaVersion: 1, id: factId(input.artifactId, cue.id, input.analysisRunId), workspaceId: input.workspaceId, artifactId: input.artifactId, kind: "ocr", startMs: cue.startMs, endMs: cue.endMs, text: cue.text, labels: ["ocr"], providerKey: input.providerKey, modelKey: input.modelKey, contentHash: input.contentHash, analysisRunId: input.analysisRunId, createdAt: input.createdAt }));
}

export function searchQueryForFts(query: string) {
  return query.trim().split(/\s+/).filter(Boolean).map((part) => `"${part.replaceAll('"', '""')}"*`).join(" AND ");
}

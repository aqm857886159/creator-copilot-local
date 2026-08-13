import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFile = promisify(execFileCallback);

const FfprobeStreamSchema = z.object({
  index: z.number().int().nonnegative().optional(),
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  r_frame_rate: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  sample_rate: z.string().optional(),
  channels: z.number().int().positive().optional(),
  tags: z.record(z.string()).optional(),
  disposition: z.record(z.number()).optional(),
  side_data_list: z.array(z.object({ rotation: z.number().optional() }).passthrough()).optional(),
}).passthrough();

const FfprobeFormatSchema = z.object({
  filename: z.string().optional(),
  format_name: z.string().optional(),
  format_long_name: z.string().optional(),
  duration: z.string().optional(),
  size: z.string().optional(),
  bit_rate: z.string().optional(),
}).passthrough();

const FfprobeOutputSchema = z.object({
  streams: z.array(FfprobeStreamSchema).default([]),
  format: FfprobeFormatSchema,
}).passthrough();

export type MediaStreamFact = {
  index?: number;
  kind: "video" | "audio" | "other";
  codec?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  sampleRate?: number;
  channels?: number;
  rotation?: number;
};

export type MediaProbe = {
  schemaVersion: 1;
  formatName?: string;
  durationMs?: number;
  byteSize?: number;
  bitrate?: number;
  streams: MediaStreamFact[];
};

export const MediaImportRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  sourcePath: z.string().min(1),
  maxBytes: z.number().int().positive().default(4 * 1024 ** 3),
}).strict();

export type MediaImportRequest = z.input<typeof MediaImportRequestSchema>;

export type MediaArtifact = {
  schemaVersion: 1;
  artifactId: string;
  kind: "source" | "proxy" | "thumbnail";
  relativePath: string;
  mimeType: string;
  contentHash: string;
  byteSize: number;
  parentArtifactIds: string[];
  validationStatus: "valid";
};

export type MediaImportResult = {
  source: MediaArtifact;
  proxy: MediaArtifact;
  thumbnail: MediaArtifact;
  probe: MediaProbe;
};

export type CommandRunner = (binary: string, args: string[], signal?: AbortSignal) => Promise<{ stdout: string; stderr: string }>;

export type MediaToolchain = {
  probe(path: string, signal?: AbortSignal): Promise<MediaProbe>;
  createProxy(inputPath: string, outputPath: string, signal?: AbortSignal): Promise<void>;
  createThumbnail(inputPath: string, outputPath: string, signal?: AbortSignal): Promise<void>;
};

export type RemoteMediaFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function downloadRemoteFile(input: { url: string; destinationPath: string; maxBytes?: number; fetcher?: RemoteMediaFetcher }) {
  const parsed = new URL(input.url);
  if (parsed.protocol !== "https:") throw new Error("远程媒体下载只允许 HTTPS");
  const maxBytes = input.maxBytes ?? 1024 * 1024 * 1024;
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(parsed, { redirect: "error", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`远程媒体下载失败（HTTP ${response.status}）`);
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maxBytes) throw new Error("远程媒体超过单文件大小上限");
  if (!response.body) throw new Error("远程媒体响应没有可读内容");
  const handle = await open(input.destinationPath, "w");
  let byteSize = 0;
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      byteSize += buffer.byteLength;
      if (byteSize > maxBytes) throw new Error("远程媒体超过单文件大小上限");
      await handle.write(buffer);
    }
  } catch (error) {
    await rm(input.destinationPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await handle.close();
  }
  if (byteSize === 0) {
    await rm(input.destinationPath, { force: true });
    throw new Error("远程媒体响应为空");
  }
  return { byteSize, contentType: response.headers.get("content-type") ?? undefined };
}

const defaultRunner: CommandRunner = async (binary, args, signal) => {
  const result = await execFile(binary, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, signal });
  return { stdout: result.stdout, stderr: result.stderr };
};

function parseRate(value?: string) {
  if (!value || value === "0/0") return undefined;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined;
  const rate = numerator / denominator;
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

function parseNumber(value?: string) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseFfprobeJson(value: unknown): MediaProbe {
  const raw = FfprobeOutputSchema.parse(value);
  return {
    schemaVersion: 1,
    formatName: raw.format.format_name,
    durationMs: raw.format.duration ? Math.round(Number(raw.format.duration) * 1000) : undefined,
    byteSize: parseNumber(raw.format.size),
    bitrate: parseNumber(raw.format.bit_rate),
    streams: raw.streams.map((stream) => {
      const kind = stream.codec_type === "video" || stream.codec_type === "audio" ? stream.codec_type : "other";
      const rotationValue = stream.tags?.rotate ?? stream.side_data_list?.[0]?.rotation;
      return {
        index: stream.index,
        kind,
        codec: stream.codec_name,
        width: stream.width,
        height: stream.height,
        frameRate: kind === "video" ? parseRate(stream.avg_frame_rate ?? stream.r_frame_rate) : undefined,
        sampleRate: kind === "audio" ? parseNumber(stream.sample_rate) : undefined,
        channels: stream.channels,
        rotation: typeof rotationValue === "number" ? rotationValue : Number.isFinite(Number(rotationValue)) ? Number(rotationValue) : undefined,
      };
    }),
  };
}

export function mimeTypeForPath(path: string) {
  const extension = extname(path).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
  };
  return mimeTypes[extension] ?? "application/octet-stream";
}

export async function sha256File(path: string) {
  const { createReadStream } = await import("node:fs");
  return new Promise<string>((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(`sha256:${hash.digest("hex")}`));
  });
}

export class FfmpegToolchain implements MediaToolchain {
  constructor(
    private readonly options: {
      ffprobePath?: string;
      ffmpegPath?: string;
      runner?: CommandRunner;
    } = {},
  ) {}

  private get runner() {
    return this.options.runner ?? defaultRunner;
  }

  async probe(path: string, signal?: AbortSignal) {
    const result = await this.runner(this.options.ffprobePath ?? "ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], signal);
    return parseFfprobeJson(JSON.parse(result.stdout));
  }

  async createProxy(inputPath: string, outputPath: string, signal?: AbortSignal) {
    await this.runner(this.options.ffmpegPath ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-map", "0:v:0", "-map", "0:a?", "-vf", "scale=1280:-2:force_original_aspect_ratio=decrease", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outputPath], signal);
  }

  async createThumbnail(inputPath: string, outputPath: string, signal?: AbortSignal) {
    await this.runner(this.options.ffmpegPath ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "0.5", "-i", inputPath, "-frames:v", "1", "-vf", "scale=480:-2", outputPath], signal);
  }
}

function ensureWithin(root: string, target: string) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) throw new Error("媒体产物路径越过工作区");
}

async function atomicCopy(sourcePath: string, destinationPath: string, created: Set<string>) {
  await mkdir(dirname(destinationPath), { recursive: true });
  try {
    await stat(destinationPath);
    return;
  } catch {
    // The destination is absent; write into the same directory and rename atomically.
  }
  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await copyFile(sourcePath, temporaryPath);
    await rename(temporaryPath, destinationPath);
    created.add(destinationPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function atomicCommand(outputPath: string, run: (temporaryPath: string) => Promise<void>, created: Set<string>) {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}${extname(outputPath)}`;
  try {
    await run(temporaryPath);
    await stat(temporaryPath);
    await rename(temporaryPath, outputPath);
    created.add(outputPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export class LocalMediaImporter {
  constructor(private readonly toolchain: MediaToolchain = new FfmpegToolchain()) {}

  async import(request: MediaImportRequest, signal?: AbortSignal): Promise<MediaImportResult> {
    const input = MediaImportRequestSchema.parse(request);
    if (!isAbsolute(input.workspaceRoot) || !isAbsolute(input.sourcePath)) throw new Error("工作区和素材路径必须是绝对路径");
    const root = await realpath(resolve(input.workspaceRoot));
    const sourcePath = resolve(input.sourcePath);
    ensureWithin(root, root);
    const sourceStats = await stat(sourcePath);
    if (!sourceStats.isFile()) throw new Error("素材必须是文件");
    if (sourceStats.size > input.maxBytes) throw new Error(`素材超过大小上限（${input.maxBytes} bytes）`);
    const sourceMimeType = mimeTypeForPath(sourcePath);
    if (!sourceMimeType.startsWith("video/")) throw new Error("V2a 仅支持视频素材");

    const sourceHash = await sha256File(sourcePath);
    const sourceArtifactId = `source-${sourceHash.slice("sha256:".length, "sha256:".length + 24)}`;
    const proxyArtifactId = `proxy-${sourceHash.slice("sha256:".length, "sha256:".length + 24)}`;
    const thumbnailArtifactId = `thumbnail-${sourceHash.slice("sha256:".length, "sha256:".length + 24)}`;
    const extension = extname(sourcePath).toLowerCase() || ".mp4";
    const sourceRelativePath = `originals/${sourceArtifactId}${extension}`;
    const proxyRelativePath = `derived/proxies/${proxyArtifactId}.mp4`;
    const thumbnailRelativePath = `derived/thumbnails/${thumbnailArtifactId}.jpg`;
    const sourceOutput = join(root, sourceRelativePath);
    const proxyOutput = join(root, proxyRelativePath);
    const thumbnailOutput = join(root, thumbnailRelativePath);
    ensureWithin(root, sourceOutput);
    ensureWithin(root, proxyOutput);
    ensureWithin(root, thumbnailOutput);

    const created = new Set<string>();
    try {
      await atomicCopy(sourcePath, sourceOutput, created);
      const probe = await this.toolchain.probe(sourceOutput, signal);
      await atomicCommand(proxyOutput, (temporaryPath) => this.toolchain.createProxy(sourceOutput, temporaryPath, signal), created);
      await atomicCommand(thumbnailOutput, (temporaryPath) => this.toolchain.createThumbnail(sourceOutput, temporaryPath, signal), created);
      const proxyStats = await stat(proxyOutput);
      const thumbnailStats = await stat(thumbnailOutput);
      const proxyHash = await sha256File(proxyOutput);
      const thumbnailHash = await sha256File(thumbnailOutput);
      const workspaceRelative = (path: string) => relative(root, path).split(sep).join("/");
      return {
        probe,
        source: { schemaVersion: 1, artifactId: sourceArtifactId, kind: "source", relativePath: workspaceRelative(sourceOutput), mimeType: sourceMimeType, contentHash: sourceHash, byteSize: sourceStats.size, parentArtifactIds: [], validationStatus: "valid" },
        proxy: { schemaVersion: 1, artifactId: proxyArtifactId, kind: "proxy", relativePath: workspaceRelative(proxyOutput), mimeType: "video/mp4", contentHash: proxyHash, byteSize: proxyStats.size, parentArtifactIds: [sourceArtifactId], validationStatus: "valid" },
        thumbnail: { schemaVersion: 1, artifactId: thumbnailArtifactId, kind: "thumbnail", relativePath: workspaceRelative(thumbnailOutput), mimeType: "image/jpeg", contentHash: thumbnailHash, byteSize: thumbnailStats.size, parentArtifactIds: [sourceArtifactId, proxyArtifactId], validationStatus: "valid" },
      };
    } catch (error) {
      await Promise.all([...created].map((path) => rm(path, { force: true })));
      throw error;
    }
  }
}

export function mediaSourceName(path: string) {
  return basename(path);
}

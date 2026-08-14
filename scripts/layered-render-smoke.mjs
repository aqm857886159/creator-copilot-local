import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = join(process.cwd(), ".data", "v4b-layered-render");
const sourceDir = join(root, "originals");

async function run(binary, args, options = {}) {
  const result = await execFile(binary, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, ...options });
  return result.stdout;
}

async function hashFile(filePath) {
  const { createReadStream } = await import("node:fs");
  return new Promise((resolveHash, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(`sha256:${digest.digest("hex")}`));
  });
}

async function makeFixture(filePath, color, duration, frequency) {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=320x568:r=30:d=${duration}`, "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", filePath]);
}

async function centerRgb(filePath, seconds) {
  const result = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(seconds), "-i", filePath, "-frames:v", "1", "-vf", "crop=1:1:540:960,format=rgb24", "-f", "rawvideo", "-"], { encoding: "buffer" });
  return [...result.subarray(0, 3)];
}

async function estimateAudioFrequency(filePath) {
  const pcm = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", filePath, "-map", "0:a:0", "-t", "1", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { encoding: "buffer" });
  let crossings = 0;
  let previous = pcm.readFloatLE(0);
  for (let offset = 4; offset + 4 <= pcm.length; offset += 4) {
    const current = pcm.readFloatLE(offset);
    if ((previous < 0 && current >= 0) || (previous >= 0 && current < 0)) crossings += 1;
    previous = current;
  }
  const sampleCount = pcm.length / 4;
  return crossings / 2 / (sampleCount / 48_000);
}

await rm(root, { recursive: true, force: true });
await mkdir(sourceDir, { recursive: true });
const primaryPath = join(sourceDir, "primary.mp4");
const overlayPath = join(sourceDir, "overlay.mp4");
await makeFixture(primaryPath, "0x1565c0", 4, 440);
await makeFixture(overlayPath, "0xc62828", 1, 880);
const [primaryHash, overlayHash] = await Promise.all([hashFile(primaryPath), hashFile(overlayPath)]);
const { DEFAULT_VERTICAL_PROFILE, EditProposalSchema, exportRenderPackage, freezeEditProposal } = await import("../dist-electron/packages/exchange/src/index.js");
const now = new Date().toISOString();
const proposal = EditProposalSchema.parse({
  schemaVersion: 1,
  id: "proposal-v4b-layered",
  projectId: "project-v4b-layered",
  basedOn: { scriptRevision: 1, storyboardRevision: 1 },
  durationMs: 4_000,
  operations: [
    { id: "primary-clip", shotId: "shot-primary", sourceAssetId: "asset-primary", sourceSegment: { startMs: 0, endMs: 4_000 }, timeline: { startMs: 0, endMs: 4_000 }, role: "a_roll", placement: "primary", reason: "连续真人口播主干", evidenceIds: ["shot-primary"], confidence: 0.99, status: "accepted" },
    { id: "overlay-clip", shotId: "shot-overlay", sourceAssetId: "asset-overlay", sourceSegment: { startMs: 0, endMs: 1_000 }, timeline: { startMs: 1_500, endMs: 2_500 }, role: "b_roll", placement: "overlay", reason: "覆盖一段红色证据画面", evidenceIds: ["shot-overlay"], confidence: 0.95, status: "accepted", volume: 0 },
  ],
  subtitles: [{ id: "subtitle", timeline: { startMs: 0, endMs: 4_000 }, text: "口播主干持续，补充画面在中间覆盖。" }],
  outputProfile: DEFAULT_VERTICAL_PROFILE,
  rationale: [{ operationId: "overlay-clip", reason: "覆盖证据画面", confidence: 0.95 }],
  status: "adopted",
  createdAt: now,
  updatedAt: now,
});
const frozen = freezeEditProposal({ proposal, assetLocks: [{ assetId: "asset-primary", contentHash: primaryHash }, { assetId: "asset-overlay", contentHash: overlayHash }], now });
const result = await exportRenderPackage({
  workspaceRoot: root,
  renderId: "render-v4b-layered",
  frozenEditSpec: frozen,
  assets: {
    "asset-primary": { assetId: "asset-primary", relativePath: "originals/primary.mp4", absolutePath: primaryPath, contentHash: primaryHash, durationMs: 4_000, hasVideo: true, hasAudio: true },
    "asset-overlay": { assetId: "asset-overlay", relativePath: "originals/overlay.mp4", absolutePath: overlayPath, contentHash: overlayHash, durationMs: 1_000, hasVideo: true, hasAudio: true },
  },
});
const probe = JSON.parse(await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", result.outputPath]));
const samples = { before: await centerRgb(result.outputPath, 0.5), overlay: await centerRgb(result.outputPath, 2), after: await centerRgb(result.outputPath, 3.5) };
const audioFrequencyHz = await estimateAudioFrequency(result.outputPath);
const durationMs = Math.round(Number(probe.format.duration) * 1000);
const videoStream = probe.streams.find((stream) => stream.codec_type === "video");
const frameCount = Number(videoStream?.nb_frames);
const isRed = (rgb) => rgb[0] > rgb[2] * 1.4;
const isBlue = (rgb) => rgb[2] > rgb[0] * 1.4;
if (!isBlue(samples.before) || !isRed(samples.overlay) || !isBlue(samples.after)) throw new Error(`双轨覆盖画面颜色不符合预期：${JSON.stringify(samples)}`);
if (probe.streams.filter((stream) => stream.codec_type === "audio").length !== 1) throw new Error("B-roll 覆盖不应把第二条素材音频混入成片");
if (Math.abs(durationMs - 4_000) > 100) throw new Error(`成片时长不符合 4 秒时间线：${durationMs}ms`);
if (!Number.isFinite(frameCount) || Math.abs(frameCount - 120) > 2) throw new Error(`成片帧数不符合 30fps × 4 秒：${videoStream?.nb_frames ?? "unknown"}`);
if (Math.abs(audioFrequencyHz - 440) > 20) throw new Error(`成片没有保留 440Hz 口播主干音频：${audioFrequencyHz.toFixed(1)}Hz`);
console.log(JSON.stringify({ ok: true, smoke: "layered-a-roll-b-roll-render", durationMs, frameCount, audioFrequencyHz: Number(audioFrequencyHz.toFixed(1)), videoTracks: frozen.tracks.filter((track) => track.kind === "video").map((track) => ({ layer: track.layer, clips: track.clips.length })), samples, audioStreamCount: probe.streams.filter((stream) => stream.codec_type === "audio").length, outputByteSize: (await stat(result.outputPath)).size }));

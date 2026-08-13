import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = join(process.cwd(), ".data", "v3-render-fixture");
const sourceDir = join(root, "originals");
const exportDir = join(root, "exports");

async function run(binary, args) {
  const result = await execFile(binary, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
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

await rm(root, { recursive: true, force: true });
await mkdir(sourceDir, { recursive: true });
await mkdir(exportDir, { recursive: true });
const aRollPath = join(sourceDir, "a-roll.mp4");
const bRollPath = join(sourceDir, "b-roll.mp4");
await makeFixture(aRollPath, "0x263238", 2.5, 440);
await makeFixture(bRollPath, "0x607d8b", 1.5, 660);
const [aRollHash, bRollHash] = await Promise.all([hashFile(aRollPath), hashFile(bRollPath)]);
const { DEFAULT_VERTICAL_PROFILE, EditProposalSchema, exportRenderPackage, freezeEditProposal } = await import("../dist-electron/packages/exchange/src/index.js");
const now = "2026-08-14T00:00:00.000Z";
const proposal = EditProposalSchema.parse({
  schemaVersion: 1,
  id: "proposal-v3-smoke",
  projectId: "project-v3-smoke",
  basedOn: { scriptRevision: 1, storyboardRevision: 1 },
  durationMs: 3500,
  operations: [
    { id: "a-roll-clip", sourceAssetId: "asset-a-roll", sourceSegment: { startMs: 0, endMs: 2000 }, timeline: { startMs: 0, endMs: 2000 }, role: "a_roll", reason: "保持主口播连续", evidenceIds: ["shot-01"], confidence: 0.99, status: "accepted" },
    { id: "b-roll-clip", sourceAssetId: "asset-b-roll", sourceSegment: { startMs: 0, endMs: 1500 }, timeline: { startMs: 2000, endMs: 3500 }, role: "b_roll", reason: "给观点补充视觉证据", evidenceIds: ["shot-02"], confidence: 0.95, status: "accepted" },
  ],
  subtitles: [
    { id: "subtitle-01", timeline: { startMs: 0, endMs: 2000 }, text: "先把观点讲清楚。" },
    { id: "subtitle-02", timeline: { startMs: 2000, endMs: 3500 }, text: "再让画面提供证据。" },
  ],
  outputProfile: DEFAULT_VERTICAL_PROFILE,
  rationale: [{ operationId: "b-roll-clip", reason: "分镜要求一个补充证据镜头", confidence: 0.95 }],
  status: "adopted",
  createdAt: now,
  updatedAt: now,
});
const frozen = freezeEditProposal({ proposal, assetLocks: [{ assetId: "asset-a-roll", contentHash: aRollHash }, { assetId: "asset-b-roll", contentHash: bRollHash }] });
const result = await exportRenderPackage({
  workspaceRoot: root,
  renderId: "render-v3-smoke",
  frozenEditSpec: frozen,
  assets: {
    "asset-a-roll": { assetId: "asset-a-roll", relativePath: "originals/a-roll.mp4", absolutePath: aRollPath, contentHash: aRollHash, durationMs: 2500, hasVideo: true, hasAudio: true },
    "asset-b-roll": { assetId: "asset-b-roll", relativePath: "originals/b-roll.mp4", absolutePath: bRollPath, contentHash: bRollHash, durationMs: 1500, hasVideo: true, hasAudio: true },
  },
});
const probe = JSON.parse(await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", result.outputPath]));
const outputStats = await stat(result.outputPath);
console.log(JSON.stringify({
  ok: true,
  renderId: "render-v3-smoke",
  output: { relativePath: "exports/render-v3-smoke.mp4", byteSize: outputStats.size, durationMs: Math.round(Number(probe.format.duration) * 1000), streams: probe.streams.map((stream) => ({ codecType: stream.codec_type, codec: stream.codec_name, width: stream.width, height: stream.height, sampleRate: stream.sample_rate })) },
  subtitle: { relativePath: "exports/render-v3-smoke.srt", exists: Boolean(result.subtitlePath) },
  manifest: { relativePath: "exports/render-v3-smoke.manifest.json", resolvedSpecHash: result.manifest.resolvedSpecHash, outputCount: result.manifest.outputs.length },
}));

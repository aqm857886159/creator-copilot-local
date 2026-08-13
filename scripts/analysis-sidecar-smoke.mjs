import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

if (process.env.ANALYSIS_SIDECAR_LIVE !== "1") {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "set ANALYSIS_SIDECAR_LIVE=1 with explicit local model paths to run" }));
  process.exit(0);
}

const python = process.env.FASTER_WHISPER_PYTHON;
const model = process.env.FASTER_WHISPER_MODEL;
const input = process.env.ANALYSIS_SIDECAR_INPUT;
if (!python || !model || !input) {
  throw new Error("live sidecar smoke 需要 FASTER_WHISPER_PYTHON、FASTER_WHISPER_MODEL 和 ANALYSIS_SIDECAR_INPUT");
}

const script = process.env.FASTER_WHISPER_SCRIPT ?? "electron/sidecars/faster-whisper-sidecar.py";
const { stdout } = await run(python, [
  script,
  "--input", input,
  "--model", model,
  "--language", process.env.FASTER_WHISPER_LANGUAGE ?? "zh",
  "--device", process.env.FASTER_WHISPER_DEVICE ?? "cpu",
  "--compute-type", process.env.FASTER_WHISPER_COMPUTE_TYPE ?? "int8",
], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, env: { ...process.env } });

const payload = JSON.parse(stdout);
const segments = Array.isArray(payload?.segments) ? payload.segments : [];
if (segments.length === 0) throw new Error("sidecar 没有返回任何转写片段");
for (const segment of segments) {
  if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start || typeof segment.text !== "string" || !segment.text.trim()) {
    throw new Error(`sidecar 返回了无效片段: ${JSON.stringify(segment)}`);
  }
}

console.log(JSON.stringify({ ok: true, skipped: false, segments: segments.length, language: payload.language ?? null, first: segments[0] }));

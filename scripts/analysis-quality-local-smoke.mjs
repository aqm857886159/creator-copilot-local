/**
 * Run the analysis quality evaluator against an explicitly supplied local,
 * user-owned media fixture. Nothing is downloaded and no media/text is printed.
 * This is observational by default; set ANALYSIS_QUALITY_REQUIRE_PASS=1 only
 * after choosing gates for an adjudicated fixture.
 */
if (process.env.ANALYSIS_QUALITY_LIVE !== "1") {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "set ANALYSIS_QUALITY_LIVE=1 with explicit local fixture/model paths to run" }));
  process.exit(0);
}

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`local quality smoke 需要 ${name}`);
  return value;
};
const inputPath = required("ANALYSIS_QUALITY_INPUT");
const referencePath = required("ANALYSIS_QUALITY_REFERENCE");
const runAsr = process.env.ANALYSIS_QUALITY_RUN_ASR !== "0";
const pythonPath = runAsr ? required("FASTER_WHISPER_PYTHON") : undefined;
const modelPath = runAsr ? required("FASTER_WHISPER_MODEL") : undefined;
const input = JSON.parse(await readFile(referencePath, "utf8"));
const referenceShots = Array.isArray(input?.shots)
  ? input.shots
  : Array.isArray(input?.scenes)
    ? input.scenes.flatMap((scene) => Array.isArray(scene?.shots) ? scene.shots : [])
    : [];
if (referenceShots.length === 0) throw new Error("reference aligned.json 没有 shots");

const parseClockMs = (value) => {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return undefined;
  return Number(match[1] ?? 0) * 3_600_000 + Number(match[2]) * 60_000 + Number(match[3]) * 1000 + Number((match[4] ?? "0").padEnd(3, "0"));
};
const toCue = (row, text) => {
  const range = typeof row.time_range === "string" ? row.time_range.split(/\s*-\s*/).map(parseClockMs) : [];
  const startMs = Number.isFinite(Number(row.start_ms)) ? Number(row.start_ms) : range[0];
  const endMs = Number.isFinite(Number(row.end_ms)) ? Number(row.end_ms) : range[1];
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || endMs <= startMs || typeof text !== "string" || !text.trim()) return undefined;
  return { startMs, endMs, text: text.trim() };
};
const transcriptReference = referenceShots.flatMap((row) => {
  const cue = toCue(row, row.spoken_text);
  return cue ? [cue] : [];
});
const ocrReference = referenceShots.flatMap((row) => {
  const text = typeof row.ocr_text === "string" ? row.ocr_text : "";
  const parts = text.split(/[；;]/u).map((part) => part.trim()).filter(Boolean);
  return parts.flatMap((part) => {
    const cue = toCue(row, part);
    return cue ? [cue] : [];
  });
});

const analysis = await import("../dist-electron/packages/analysis/src/index.js");
const transcript = runAsr
  ? await new analysis.FasterWhisperSidecarTranscriber({
      modelPath,
  scriptPath: process.env.FASTER_WHISPER_SCRIPT ?? "apps/desktop/sidecars/faster-whisper-sidecar.py",
      pythonPath,
      language: process.env.FASTER_WHISPER_LANGUAGE ?? "zh",
      device: process.env.FASTER_WHISPER_DEVICE ?? "cpu",
      computeType: process.env.FASTER_WHISPER_COMPUTE_TYPE ?? "int8",
    }).transcribe(inputPath)
  : [];

let ocr = [];
if (process.env.ANALYSIS_QUALITY_RUN_OCR === "1") {
  if (process.platform !== "darwin") throw new Error("真实 OCR smoke 当前需要 macOS Apple Vision；跨平台 OCR 走后续 adapter");
  const probe = await run(process.env.FFPROBE_BINARY ?? "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath], { encoding: "utf8" });
  const durationMs = Math.ceil(Number(probe.stdout.trim()) * 1000);
  if (!Number.isInteger(durationMs) || durationMs <= 0) throw new Error("ffprobe 没有返回有效时长");
  const ocrRunner = new analysis.AppleVisionOcr({
    scriptPath: process.env.APPLE_VISION_OCR_SCRIPT ?? "apps/desktop/sidecars/apple-vision-ocr.swift",
    binaryPath: process.env.APPLE_VISION_OCR_BINARY,
    sampleIntervalMs: Number(process.env.APPLE_VISION_OCR_INTERVAL_MS ?? 1000),
  });
  ocr = await ocrRunner.recognize(inputPath, durationMs);
}

const transcriptHypothesis = transcript.map((segment) => ({ startMs: segment.startMs, endMs: segment.endMs, text: segment.text }));
const ocrHypothesis = analysis.mergeOcrCues(ocr, Math.max(1_500, Number(process.env.APPLE_VISION_OCR_INTERVAL_MS ?? 1_000) + 500)).map((cue) => ({ startMs: cue.startMs, endMs: cue.endMs, text: cue.text, ...(cue.bbox ? { bbox: cue.bbox } : {}) }));
const report = analysis.evaluateAnalysisQualityFixture({
  schemaVersion: 1,
  name: "local-aligned-reference",
  transcript: { reference: transcriptReference, hypothesis: transcriptHypothesis, gates: { cerMax: Number(process.env.ANALYSIS_QUALITY_CER_MAX ?? 1), segmentRecallMin: Number(process.env.ANALYSIS_QUALITY_RECALL_MIN ?? 0), timestampMaeMaxMs: Number(process.env.ANALYSIS_QUALITY_TIMESTAMP_MAX_MS ?? 60_000) } },
  ocr: { reference: ocrReference, hypothesis: ocrHypothesis, gates: { precisionMin: Number(process.env.ANALYSIS_QUALITY_OCR_PRECISION_MIN ?? 0), recallMin: Number(process.env.ANALYSIS_QUALITY_OCR_RECALL_MIN ?? 0), bboxIoUMin: Number(process.env.ANALYSIS_QUALITY_OCR_BBOX_MIN ?? 0) } },
});
console.log(JSON.stringify({
  ok: report.passed || process.env.ANALYSIS_QUALITY_REQUIRE_PASS !== "1",
  mode: process.env.ANALYSIS_QUALITY_REQUIRE_PASS === "1" ? "gate" : "observational",
  input: "local-user-fixture",
  reference: "provided-shot-reference",
  transcriptReferenceSegments: transcriptReference.length,
  transcriptHypothesisSegments: transcriptHypothesis.length,
  ocrReferenceCues: ocrReference.length,
  ocrHypothesisCues: ocrHypothesis.length,
  report,
}));
if (process.env.ANALYSIS_QUALITY_REQUIRE_PASS === "1" && !report.passed) process.exitCode = 1;

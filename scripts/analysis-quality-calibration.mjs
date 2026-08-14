import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`质量校准需要 ${name}`);
  return value;
};
const inputPath = required("ANALYSIS_QUALITY_INPUT");
const referencePath = required("ANALYSIS_QUALITY_REFERENCE");
const expectedSha = required("ANALYSIS_QUALITY_EXPECTED_SHA256").replace(/^sha256:/, "").toLowerCase();
const outputPath = process.env.ANALYSIS_QUALITY_REPORT_OUTPUT ?? ".agents/runtime/harness/v6-local-analysis-settings-20260814/calibration-report.json";
const inputBytes = await readFile(inputPath);
const actualSha = createHash("sha256").update(inputBytes).digest("hex");
if (actualSha !== expectedSha) throw new Error(`校准素材 SHA 不匹配：期望 ${expectedSha.slice(0, 12)}…，实际 ${actualSha.slice(0, 12)}…`);

const { stdout } = await run(process.execPath, ["scripts/analysis-quality-local-smoke.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, ANALYSIS_QUALITY_LIVE: "1", ANALYSIS_QUALITY_REQUIRE_PASS: "0" },
});
const line = stdout.split(/\r?\n/).map((value) => value.trim()).find((value) => value.startsWith("{"));
if (!line) throw new Error("质量校准没有返回 JSON 报告");
const observed = JSON.parse(line);
const report = {
  schemaVersion: 1,
  datasetRole: "rubric_calibration",
  formalAcceptance: false,
  generatedAt: new Date().toISOString(),
  source: { sha256: `sha256:${actualSha}`, sha256Matched: true, mediaPath: "redacted-local-fixture", referencePath: "redacted-local-reference" },
  execution: { asr: process.env.ANALYSIS_QUALITY_RUN_ASR !== "0", ocr: process.env.ANALYSIS_QUALITY_RUN_OCR === "1", providerCostUsd: 0 },
  observed,
  interpretation: "这是用户拥有的本地校准样本，用于检查 adapter、时间码和评测器链路；它不能代表正式 Gold corpus、产品准确率或跨平台质量承诺。",
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ ok: true, datasetRole: report.datasetRole, formalAcceptance: report.formalAcceptance, sha256Matched: true, output: "redacted-report", observed: { passed: Boolean(observed.report?.passed), mode: observed.mode, transcriptReferenceSegments: observed.transcriptReferenceSegments, transcriptHypothesisSegments: observed.transcriptHypothesisSegments, ocrReferenceCues: observed.ocrReferenceCues, ocrHypothesisCues: observed.ocrHypothesisCues } }));

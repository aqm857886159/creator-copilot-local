import { readFile } from "node:fs/promises";

const fixturePath = process.env.ANALYSIS_QUALITY_FIXTURE ?? "packages/analysis/fixtures/quality-smoke.json";
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const { evaluateAnalysisQualityFixture } = await import("../dist-electron/packages/analysis/src/index.js");
const report = evaluateAnalysisQualityFixture(fixture);
if (!report.passed) throw new Error(`analysis quality fixture 未通过：${JSON.stringify(report)}`);
console.log(JSON.stringify({ ok: true, report }));

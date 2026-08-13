import { z } from "zod";

const qualityText = z.string().min(1);
const qualityCue = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: qualityText,
  bbox: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().optional(),
}).strict().superRefine((cue, context) => {
  if (cue.endMs <= cue.startMs) context.addIssue({ code: z.ZodIssueCode.custom, path: ["endMs"], message: "评测 cue 结束时间必须大于开始时间" });
});

export const AnalysisQualityFixtureSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  transcript: z.object({
    reference: z.array(qualityCue),
    hypothesis: z.array(qualityCue),
    gates: z.object({
      cerMax: z.number().min(0).max(1),
      segmentRecallMin: z.number().min(0).max(1),
      timestampMaeMaxMs: z.number().nonnegative(),
    }).strict(),
  }).strict(),
  ocr: z.object({
    reference: z.array(qualityCue),
    hypothesis: z.array(qualityCue),
    gates: z.object({
      precisionMin: z.number().min(0).max(1),
      recallMin: z.number().min(0).max(1),
      bboxIoUMin: z.number().min(0).max(1),
    }).strict(),
  }).strict(),
}).strict();
export type AnalysisQualityFixture = z.infer<typeof AnalysisQualityFixtureSchema>;

export type QualityCue = z.infer<typeof qualityCue>;

function normalizeQualityText(text: string) {
  return text.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function editDistance(left: string[], right: string[]) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? diagonal
        : Math.min(diagonal, previous[rightIndex], previous[rightIndex - 1]) + 1;
      diagonal = above;
    }
  }
  return previous[right.length];
}

function intervalIntersection(left: QualityCue, right: QualityCue) {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
}

function intervalUnion(left: QualityCue, right: QualityCue) {
  return Math.max(left.endMs, right.endMs) - Math.min(left.startMs, right.startMs);
}

function intervalIoU(left: QualityCue, right: QualityCue) {
  const union = intervalUnion(left, right);
  return union > 0 ? intervalIntersection(left, right) / union : 0;
}

function bboxIoU(left: NonNullable<QualityCue["bbox"]>, right: NonNullable<QualityCue["bbox"]>) {
  const intersectionLeft = Math.max(left.x, right.x);
  const intersectionTop = Math.max(left.y, right.y);
  const intersectionRight = Math.min(left.x + left.width, right.x + right.width);
  const intersectionBottom = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, intersectionRight - intersectionLeft) * Math.max(0, intersectionBottom - intersectionTop);
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? Math.min(1, Math.max(0, Math.round((intersection / union) * 1_000_000) / 1_000_000)) : 0;
}

function greedyTimeMatches(reference: QualityCue[], hypothesis: QualityCue[], minimumIoU = 0.5) {
  const available = new Set(hypothesis.map((_, index) => index));
  return reference.flatMap((referenceCue, referenceIndex) => {
    let bestIndex: number | undefined;
    let bestScore = minimumIoU;
    for (const hypothesisIndex of available) {
      const score = intervalIoU(referenceCue, hypothesis[hypothesisIndex]);
      if (score >= bestScore) {
        bestScore = score;
        bestIndex = hypothesisIndex;
      }
    }
    if (bestIndex === undefined) return [];
    available.delete(bestIndex);
    return [{ referenceIndex, hypothesisIndex: bestIndex, iou: bestScore }];
  });
}

export function evaluateTranscriptQuality(reference: QualityCue[], hypothesis: QualityCue[]) {
  const referenceText = reference.map((cue) => normalizeQualityText(cue.text)).join("");
  const hypothesisText = hypothesis.map((cue) => normalizeQualityText(cue.text)).join("");
  const referenceTokens = Array.from(referenceText);
  const hypothesisTokens = Array.from(hypothesisText);
  const matches = greedyTimeMatches(reference, hypothesis);
  const timestampErrors = matches.flatMap(({ referenceIndex, hypothesisIndex }) => [
    Math.abs(reference[referenceIndex].startMs - hypothesis[hypothesisIndex].startMs),
    Math.abs(reference[referenceIndex].endMs - hypothesis[hypothesisIndex].endMs),
  ]);
  const errors = editDistance(referenceTokens, hypothesisTokens);
  return {
    referenceSegments: reference.length,
    hypothesisSegments: hypothesis.length,
    matchedSegments: matches.length,
    segmentPrecision: hypothesis.length ? matches.length / hypothesis.length : reference.length === 0 ? 1 : 0,
    segmentRecall: reference.length ? matches.length / reference.length : hypothesis.length === 0 ? 1 : 0,
    cer: referenceTokens.length ? errors / referenceTokens.length : hypothesisTokens.length === 0 ? 0 : 1,
    timestampMaeMs: timestampErrors.length ? timestampErrors.reduce((sum, value) => sum + value, 0) / timestampErrors.length : 0,
    maxTimestampDriftMs: timestampErrors.length ? Math.max(...timestampErrors) : 0,
  };
}

export function evaluateOcrQuality(reference: QualityCue[], hypothesis: QualityCue[]) {
  const available = new Set(hypothesis.map((_, index) => index));
  const matches = reference.flatMap((referenceCue, referenceIndex) => {
    const expectedText = normalizeQualityText(referenceCue.text);
    const candidates = [...available].filter((index) => normalizeQualityText(hypothesis[index].text) === expectedText && intervalIoU(referenceCue, hypothesis[index]) >= 0.5);
    const hypothesisIndex = candidates[0];
    if (hypothesisIndex === undefined) return [];
    available.delete(hypothesisIndex);
    return [{ referenceIndex, hypothesisIndex }];
  });
  const bboxMatches = matches.flatMap(({ referenceIndex, hypothesisIndex }) => {
    const referenceBox = reference[referenceIndex].bbox;
    const hypothesisBox = hypothesis[hypothesisIndex].bbox;
    return referenceBox && hypothesisBox ? [bboxIoU(referenceBox, hypothesisBox)] : [];
  });
  const matched = matches.length;
  return {
    referenceCues: reference.length,
    hypothesisCues: hypothesis.length,
    matchedCues: matched,
    precision: hypothesis.length ? matched / hypothesis.length : reference.length === 0 ? 1 : 0,
    recall: reference.length ? matched / reference.length : hypothesis.length === 0 ? 1 : 0,
    bboxIoUMean: bboxMatches.length ? Math.min(1, bboxMatches.reduce((sum, value) => sum + value, 0) / bboxMatches.length) : 0,
    bboxMatchedCues: bboxMatches.length,
  };
}

export function evaluateAnalysisQualityFixture(input: AnalysisQualityFixture) {
  const fixture = AnalysisQualityFixtureSchema.parse(input);
  const transcript = evaluateTranscriptQuality(fixture.transcript.reference, fixture.transcript.hypothesis);
  const ocr = evaluateOcrQuality(fixture.ocr.reference, fixture.ocr.hypothesis);
  const passed = transcript.cer <= fixture.transcript.gates.cerMax
    && transcript.segmentRecall >= fixture.transcript.gates.segmentRecallMin
    && transcript.timestampMaeMs <= fixture.transcript.gates.timestampMaeMaxMs
    && ocr.precision >= fixture.ocr.gates.precisionMin
    && ocr.recall >= fixture.ocr.gates.recallMin
    && ocr.bboxIoUMean >= fixture.ocr.gates.bboxIoUMin;
  return { schemaVersion: 1 as const, name: fixture.name, passed, transcript, ocr, gates: { transcript: fixture.transcript.gates, ocr: fixture.ocr.gates } };
}

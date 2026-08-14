import { z } from "zod";
import type { AnalysisFact } from "./index.js";

const id = z.string().min(1);

export const AssetCandidateQuerySchema = z.object({
  shotId: id,
  instruction: z.string().min(1).max(1_000),
  scriptText: z.string().max(2_000).optional(),
  mode: z.enum(["talking_head", "broll", "screen_recording", "graphic", "generated", "still"]).optional(),
  framing: z.enum(["wide", "medium", "close", "detail", "screen"]).optional(),
  targetMs: z.number().int().positive().optional(),
}).strict();
export type AssetCandidateQuery = z.infer<typeof AssetCandidateQuerySchema>;

const CandidateFactSchema = z.object({
  id,
  kind: z.enum(["transcript", "ocr", "shot", "caption", "label"]),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string(),
  labels: z.array(z.string()),
}).strict();

export const AssetCandidateSourceSchema = z.object({
  assetId: id,
  relativePath: z.string().min(1),
  contentHash: z.string().min(1),
  durationMs: z.number().int().positive().optional(),
  facts: z.array(CandidateFactSchema).max(500),
}).strict();
export type AssetCandidateSource = z.infer<typeof AssetCandidateSourceSchema>;

export const AssetCandidateSchema = z.object({
  assetId: id,
  relativePath: z.string().min(1),
  contentHash: z.string().min(1),
  score: z.number().min(0).max(1),
  confidence: z.enum(["low", "medium", "high"]),
  matchedTerms: z.array(z.string()).max(30),
  evidenceIds: z.array(id).max(30),
  sourceSegment: z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).strict().optional(),
  durationMs: z.number().int().positive().optional(),
  reason: z.string().min(1).max(500),
}).strict();
export type AssetCandidate = z.infer<typeof AssetCandidateSchema>;

export const AssetCandidateSetSchema = z.object({
  shotId: id,
  candidates: z.array(AssetCandidateSchema).max(10),
}).strict();
export type AssetCandidateSet = z.infer<typeof AssetCandidateSetSchema>;

export type AssetCandidateSearchInput = {
  queries: AssetCandidateQuery[];
  assets: AssetCandidateSource[];
  limitPerShot?: number;
};

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function termsFor(value: string) {
  const normalized = normalize(value);
  const terms = new Set<string>();
  for (const match of normalized.matchAll(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu)) {
    const token = match[0];
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      const chars = Array.from(token);
      if (chars.length === 1) terms.add(chars[0]);
      for (let index = 0; index < chars.length - 1; index += 1) terms.add(chars.slice(index, index + 2).join(""));
    } else if (token.length >= 2) {
      terms.add(token);
    }
  }
  return [...terms].sort();
}

function preferredKinds(query: AssetCandidateQuery) {
  if (query.mode === "talking_head") return new Set<AnalysisFact["kind"]>(["transcript", "shot"]);
  if (query.mode === "screen_recording" || query.framing === "screen") return new Set<AnalysisFact["kind"]>(["ocr", "transcript", "shot"]);
  if (query.mode === "broll" || query.mode === "still" || query.framing === "detail" || query.framing === "close") return new Set<AnalysisFact["kind"]>(["shot", "ocr", "label"]);
  return new Set<AnalysisFact["kind"]>(["shot", "transcript", "ocr", "label"]);
}

function durationFit(targetMs: number | undefined, durationMs: number | undefined) {
  if (!targetMs || !durationMs) return 0;
  if (durationMs >= targetMs && durationMs <= targetMs * 4) return 1;
  if (durationMs >= targetMs * 0.5) return 0.5;
  return 0;
}

function confidenceFor(score: number, matchedTerms: number) {
  if (matchedTerms >= 3 && score >= 0.65) return "high" as const;
  if (matchedTerms > 0 && score >= 0.3) return "medium" as const;
  return "low" as const;
}

function scoreCandidate(query: AssetCandidateQuery, source: AssetCandidateSource) {
  const queryTerms = termsFor(`${query.instruction} ${query.scriptText ?? ""}`);
  const preferred = preferredKinds(query);
  const factMatches = source.facts.map((fact) => {
    const factTerms = new Set(termsFor(`${fact.text} ${fact.labels.join(" ")}`));
    const matchedTerms = queryTerms.filter((term) => factTerms.has(term));
    const kindBonus = preferred.has(fact.kind) ? 1 : 0;
    return { fact, matchedTerms, kindBonus };
  });
  const matchedTerms = [...new Set(factMatches.flatMap((match) => match.matchedTerms))].sort();
  const matchedFacts = factMatches.filter((match) => match.matchedTerms.length > 0 || match.kindBonus > 0);
  if (matchedFacts.length === 0) return undefined;
  const lexicalScore = queryTerms.length > 0 ? matchedTerms.length / queryTerms.length : 0;
  const kindScore = Math.min(1, matchedFacts.filter((match) => match.kindBonus > 0).length / Math.max(1, source.facts.length));
  const fit = durationFit(query.targetMs, source.durationMs);
  const score = Math.min(1, Math.round((lexicalScore * 0.65 + kindScore * 0.25 + fit * 0.1) * 1_000) / 1_000);
  const bestFact = [...matchedFacts].sort((left, right) => right.matchedTerms.length - left.matchedTerms.length || right.kindBonus - left.kindBonus || left.fact.startMs - right.fact.startMs || left.fact.id.localeCompare(right.fact.id))[0]?.fact;
  const evidenceIds = matchedFacts.filter((match) => match.matchedTerms.length > 0).map((match) => match.fact.id).slice(0, 30);
  const reason = matchedTerms.length > 0
    ? `命中本地事实“${matchedTerms.slice(0, 6).join("、")}”；候选片段来自 ${bestFact?.kind ?? "analysis"} 时间码，仍需人工确认是否满足该分镜。`
    : `素材已有 ${[...new Set(matchedFacts.map((match) => match.fact.kind))].join("、")} 事实，但没有命中文案词；仅作为低置信度候选，请人工预览。`;
  return AssetCandidateSchema.parse({ assetId: source.assetId, relativePath: source.relativePath, contentHash: source.contentHash, score, confidence: confidenceFor(score, matchedTerms.length), matchedTerms: matchedTerms.slice(0, 30), evidenceIds, sourceSegment: bestFact ? { startMs: bestFact.startMs, endMs: bestFact.endMs } : undefined, durationMs: source.durationMs, reason });
}

export function rankAssetCandidates(input: AssetCandidateSearchInput): AssetCandidateSet[] {
  const limit = Math.min(Math.max(input.limitPerShot ?? 5, 1), 10);
  const assets = input.assets.map((asset) => AssetCandidateSourceSchema.parse(asset));
  return input.queries.map((rawQuery) => {
    const query = AssetCandidateQuerySchema.parse(rawQuery);
    const candidates = assets.flatMap((asset) => {
      const candidate = scoreCandidate(query, asset);
      return candidate && candidate.score > 0 ? [candidate] : [];
    }).sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath) || left.assetId.localeCompare(right.assetId)).slice(0, limit);
    return AssetCandidateSetSchema.parse({ shotId: query.shotId, candidates });
  });
}

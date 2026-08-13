import { describe, expect, it } from "vitest";
import { AiSdkStructuredGenerator } from "../../providers/src/index";
import { AiSdkEditAgentRuntime, materializeEditProposalDraft } from "./index";

const now = "2026-08-14T00:00:00.000Z";
const script = { schemaVersion: 1 as const, id: "script-1", projectId: "project-1", revision: 1, status: "approved" as const, blocks: [{ schemaVersion: 1 as const, id: "block-1", order: 0, kind: "claim" as const, text: "观点文本", emphasis: [], evidenceIds: [], visualNeed: "support" as const }], estimatedDurationMs: 2_000, createdAt: now, updatedAt: now };
const storyboard = { schemaVersion: 1 as const, id: "storyboard-1", projectId: "project-1", scriptId: "script-1", scriptRevision: 1, revision: 1, status: "approved" as const, shots: [{ schemaVersion: 1 as const, id: "shot-1", storyboardId: "storyboard-1", order: 0, scriptBlockIds: ["block-1"], purpose: "explain" as const, mode: "talking_head" as const, actionDescription: "正面讲观点", targetMs: 2_000, sourceRequirement: "shoot_task" as const, status: "covered" as const }], createdAt: now, updatedAt: now };
const task = { schemaVersion: 1 as const, id: "task-1", projectId: "project-1", shotId: "shot-1", title: "镜头 01", instruction: "正面讲观点", targetMs: 2_000, deviceHint: "phone" as const, orientation: "portrait" as const, checklist: ["稳定"], status: "accepted" as const, takeIds: ["take-1"], createdAt: now, updatedAt: now };
const take = { schemaVersion: 1 as const, id: "take-1", shootTaskId: "task-1", assetId: "asset-1", relativePath: "originals/asset-1.mp4", durationMs: 2_000, status: "selected" as const, createdAt: now, updatedAt: now };

const input = { projectId: "project-1", script, storyboard, tasks: [task], takesByTask: { "task-1": [take] }, assetFacts: { "asset-1": { contentHash: "sha256:asset-1", durationMs: 2_000 } }, now };

describe("agent edit proposal runtime", () => {
  it("materializes only confirmed material and assigns safe timeline", () => {
    const result = materializeEditProposalDraft(input, { schemaVersion: 1, operations: [{ shotId: "shot-1", sourceAssetId: "asset-1", sourceSegment: { startMs: 100, endMs: 1_900 }, role: "a_roll", reason: "保持口播连续", evidenceIds: ["shot-1"], confidence: 0.9 }], subtitles: [{ shotId: "shot-1", text: "观点文本" }], missingMaterial: [] }, { providerKey: "mock", modelKey: "mock-model", responseHash: "sha256:response" });
    expect(result).toMatchObject({ status: "ready", provider: { providerKey: "mock" }, proposal: { durationMs: 1_800, operations: [{ timeline: { startMs: 0, endMs: 1_800 }, shotId: "shot-1" }] } });
  });

  it("rejects model-selected assets outside confirmed material", () => {
    expect(() => materializeEditProposalDraft(input, { schemaVersion: 1, operations: [{ shotId: "shot-1", sourceAssetId: "hallucinated-asset", sourceSegment: { startMs: 0, endMs: 1_000 }, role: "b_roll", reason: "不存在的素材", evidenceIds: ["shot-1"], confidence: 0.9 }], subtitles: [], missingMaterial: [] })).toThrow("未确认的素材");
  });

  it("reports an unselected Take as a visible material gap", () => {
    const result = materializeEditProposalDraft({ ...input, takesByTask: { "task-1": [{ ...take, status: "candidate" as const }] } }, { schemaVersion: 1, operations: [], subtitles: [], missingMaterial: [] });
    expect(result).toMatchObject({ status: "needs_material", missing: [{ shotId: "shot-1", reason: "take_not_selected" }] });
  });

  it("allows only indexed analysis facts as proposal evidence", () => {
    const analysisFacts = { "asset-1": [{ schemaVersion: 1 as const, id: "fact-1", workspaceId: "workspace-1", artifactId: "asset-1", kind: "transcript" as const, startMs: 100, endMs: 900, text: "观点文本", labels: [], providerKey: "whisper.cpp", modelKey: "ggml-small", contentHash: "sha256:asset-1", createdAt: now }] };
    const draft = { schemaVersion: 1, operations: [{ shotId: "shot-1", sourceAssetId: "asset-1", sourceSegment: { startMs: 100, endMs: 1_900 }, role: "a_roll", reason: "引用口播事实", evidenceIds: ["fact-1"], confidence: 0.9 }], subtitles: [], missingMaterial: [] };
    const result = materializeEditProposalDraft({ ...input, analysisFacts }, draft);
    expect(result.proposal?.operations[0].evidenceIds).toEqual(["fact-1", "shot-1"]);
    expect(() => materializeEditProposalDraft({ ...input, analysisFacts }, { ...draft, operations: [{ ...draft.operations[0], evidenceIds: ["fabricated-fact"] }] })).toThrow("未确认的证据");
  });

  it("turns an AI SDK draft into a reviewable proposal without bypassing material locks", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      id: "response-edit-proposal",
      model: "model-structured",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ schemaVersion: 1, operations: [{ shotId: "shot-1", sourceAssetId: "asset-1", sourceSegment: { startMs: 0, endMs: 1_800 }, role: "a_roll", reason: "保留观点的完整表达", evidenceIds: ["shot-1"], confidence: 0.95 }], subtitles: [{ shotId: "shot-1", text: "观点文本" }], missingMaterial: [] }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
    }), { status: 200, headers: { "content-type": "application/json" } });
    const generator = new AiSdkStructuredGenerator({ apiKey: "secret-test-key", baseUrl: "https://api.example.test/v1", fetcher });
    const runtime = new AiSdkEditAgentRuntime(generator, "model-structured");
    await expect(runtime.proposeEdit(input)).resolves.toMatchObject({
      status: "ready",
      provider: { providerKey: "apimart", modelKey: "model-structured" },
      proposal: { operations: [{ sourceAssetId: "asset-1", timeline: { startMs: 0, endMs: 1_800 } }] },
    });
  });
});

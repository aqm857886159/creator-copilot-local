import { describe, expect, it } from "vitest";
import { AiSdkStructuredGenerator } from "../../providers/src/index";
import { AiSdkEditAgentRuntime, LocalScriptAgentRuntime, MastraEditAgentRuntime, buildEditProposalPrompt, materializeEditProposalDraft, materializeScriptProposal } from "./index";

const now = "2026-08-14T00:00:00.000Z";
const script = { schemaVersion: 1 as const, id: "script-1", projectId: "project-1", revision: 1, status: "approved" as const, blocks: [{ schemaVersion: 1 as const, id: "block-1", order: 0, kind: "claim" as const, text: "观点文本", emphasis: [], evidenceIds: [], visualNeed: "support" as const }], estimatedDurationMs: 2_000, createdAt: now, updatedAt: now };
const storyboard = { schemaVersion: 1 as const, id: "storyboard-1", projectId: "project-1", scriptId: "script-1", scriptRevision: 1, revision: 1, status: "approved" as const, shots: [{ schemaVersion: 1 as const, id: "shot-1", storyboardId: "storyboard-1", order: 0, scriptBlockIds: ["block-1"], purpose: "explain" as const, mode: "talking_head" as const, actionDescription: "正面讲观点", targetMs: 2_000, sourceRequirement: "shoot_task" as const, status: "covered" as const }], createdAt: now, updatedAt: now };
const task = { schemaVersion: 1 as const, id: "task-1", projectId: "project-1", shotId: "shot-1", title: "镜头 01", instruction: "正面讲观点", targetMs: 2_000, deviceHint: "phone" as const, orientation: "portrait" as const, checklist: ["稳定"], status: "accepted" as const, takeIds: ["take-1"], createdAt: now, updatedAt: now };
const take = { schemaVersion: 1 as const, id: "take-1", shootTaskId: "task-1", assetId: "asset-1", relativePath: "originals/asset-1.mp4", durationMs: 2_000, status: "selected" as const, createdAt: now, updatedAt: now };

const input = { projectId: "project-1", script, storyboard, tasks: [task], takesByTask: { "task-1": [take] }, assetFacts: { "asset-1": { contentHash: "sha256:asset-1", durationMs: 2_000 } }, now };

describe("agent edit proposal runtime", () => {
  it("passes the approved shot and capture intent to the AI proposer", () => {
    const prompt = buildEditProposalPrompt({ ...input, storyboard: { ...storyboard, shots: [{ ...storyboard.shots[0], framing: "medium", cameraDirection: "手机竖拍，中景固定", deviceHint: "phone", orientation: "portrait", checklist: ["眼睛在上三分之一", "多拍一条备用"] }] }, tasks: [{ ...task, deviceHint: "phone", orientation: "portrait", checklist: ["眼睛在上三分之一", "多拍一条备用"] }] });
    const payload = JSON.parse(prompt.user) as { STORYBOARD: Array<{ shotPlan: { framing?: string; cameraDirection?: string; checklist: string[] }; captureTask?: { checklist: string[] } }> };
    expect(payload.STORYBOARD[0].shotPlan).toMatchObject({ framing: "medium", cameraDirection: "手机竖拍，中景固定", checklist: ["眼睛在上三分之一", "多拍一条备用"] });
    expect(payload.STORYBOARD[0].captureTask?.checklist).toEqual(["眼睛在上三分之一", "多拍一条备用"]);
  });

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

  it("keeps Mastra as a typed proposal adapter and reuses the materializer", async () => {
    let received: { messages: string; options: { structuredOutput: { schema: unknown }; maxSteps?: number } } | undefined;
    const agent = {
      generate: async (messages: string, options: { structuredOutput: { schema: unknown }; maxSteps?: number }) => {
        received = { messages, options };
        return {
          object: {
            schemaVersion: 1,
            operations: [{ shotId: "shot-1", sourceAssetId: "asset-1", sourceSegment: { startMs: 0, endMs: 1_800 }, role: "a_roll", reason: "保留真人表达", evidenceIds: ["shot-1"], confidence: 0.88 }],
            subtitles: [{ shotId: "shot-1", text: "观点文本" }],
            missingMaterial: [],
          },
          response: { id: "mastra-response", modelId: "mastra-model" },
        };
      },
    };
    const runtime = new MastraEditAgentRuntime(agent, { providerKey: "apimart-mastra", modelKey: "mastra-model" });
    await expect(runtime.proposeEdit(input)).resolves.toMatchObject({
      status: "ready",
      provider: { providerKey: "apimart-mastra", modelKey: "mastra-model" },
      proposal: { operations: [{ sourceAssetId: "asset-1", timeline: { startMs: 0, endMs: 1_800 } }] },
    });
    expect(received?.messages).toContain("CONFIRMED_MATERIALS");
    expect(received?.options.maxSteps).toBe(1);
    expect(received?.options.structuredOutput.schema).toBeDefined();
  });

  it("keeps a script proposal voice-first and warns when evidence is missing", async () => {
    const runtime = new LocalScriptAgentRuntime();
    const result = await runtime.proposeScript({ workspaceId: "workspace-1", brief: "我以前以为只要多拍几个镜头就会更丰富。\n后来发现问题不在镜头数量，而在每个画面有没有证明观点。", now });
    expect(result).toMatchObject({ status: "ready", proposal: { status: "previewed", provider: { providerKey: "local-fallback" }, blocks: [{ kind: "hook", shotPlan: { mode: "talking_head", targetMs: expect.any(Number), deviceHint: "phone" } }, { kind: "example", shotPlan: { mode: "broll", sourceRequirement: "shoot_task" } }] } });
    expect(result.proposal.warnings).toContain("当前没有附加来源证据；涉及事实的句子需要创作者自行核验。");
  });

  it("carries a confirmed topic revision into the script proposal", async () => {
    const runtime = new LocalScriptAgentRuntime();
    const result = await runtime.proposeScript({
      workspaceId: "workspace-1",
      brief: "我想讲一个具体案例。",
      topicContext: {
        topicId: "topic-1",
        topicRevision: 2,
        title: "把观点讲成案例",
        audienceProblem: "观众听到了判断，却看不到证据。",
        thesis: "用真实案例替代泛化 B-roll。",
        angle: "先讲改变想法的瞬间，再展开判断。",
        evidenceIds: ["evidence-1"],
        benchmarkVideoIds: [],
        visualOpportunities: ["展示带修改痕迹的草稿"],
        riskNotes: ["不要把榜单信号写成因果结论"],
        source: { kind: "topic_radar", reportId: "report-1", opportunityId: "opportunity-1" },
      },
      sourceEvidence: [{ id: "evidence-1", text: "搜索信号：表达结构", source: "tikhub:search_hot" }],
      now,
    });
    expect(result.proposal).toMatchObject({ topicId: "topic-1", topicRevision: 2 });
    expect(result.proposal.styleNotes.join(" ")).toContain("把观点讲成案例");
  });

  it("rejects script evidence invented by a model", async () => {
    const draft = { schemaVersion: 1 as const, blocks: [{ kind: "hook" as const, text: "一个问题", emphasis: [], evidenceIds: ["not-confirmed"], visualNeed: "none" as const, visualSuggestion: "看镜头说", shotPlan: { schemaVersion: 1 as const, purpose: "emotion" as const, mode: "talking_head" as const, framing: "medium" as const, actionDescription: "面对镜头说出问题。", cameraDirection: "手机竖拍固定中景。", targetMs: 3000, sourceRequirement: "shoot_task" as const, deviceHint: "phone" as const, orientation: "portrait" as const, checklist: ["画面稳定"] } }], styleNotes: [], warnings: [] };
    expect(() => materializeScriptProposal({ workspaceId: "workspace-1", brief: "一个主题", sourceEvidence: [{ id: "fact-1", text: "已核验事实" }], now }, draft, { providerKey: "test" })).toThrow("未提供的证据");
  });
});

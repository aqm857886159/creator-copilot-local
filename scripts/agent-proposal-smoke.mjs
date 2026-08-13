if (process.env.AGENT_PROVIDER_LIVE !== "1") {
  console.log("Agent provider smoke skipped. Set AGENT_PROVIDER_LIVE=1 for one bounded structured proposal request.");
  process.exit(0);
}

const requireEnvironment = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const providers = await import("../dist-electron/packages/providers/src/index.js");
const agentRuntime = await import("../dist-electron/packages/agent-runtime/src/index.js");

const now = "2026-08-14T00:00:00.000Z";
const script = { schemaVersion: 1, id: "script-live-smoke", projectId: "project-live-smoke", revision: 1, status: "approved", blocks: [{ schemaVersion: 1, id: "block-live-smoke", order: 0, kind: "claim", text: "先把一个观点讲清楚。", emphasis: [], evidenceIds: [], visualNeed: "support" }], estimatedDurationMs: 1500, createdAt: now, updatedAt: now };
const storyboard = { schemaVersion: 1, id: "storyboard-live-smoke", projectId: "project-live-smoke", scriptId: script.id, scriptRevision: 1, revision: 1, status: "approved", shots: [{ schemaVersion: 1, id: "shot-live-smoke", storyboardId: "storyboard-live-smoke", order: 0, scriptBlockIds: [script.blocks[0].id], purpose: "explain", mode: "talking_head", actionDescription: "正面口播一个观点。", targetMs: 1500, sourceRequirement: "shoot_task", status: "covered" }], createdAt: now, updatedAt: now };
const task = { schemaVersion: 1, id: "task-live-smoke", projectId: script.projectId, shotId: storyboard.shots[0].id, title: "口播镜头", instruction: "正面口播一个观点。", targetMs: 1500, deviceHint: "phone", orientation: "portrait", checklist: ["稳定"], status: "accepted", takeIds: ["take-live-smoke"], createdAt: now, updatedAt: now };
const take = { schemaVersion: 1, id: "take-live-smoke", shootTaskId: task.id, assetId: "asset-live-smoke", relativePath: "originals/asset-live-smoke.mp4", durationMs: 1500, status: "selected", createdAt: now, updatedAt: now };
const modelKey = process.env.AI_EDIT_MODEL ?? "gpt-5-nano";
const adapter = process.env.AI_EDIT_ADAPTER ?? "ai-sdk";
let agent;
if (adapter === "ai-sdk") {
  const configuredBaseUrl = process.env.APIMART_BASE_URL ?? "https://api.apimart.ai";
  const baseUrl = configuredBaseUrl.replace(/\/+$/, "").endsWith("/v1") ? configuredBaseUrl : `${configuredBaseUrl.replace(/\/+$/, "")}/v1`;
  const generator = new providers.AiSdkStructuredGenerator({ apiKey: requireEnvironment("APIMART_API_KEY"), baseUrl });
  agent = new agentRuntime.AiSdkEditAgentRuntime(generator, modelKey);
} else {
  const provider = new providers.ApiMartClient({ apiKey: requireEnvironment("APIMART_API_KEY"), baseUrl: process.env.APIMART_BASE_URL ?? "https://api.apimart.ai" });
  agent = new agentRuntime.ProviderEditAgentRuntime(provider, modelKey);
}
const result = await agent.proposeEdit({ projectId: script.projectId, script, storyboard, tasks: [task], takesByTask: { [task.id]: [take] }, assetFacts: { [take.assetId]: { contentHash: "sha256:live-smoke", durationMs: 1500 } }, now });
console.log(JSON.stringify({ ok: result.status === "ready", status: result.status, provider: result.provider, operationCount: result.proposal?.operations.length ?? 0, missingCount: result.missing.length }));

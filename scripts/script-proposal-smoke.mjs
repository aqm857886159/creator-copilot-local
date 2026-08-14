/**
 * One deliberately bounded APIMart script-proposal smoke.
 *
 * It is opt-in and makes exactly one structured text request. The response
 * body is never printed; only normalized provider metadata and the proposal
 * shape are reported.
 */
if (process.env.AGENT_SCRIPT_LIVE !== "1") {
  console.log("Script provider smoke skipped. Set AGENT_SCRIPT_LIVE=1 for one bounded structured proposal request.");
  process.exit(0);
}

const apiKey = process.env.APIMART_API_KEY;
if (!apiKey) throw new Error("APIMART_API_KEY 未配置；请从 .env.example 创建本机 .env");

const base = (process.env.APIMART_BASE_URL ?? "https://api.apimart.ai").replace(/\/+$/, "");
const baseUrl = base.endsWith("/v1") ? base : `${base}/v1`;
const [{ AiSdkStructuredGenerator }, runtime] = await Promise.all([
  import("../dist-electron/packages/providers/src/index.js"),
  import("../dist-electron/packages/agent-runtime/src/index.js"),
]);

const generator = new AiSdkStructuredGenerator({ apiKey, baseUrl });
const result = await new runtime.AiSdkScriptAgentRuntime(generator, process.env.AI_SCRIPT_MODEL ?? "gpt-4.1-mini").proposeScript({
  workspaceId: "live-smoke-workspace",
  brief: "我以前以为口播画面单薄是因为镜头太少，后来发现真正的问题是画面没有证明我正在说的观点。",
  voiceProfile: "短句，像平时解释问题；少用套话，不要虚构案例。",
  sourceEvidence: [{ id: "smoke-fact-1", text: "这是一次只用于结构化输出联调的占位事实。" }],
  now: new Date().toISOString(),
});

console.log(JSON.stringify({
  ok: result.status === "ready" && result.proposal.status === "previewed",
  provider: result.provider.providerKey,
  model: result.provider.modelKey ?? null,
  responseHashPresent: Boolean(result.provider.responseHash),
  blockCount: result.proposal.blocks.length,
  evidenceCount: result.proposal.blocks.reduce((count, block) => count + block.evidenceIds.length, 0),
  visualSuggestionCount: result.proposal.blocks.filter((block) => Boolean(block.visualSuggestion)).length,
}));

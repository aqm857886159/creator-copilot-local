# Agent 技术栈 CTO 评审 v0.1

版本：v0.1  
日期：2026-08-14  
状态：推荐基线；不是简单的框架罗列

## 0. 结论先行

这次的关键结论不是“Mastra 替代 AI SDK”，而是分层采用：

```text
AI SDK 7
  = Provider / model / stream / structured output / tool protocol

Mastra 1.58.x
  = Agent / Workflow / Memory / MCP / approval / eval / observability

我们的 Domain + Command Registry + Job/outbox
  = 业务事实 / 权限 / revision / 副作用 / 恢复 / 媒体任务
```

最终建议：

- **采用 Mastra 作为 Agent 编排层**，但只运行在 Electron main 或 analysis worker；
- **采用 AI SDK 7 作为模型与 Provider 抽象层**，统一 OpenAI、Anthropic、Gemini、OpenAI-compatible、本地模型和 APIMart；
- **保留自己的 `packages/agent-tools` 和 `Command Registry`**，Mastra 工具只能调用这些命令；
- **保留自己的 SQLite Domain DB 和 Job/outbox**，Mastra memory 只保存 Agent 对话/运行上下文，不保存创作者长期事实；
- **AI SDK 7 的 `WorkflowAgent` 和 Mastra durable agent 暂不作为媒体任务队列**，媒体、ASR、OCR、TikHub、渲染仍由我们的 Job/worker 管理；
- **Mastra 版本锁在经过合同测试的稳定版本，不使用 `@latest`；当前官方 release 页面显示最新稳定 `@mastra/core@1.58.0`（2026-08-12），主分支 package.json 已是 `1.59.0-alpha.0`，alpha 不进入产品依赖。**

这样选的核心原因：产品需要的不是“一个会聊天的 Agent”，而是“能提出结构化建议、请求权限、调用领域命令、暂停等待用户、恢复并可评估的 Agent runtime”。Mastra 在这一层的完整度高；AI SDK 7 在 Provider 和模型兼容层更稳、更适合我们多 Provider 的承诺。

## 1. 先还原 e-cut 和 Nomi 的真实情况

### 1.1 e-cut 中确实使用的是 Mastra

e-cut 当前 Web 包的依赖为：

```text
@mastra/core
@mastra/memory
@mastra/pg
@ai-sdk/openai
@ai-sdk/anthropic
ai
```

它不是把 Mastra 放在浏览器端，而是：

```text
Next.js API route
  → Mastra instance
  → editorAgent
  → Zod tool contracts
  → operation queue
  → editor assistant bridge
```

e-cut 的 Agent 有几个值得直接借鉴的点：

- `src/mastra/agents/editor/agent.ts` 只负责 Agent 组装；
- 长 Instructions 放在 `instructions.md`，不把大 Prompt 硬编码在 TypeScript；
- 每个工具都有 Zod 输入 schema；
- 工具先把编辑操作放入 operation queue，而不是直接改数据库；
- `RequestContext` 注入 project、scene、tool group 和 operations；
- API route 负责流式事件、工具事件、错误转译和恢复；
- 浏览器端 editor assistant 不导入 Mastra 实例。

这套结构非常适合我们的“AI 提案 → 人审 → Command 执行”模型。

但 e-cut 不能整体照搬：它是 Next.js 服务端应用，Mastra memory 使用 PostgreSQL `MemoryPG`；我们的产品是 Electron 本地优先，内容事实库必须是本地 SQLite，且不能把 Mastra 的 memory 当作素材、账号或创作记忆的主库。

### 1.2 Nomi 给出的另一条事实

Nomi 的生产代码主要围绕 Electron、Provider 目录、IPC、审批、任务恢复和本地素材运行；`@mastra/core` 在当前 package 中主要用于 eval/score 工具链，而不是把整个桌面产品交给 Mastra 管理。

这两个仓库合起来说明：

```text
Mastra 适合 Agent / Workflow / Eval 层
Electron + 自有 Domain/Command 适合本地产品事实和副作用层
```

## 2. 2026-08-14 的技术事实

### 2.1 Mastra

截至本次调研：

- 官方 release 页面显示 `@mastra/core@1.58.0` 于 2026-08-12 发布；
- Mastra 主分支 package.json 为 `1.59.0-alpha.0`，要求 Node `>=22.13.0`；
- 当前 core 通过 `@ai-sdk/provider-v5/v6/v7` 兼容多代 AI SDK provider；
- Agent 层提供工具、Memory、MCP、审批、Runtime Context、Supervisor/Subagent、Workspace 和 tracing；
- Workflow 层提供 typed steps、状态、stream、suspend/resume、time travel 和可选的 Inngest/Temporal runner；
- Memory 官方文档提供 `@mastra/libsql`，可以使用本地 SQLite/LibSQL 存储；
- Evals 已从旧的 metrics 逐步转向 scorers、gates 和 verdicts；
- 核心代码主要是 Apache-2.0，但 `ee/` 目录另有 Enterprise License，不能默认引入；
- 2026-06-16 发生过 npm 供应链攻击，官方披露了恶意 postinstall、撤包、废弃受影响版本和撤销 token bypass 的处置过程。

事实来源：[Mastra releases](https://github.com/mastra-ai/mastra/releases)、[current core package](https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/package.json)、[Mastra workflows](https://mastra.ai/docs/workflows/overview)、[Mastra memory](https://mastra.ai/docs/memory/overview)、[Mastra license](https://github.com/mastra-ai/mastra/blob/main/LICENSE.md)、[official incident report](https://github.com/mastra-ai/mastra/issues/18061)。

### 2.2 Vercel AI SDK 7

AI SDK 7 已不是过去的“只有 `generateText`/`streamText` 的薄封装”：

- `ToolLoopAgent` 负责多步工具循环；
- `WorkflowAgent` 面向持久化、可恢复的长运行 Agent；
- 工具审批支持动态审批、审批重放和 HMAC 绑定；
- 支持 MCP、structured output、文件/多模态、transcription、speech、embedding、rerank；
- 提供 runtime context、工具 context、生命周期回调、OpenTelemetry 和性能统计；
- 仍然保持 Provider-agnostic 的 TypeScript API。

但 AI SDK 的定位依然更偏“模型/Agent primitives”，不会替我们定义账号、素材、创作记忆、剪辑事务和本地 Job 事实模型。

事实来源：[AI SDK 7 release notes](https://vercel.com/changelog/ai-sdk-7)、[ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)、[AI SDK agents](https://ai-sdk.dev/docs/agents)、[MCP](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)。

## 3. 候选方案评审

| 方案 | 最擅长什么 | 对本项目的优点 | 主要问题 | CTO 结论 |
|---|---|---|---|---|
| **Mastra 1.58.x** | TypeScript Agent + Workflow 平台 | Agent、typed tools、memory、MCP、审批、suspend/resume、eval、observability 一体化；与 e-cut 经验直接对齐 | API 面大、迭代快；默认存储/Memory 容易与领域事实重复；供应链事件需要严格依赖治理 | **采用为 Agent 编排层** |
| **AI SDK 7** | Provider/model/stream/tool primitives | Provider-agnostic；OpenAI-compatible、本地模型和多模态接入灵活；Electron/Node 直接可用 | 业务 Workflow、长期记忆、领域权限、素材任务仍需自己建设 | **采用为模型与 Provider 层** |
| **LangGraph.js v1** | 显式状态图、checkpoint、interrupt | 长流程、人工介入、time travel 很强；MIT；控制力最高 | 需要引入另一套 graph state/checkpointer；与我们的 Domain/Job 状态重复；LangChain 生态额外复杂度 | **不作为主框架，保留 adapter 可能性** |
| **OpenAI Agents SDK** | OpenAI 风格的 Agent、handoff、guardrail、session、MCP、sandbox | API 简洁；审批、Tracing、Sandbox 和多 Agent 做得好；MIT | 运行语义明显围绕 OpenAI Responses/Realtime；`@openai/agents` 自带 OpenAI 依赖；不适合我们的模型供应商中立承诺 | **不作为主框架，可做 OpenAI Provider adapter/实验** |
| **PydanticAI / Python Agent 框架** | Python 类型化 Agent、模型实验 | Python 模型生态和实验速度好 | Electron 主产品是 TypeScript；会形成第二套 Agent/Tool/Schema 生态 | **只允许在 Python sidecar 做模型实验** |
| **自研 Agent loop** | 完全可控 | 没有框架锁定 | 要自己实现多步循环、审批、记忆、MCP、流式、trace、eval、恢复，维护成本最高 | **不采用** |

LangGraph 的官方定位是低层 Agent orchestration，并提供 checkpoint、persistence、streaming 和 human-in-the-loop；它很强，但正因为低层，我们需要自己搭更多产品层。OpenAI Agents SDK 提供 handoff、guardrails、sessions、MCP 和 tracing，但它的主路径仍然围绕 OpenAI 生态。[LangGraph.js](https://github.com/langchain-ai/langgraphjs)、[LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[OpenAI Agents SDK](https://openai.github.io/openai-agents-js/)

## 4. 最终分层方案

### 4.1 `packages/providers`：AI SDK 7

只负责：

- Provider factory；
- `modelKey → provider/model`；
- streaming；
- structured output；
- embeddings/transcription/speech/image/video 的能力声明；
- provider error/cost/usage 归一化；
- AI SDK middleware 和 telemetry adapter。

领域层不 import `@ai-sdk/openai`、`@ai-sdk/anthropic` 或 `ai`。它只调用 `StructuredModelProvider`、`StreamingModelProvider`、`EmbeddingProvider` 等接口。

### 4.2 `packages/agent-runtime`：Mastra 1.58.x

Mastra 负责：

- `Agent` 定义；
- `Workflow` 编排；
- Tool calling loop；
- 工具审批和暂停/恢复；
- Agent/MCP 连接；
- Agent memory/thread；
- Agent eval/scorer/gate；
- run-level tracing 和开发期观测。

建议的 Agent：

```text
research-agent
script-agent
storyboard-agent
asset-curator-agent
edit-planner-agent
review-agent
```

不默认做“超级 Agent + 20 个工具”。先按任务划分 Agent，并用固定 Workflow 连接它们；只有确实需要跨任务决策时才加 supervisor。

### 4.3 `packages/agent-tools`：项目自己的 Command Registry

Mastra Tool 只是 Agent 适配器，不是领域逻辑。每个 Tool 都要调用一个已注册的命令：

```text
Mastra Tool
  → CommandEnvelope
  → Domain service
  → SQLite transaction / Job submission
  → Receipt + event
```

例如：

```text
storyboard.generate      → 生成 StoryboardRevision 提案
asset.search             → 只读候选素材和 matchedEvidence
edit.propose             → 创建 EditProposal
edit.freeze              → 要求用户确认并冻结 FrozenEditSpec
render.export            → 写入 Job/outbox，不让 Agent 直接跑 FFmpeg
```

删除素材、修改已冻结时间线、提交外部 Provider、发布平台内容等工具默认 `needsApproval`，而且审批后仍要重新做 revision、权限和输入校验。

### 4.4 `apps/desktop`：本地持久化边界

Mastra 只使用独立的 `agent-runtime.sqlite` 或独立 namespace 保存：

- conversation messages；
- thread/session；
- workflow snapshots；
- tool approval state；
- Agent run trace；
- development eval records。

内容生产主库 `catalog.sqlite` 仍由我们的 Domain/Drizzle migrations 管理：

- CreatorProfile、账号、选题、脚本、分镜；
- Asset、ASR/OCR/shot/embedding；
- EditProposal、FrozenEditSpec、RenderIR；
- Publication、MetricSnapshot、ReviewMemory。

两者之间只通过 `runId`、`sourceRunId`、`objectId`、`revision` 和 `contentHash` 关联。Mastra Memory 不能自动升级成创作记忆，必须经过 `review_memory.propose → user.accept → domain.persist`。

### 4.5 Job/outbox 仍由我们自己拥有

Mastra Workflow 可以编排“研究 → 总结 → 生成提案”的 Agent 步骤；但以下任务必须进入我们的 Job/outbox：

- 下载 TikHub 临时 URL；
- FFmpeg/ffprobe；
- ASR/OCR/VLM 媒体分析；
- APIMart/视频生成异步任务；
- 渲染、导出和文件回收；
- 发布和数据同步。

原因是这些任务有媒体文件、供应商费用、外部 job id、重试、断点、下载过期和跨进程恢复，不应该依赖某次 Agent run 是否还活着。

## 5. 对我们的产品工作流如何落地

### 5.1 对标账号分析

```text
Mastra Workflow: benchmark-account-analysis
  1. TikHub connector 获取账号快照和作品列表
  2. Domain 创建 BenchmarkVideo 与 Evidence
  3. Job/outbox 批量下载和本地化
  4. media workers 执行 ASR/OCR/shot/VLM
  5. Domain 聚合 PatternFinding/TopicOpportunity
  6. Mastra review-agent 生成解释性摘要
  7. User review 后才写入可复用的 Creator/Topic memory
```

Mastra 只负责第 1、5、6 步的 Agent/Workflow 编排，不能直接持有视频文件或改写 ASR/OCR事实。

### 5.2 脚本和分镜

```text
script-agent
  → ScriptRevision proposal
  → user accept/edit
  → storyboard-agent
  → StoryboardRevision proposal
  → capture_package.export
```

脚本 Agent 的“去 AI 味”和表达风格来自 `CreatorProfile + VoiceProfile + accepted revisions`，不是 Mastra Memory 自动总结出来的几句口头禅。

### 5.3 AI 粗剪

```text
asset-curator-agent
  → asset.search Command
  → CandidateSet + matchedEvidence

edit-planner-agent
  → EditProposal
  → user review / replace / reject
  → edit.freeze
  → render Job
```

Agent 不直接生成剪辑 JSON，也不直接写剪映草稿。它只产生符合 schema 的提案，最终由 `FrozenEditSpec` 编译成 `RenderIR`。

## 6. CTO 评审：为什么不是其他方案

### 6.1 为什么不是只用 AI SDK 7

AI SDK 7 已经足够做 ToolLoopAgent、流式、多 Provider、工具审批和基础 Workflow。若产品只有一个聊天助手，我会只选 AI SDK。

但我们的产品还有：

- 多个有明确职责的 Agent；
- Agent Workflow、暂停、恢复和人工审阅；
- 内置 MCP、Agent eval/scorer/gate；
- 长时间运行的创作研究链；
- 需要把 Agent 运行、工具调用和质量评分组织成可观察对象。

如果只用 AI SDK，我们需要自己再建一套 Agent registry、Workflow state、Memory/thread、审批协议、Evals 和开发观察面板。Mastra 能减少这部分重复建设，所以选择组合而不是单用。

### 6.2 为什么不是只用 Mastra

如果只用 Mastra，Provider 和领域层容易被 Mastra 的 model/storage 习惯绑住。我们的核心卖点是用户可接 OpenAI、Anthropic、本地模型、APIMart、TikHub 和未来其他 Provider。

AI SDK 7 是更适合作为模型接口的稳定底层；Mastra 官方当前也兼容多代 AI SDK provider，因此两层可以共存，而不是相互替代。

### 6.3 为什么不是 LangGraph.js

LangGraph 适合把复杂流程明确写成状态图，恢复和 time travel 很强。它的问题不是能力不够，而是层级太低：我们已经有 `Project/Asset/Job/EditProposal/FrozenEditSpec` 这些业务状态，再增加 LangGraph state/checkpoint 会产生两套状态事实。

后续如果出现需要显式图搜索、复杂分支或多代理规划的场景，可以把 LangGraph 封装成一个 `AgentRuntimeAdapter`，但不作为第一主框架。

### 6.4 为什么不是 OpenAI Agents SDK

OpenAI Agents SDK 的 agent、handoff、guardrail、session、MCP 和 tracing 很完整，且是 MIT。但我们的产品必须支持非 OpenAI Provider；它的主路径与 Responses/Realtime、OpenAI tracing 和 OpenAI sandbox 语义结合较深。

它可以作为 OpenAI 专用能力或实验 Provider，不能成为整个本地开源产品的 Agent 真相源。

### 6.5 为什么不是自研

我们仍然自研 Domain、Command、Job、RenderIR 和素材检索，这是产品差异化；但不应该自研 Agent loop 的通用部分。

自研 Agent loop 会重复解决：

```text
多步循环 / 流式 / tool schema / approval / MCP
memory / suspend-resume / tracing / eval / retry
```

这些已经是成熟框架正在持续维护的基础设施，应该使用并隔离，而不是再造一套。

## 7. 版本和依赖策略

### 7.1 首选版本

```text
Node.js             24 LTS
Electron            43.x
TypeScript          6.x
AI SDK              7.x stable
Mastra core         1.58.x stable
Mastra memory       与 core 同一兼容矩阵
Mastra libsql       与 core 同一兼容矩阵
Zod                 4.x
MCP SDK             官方稳定版本
```

具体 patch 版本写入 lockfile，不能写 `latest`、`next` 或 Git branch。

### 7.2 供应链门

- `pnpm install --frozen-lockfile`；
- CI 检查 lockfile、包完整性和来源；
- 禁止安装 Mastra `ee/` 目录对应的 Enterprise 依赖；
- 每次 Mastra/AI SDK 升级先跑 Agent contract、approval、stream、memory、MCP 和 eval fixture；
- 生产构建只从审核过的 lockfile 和缓存包构建；
- 依赖升级要记录 release、breaking changes、迁移脚本和回滚版本；
- 不在日志、trace、eval fixture 中保存 API key、Cookie、完整原始视频或隐私文本。

Mastra 已披露过 npm 供应链攻击，因此这里不是一般性的“依赖管理建议”，而是本项目的发布门。受影响版本必须排除，且不能因为 GitHub 主分支显示更新就自动升级。[官方事件报告](https://github.com/mastra-ai/mastra/issues/18061)

## 8. 实施顺序

### 阶段 A：先固定抽象

实现：

- `AgentRuntimePort`；
- `ModelProviderPort`；
- `AgentToolDefinition`；
- `CommandEnvelope`、`ApprovalRequest`、`RunReceipt`；
- `AgentRun/AgentMessage/AgentToolCall` 表；
- Mastra adapter 的最小 `research-agent`。

验收：Mastra 可替换成 stub runtime，Domain 测试不依赖网络和模型。

### 阶段 B：接入 Mastra 1.58.x

实现：

- `packages/agent-runtime/mastra/`；
- agent instructions、tool manifest、workflow registry；
- `@mastra/libsql` 指向独立 agent runtime DB；
- `RequestContext` 只注入 workspace/project/run/actor/capability；
- 工具审批和 pause/resume 事件映射为本地 IPC；
- Mastra trace/eval 结果写入脱敏的 `AgentRunArtifact`。

验收：脚本 Agent 可产生 `ScriptRevision` 提案，用户批准后才写 Domain。

### 阶段 C：接入 AI SDK 7 Provider 层

实现：

- `ModelCatalog` 和 `modelKey`；
- OpenAI/Anthropic/Google/OpenAI-compatible adapter；
- local model adapter；
- structured output、stream、usage、cost、error normalization；
- Provider capability contract fixture。

验收：同一个 Agent 不修改业务代码即可切换两个真实 Provider 和一个 mock Provider。

### 阶段 D：接入产品工作流

顺序：

```text
account research
→ script
→ storyboard/capture package
→ asset search
→ edit proposal
→ frozen edit
```

每一步都必须产出 proposal、evidence、receipt 和可回滚 revision。

### 阶段 E：评测和升级门

- Mastra scorer/gate 做 Agent 行为评估；
- 自有 objective quality gate 做工具调用、revision、权限、媒体和编辑 IR 验证；
- 半客观 VLM 评分必须经过人工校准；
- Agent runtime 升级不得直接改变已冻结的 `FrozenEditSpec` 或历史事实。

## 9. 最终判断

**采用 Mastra，但只把它当 Agent 编排层；采用 AI SDK 7，但只把它当模型/Provider 层；产品事实、权限、Job、媒体、剪辑和记忆仍由我们自己掌握。**

这不是为了“多装两个框架”，而是把两个经常被混在一起的问题分开：

- Mastra 解决“Agent 如何组织、暂停、审批、恢复、评测”；
- AI SDK 解决“模型如何统一接入、流式输出、结构化调用”；
- 我们解决“这个 Agent 到底能不能改变真实项目，以及改变后能否撤销、恢复和交付”。

这套边界既能吸收 e-cut 的实践，也能避免把 e-cut 的 PostgreSQL/Next.js 服务端假设搬进本地桌面端。

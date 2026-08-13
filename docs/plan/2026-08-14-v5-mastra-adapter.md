# V5b Mastra Agent 适配器施工记录

日期：2026-08-14
状态：最小适配器已实现；默认仍使用 AI SDK；Mastra Memory、MCP、durable workflow 和多 Agent 后置

## 1. 为什么现在接 Mastra

AI SDK 已经承担了“调用模型并取得结构化输出”的职责。此阶段接入 Mastra，不是再造一套剪辑逻辑，而是验证 Agent 编排层可以被替换，同时不改变领域合同：

```text
Mastra Agent.generate
  → EditProposalDraft
  → 本地 materializer
  → EditProposal
  → 用户审阅 / 确认 / 撤销
```

用户界面仍称“AI 粗剪 / AI 剪辑提案”。Mastra 不直接选择未确认素材、不写 SQLite、不写文件、不调用 FFmpeg。

## 2. 官方事实（核对日期：2026-08-14）

- Mastra 官方 Agent API 从 `@mastra/core/agent` 导入 `Agent`，Agent 通过 `generate()` 生成文本或结构化对象；官方示例使用 `structuredOutput.schema`。
- 当前安装版本固定为 `@mastra/core@1.58.0`。npm 元数据标注 Apache-2.0，Node 要求为 `>=22.13.0`。
- Mastra 官方的 snapshots / suspend-resume 能力依赖配置的 workflow storage；本切片没有开启它，避免和现有 Job、CommandReceipt、SQLite 恢复合同形成两套事实源。
- 仅使用 `@mastra/core`，不引入 `ee/` 或云端托管模块。
- 安装后 `npm audit --omit=dev` 当前报告 2 个 low（均来自 `@ai-sdk/provider-utils` 的传递链，Mastra 是受影响路径之一）；未自动执行升级，待上游修复后单独更新并重跑桌面打包/golden media smoke。

官方资料：

- [Mastra Agent overview](https://mastra.ai/docs/agents/overview)
- [Mastra snapshots / suspend-resume](https://mastra.ai/reference/workflows/snapshots)
- [Mastra core npm package](https://www.npmjs.com/package/@mastra/core)
- [Mastra 官方源码仓库](https://github.com/mastra-ai/mastra)

## 3. 已实现文件和边界

- `packages/providers/src/ai-sdk.ts` 新增 `createAiSdkCompatibleLanguageModel()`，与现有 AI SDK 适配器共用 APIMart base URL、`stream:false`、structured-output 和 usage 配置。
- `packages/agent-runtime/src/index.ts` 新增 `MastraEditAgentRuntime` 与 `createMastraEditAgentRuntime()`。
- `apps/desktop/main.cjs` 支持 `AI_EDIT_PROVIDER=apimart` + `AI_EDIT_ADAPTER=mastra` 的显式分支；renderer 不获得 key 或 Mastra 对象。
- Mastra 输出统一经过现有 `materializeEditProposalDraft()`：二次 Zod 校验、confirmed material 白名单、镜头映射、时间码范围、证据 ID 和可复现时间线仍由本地代码决定。
- `packages/agent-runtime/src/index.test.ts` 用 fake Agent 覆盖结构化输出、`maxSteps=1`、provider metadata 和 materializer 复用，不产生网络费用。

## 4. 当前不做的事

1. 不启用 Memory；用户确认的创作记忆仍只能由 ReviewMemory / domain command 晋升。
2. 不启用 MCP、工具调用或文件系统工具；Agent 只能返回一个 draft。
3. 不启用 Mastra durable workflow；跨进程恢复继续由 Job、outbox、CommandReceipt 和后续 RunReceipt 设计负责。
4. 不把 Mastra 作为默认 provider；离线 fallback 和 AI SDK 路径必须继续可用。
5. 不为了证明框架而增加第二个真实付费模型调用；真实联调沿用已有一次 AI SDK structured proposal smoke，Mastra 先用合同测试证明边界。

## 5. 验收与回滚

```bash
npm run typecheck
npm test
npm run build
npm run test:desktop:package
npm run test:desktop:ui
```

通过条件：

- 60 个单元/合同测试全部通过，包含 Mastra fake Agent 测试；
- macOS arm64 packaged smoke 能启动、完成 preload IPC、SQLite 和 AI 剪辑导出闭环；
- 默认 `AI_EDIT_ADAPTER=ai-sdk` 行为不变；
- Mastra 适配器异常转为统一 `AgentProposalError`，不泄露 prompt、key 或原始响应；
- 没有把 Mastra run 当作 domain 成功，也没有新增不可恢复的外部 Job。

若 Mastra 版本、AI SDK 类型或打包体积造成回归，可将 `AI_EDIT_ADAPTER` 恢复为 `ai-sdk`，保留 `AgentRuntimePort` 和合同测试；不需要迁移项目数据。

## 6. 后续进入条件

只有当“脚本/分镜/AI 粗剪提案”至少出现真实的暂停、审批、重启恢复需求，并且 RunReceipt 与 catalog command 的补偿合同冻结后，才评估 Mastra durable workflow。Memory、MCP、多 Agent 和 provider job 编排继续作为后续里程碑，不阻塞当前用户闭环。

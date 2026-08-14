# V5b 脚本 AI 提案与拍摄包衔接施工记录

日期：2026-08-14  
状态：已完成首条本地闭环；云端模型为显式可选能力，不覆盖原稿

## 1. 这次交付的用户结果

用户可以在创作工作台输入一段自己的原始想法，再补充可选的表达习惯和来源证据，得到一份可审阅的脚本提案。提案中的每个段落同时给出：

- 口播段落类型（开头、观点、证据、例子、转折、结论等）；
- 保留或强调的词；
- 是否需要画面补足；
- 可以用手机或相机拍到的具体画面建议；
- 结构化 `shotPlan`：画面目的、模式、景别、动作、机位/设备、目标时长、横竖屏、素材来源和拍摄检查清单；
- 证据 ID 和待核验警告。

用户确认后，脚本、项目和提案在同一 SQLite 事务中保存；随后可以直接进入分镜和拍摄包，不需要重新复制脚本，也不会重复创建项目。

产品界面使用“AI 脚本提案”“确认并进入分镜”等用户语言。AI 剪辑仍是后续的“AI 粗剪 / AI 剪辑提案”；渲染执行器的冻结合同不暴露为一个笨的独立功能。

## 2. 代码边界

| 层 | 实现 | 约束 |
| --- | --- | --- |
| 领域合同 | `packages/creation/src/index.ts` | `ScriptProposalSchema` 保存 brief、voiceProfile、blocks、visualSuggestion、`shotPlan`、provider 和状态；Shot/Task 会继承拍摄意图 |
| Agent 运行时 | `packages/agent-runtime/src/index.ts` | `LocalScriptAgentRuntime` 离线可用；`AiSdkScriptAgentRuntime` 只生成结构化草稿；所有输出都经过本地 materializer |
| Provider | `apps/desktop/main.cjs` | 仅 main process 持有 APIMart key；`AI_EDIT_PROVIDER=apimart` 才启用云端脚本模型，否则走 local fallback |
| 持久化 | `packages/storage/src/catalog.ts` | migration 9 新增 `script_proposals`；确认提案、创建项目、保存脚本在一个事务中完成 |
| UI/IPC | `preload.cjs`、`global.d.ts`、`creation-workbench.tsx` | renderer 只调用类型化 API；用户显式点击生成和确认，不做后台请求或自动覆盖 |

## 3. AI 输出为何不直接写成脚本

模型只能返回 `ScriptProposalDraft`。本地 materializer 负责：

1. 严格校验 Zod schema 和段落数量/长度；
2. 检查 `evidenceIds` 是否都来自用户提供的来源，模型编造的 ID 直接拒绝；
3. 为段落补稳定的 proposal/block ID 和顺序；
4. 生成 `previewed` 状态，等待用户确认；
5. 把 `visualSuggestion` 和 `shotPlan` 放进项目 payload，供后续分镜和拍摄包使用。

因此“写得顺”不等于“已经成为事实”。原始 brief、来源证据、模型版本、响应 hash 和警告都能追溯；用户拒绝、过期或重新生成不会静默改写已确认脚本。

## 4. 本地 fallback 与 APIMart

默认使用本地 fallback，保证离线和无 key 时仍能走通脚本→分镜→拍摄包。APIMart 通过现有 AI SDK 结构化输出适配器接入，使用独立的 `AI_SCRIPT_MODEL`，未配置时使用经过 smoke 验证的 `gpt-4.1-mini`，不继承可能不兼容脚本 schema 的 `AI_EDIT_MODEL`。模型目录中的 `supported_endpoint_types` 不足以证明复杂 JSON Schema 兼容性，换模型前必须先走一次受控 smoke。

真实云端调用仍遵守 Provider 研究记录中的边界：

- key 只从本机 `.env`/进程环境进入 main；不写项目 JSON、日志、fixture 或截图；
- `maxRetries=0`，避免未知提交状态导致重复计费；
- 失败、超时、schema 不合法和证据越权都返回可见错误；
- 默认测试使用 mock；真实联调必须由用户显式打开并限制请求数量。

详见 [`Provider-Official-Integration-Research-v0.1.md`](../Provider-Official-Integration-Research-v0.1.md)。

## 5. 失败与恢复路径

| 场景 | 行为 |
| --- | --- |
| brief 为空 | IPC 直接拒绝，不创建 proposal |
| Provider 未配置/离线 | 自动使用 local fallback，不阻塞创作 |
| Provider 超时/授权/限流 | 返回失败，不自动重试，不写半成品脚本 |
| 模型输出无法解析 | 返回 `invalid_model_output`，原脚本不变 |
| 模型引用未知 evidence | 返回 `unknown_evidence`，提案不落库 |
| 用户关闭窗口后重启 | 已保存的 `previewed` proposal 可从 SQLite 读取；确认仍需用户点击 |
| 重复确认同一 proposal | 事务拒绝，已有项目/脚本不重复写入 |
| 已确认脚本进入拍摄包 | 复用 project/script，项目 revision 原子递增；脚本内容不一致则整笔回滚 |

## 6. 验收与已运行命令

领域/存储合同：

```bash
npm run typecheck
npm test
```

当前通过：11 个 test files、65 个 tests。覆盖本地 fallback、AI SDK edit 既有路径、脚本 evidence 越权、提案确认、SQLite migration/reopen、重复确认和复用项目进入拍摄包。

桌面和真实媒体：

```bash
npm run build
npm run test:desktop:package
node scripts/desktop-ui-smoke.mjs
node scripts/creation-edit-e2e.mjs
node scripts/render-smoke.mjs
node scripts/render-recovery-smoke.mjs
```

这些 smoke 已通过。媒体回归脚本改为使用运行时当前时间，避免固定的历史 fixture 时间让 lease 在真实执行时误判过期；输出中 catalog schema 已更新为 9。

## 7. 不在本切片内

- 不自动替用户发布；
- 不自动调用 TikHub、视频生成、音色克隆或数字人；
- 不让模型直接改数据库、文件、剪映草稿或时间线；
- 不把模型生成的段落自动晋升为创作记忆；
- 不承诺已经解决完整的 ASR/OCR/VLM 质量问题。

下一步是让 AI 粗剪把已选 Take、`shotPlan` 和拍摄检查结果作为可审阅输入；更复杂的 VLM 选材和自动补拍建议仍然后置。

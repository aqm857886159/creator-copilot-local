# V7c：确认选题进入脚本提案

日期：2026-08-14  
状态：已完成本地垂直切片；云端 Provider 未被本次测试触发

## 1. 用户结果

用户从账号研究或选题雷达保存一个 `Topic candidate` 后，必须主动确认它，才能在创作页作为脚本提案上下文。脚本提案会保留选题 ID、选题 revision、来源报告和证据 ID；用户仍能不绑定选题直接写原始思路。

```text
Topic candidate
  → 人工确认（CAS revision）
  → Topic selected
  → 脚本 AI 提案（topicId/topicRevision + 来源证据）
  → 人工审阅/确认
```

## 2. 实现范围

- `packages/storage/src/catalog.ts`：新增 `selectTopic`，只允许 `candidate → selected`；使用 workspace、状态和 revision 条件更新，重复确认保持幂等，旧 revision 返回冲突。
- `apps/desktop/main.cjs`：新增 `desktop:select-topic`；脚本提案可接收 `topicId`，主进程校验工作区和 `selected` 状态，再从原始研究报告回填证据。
- `packages/creation/src/index.ts`：`ScriptProposal` 和 `Script` 可选保存 `topicId/topicRevision`，不破坏无选题旧项目。
- `packages/agent-runtime/src/index.ts`：`topicContext` 进入 prompt；模型不得把选题信号伪装成事实，事实只能引用白名单 `sourceEvidence`。
- Renderer：选题雷达显示“确认选题”；创作页可选择已确认选题；不允许候选选题直接生成脚本。

## 3. 合同和失败路径

1. 选题不存在、跨工作区或来源报告缺失：拒绝，不泄漏另一工作区内容。
2. 选题不是 `selected`：脚本 IPC 返回可解释错误，不自动确认、不自动生成。
3. revision 过期：返回 `topic_revision_conflict` 和当前 topic，UI 提示刷新后重试。
4. 研究报告的证据 ID 缺失：拒绝脚本提案，不用标题或榜单信号伪造证据。
5. AI Provider 失败：保留离线 local fallback；本切片没有自动重试和后台调用。
6. 接受脚本时把 topic link 写入 Script 和 Project payload；选题状态不自动推进到 `in_progress`，避免确认脚本的隐式副作用。

## 4. 验收

- `npm run typecheck`
- `npm test -- --run`：覆盖 Topic CAS、脚本提案 topic revision 和证据白名单
- `npm run test:topic:library`：打包应用内验证保存幂等 → 确认 → 脚本提案上下文
- `npm run test:desktop:package`：preload、runtime SQLite 和迁移 smoke
- `npm run test:desktop:ui`：原有创作→Take→AI 提案→导出回归

本次不调用 TikHub/APIMart；真实联调仍遵守 [`Provider-Live-Test-Policy-v0.1.md`](../Provider-Live-Test-Policy-v0.1.md)。

## 5. 不在本切片

- 不自动把 Topic 变成脚本，不自动修改用户原稿；
- 不做 ThoughtPlan/多 Agent/Memory 晋升；
- 不把榜单内容当商用素材；
- 不把“确定性剪辑”暴露成独立用户功能。用户看到的是“AI 剪辑”，内部的 `FrozenEditSpec → RenderIR` 只负责执行已确认的 AI 提案。


# V7 选题库落地施工记录

日期：2026-08-14
状态：已完成首条“研究机会 → 本地 Topic 候选”垂直切片；脚本生成和 Topic 生命周期管理仍后置。

## 目标

把账号研究和选题雷达产生的机会从临时报告卡片变成本地可追溯的 `Topic` 对象。用户必须显式点击“加入选题库”，系统不得自动把平台信号、对标账号或模型建议写进创作项目。

## 交付

- 新增 `packages/domain/src/index.ts`：`TopicSchema`、来源、生命周期和 `createTopic` 工厂；字段覆盖受众问题、核心判断、切入角度、证据、对标作品、画面机会、风险和来源报告。
- catalog migration 10 新增 `topics` 表，支持 workspace 隔离、状态索引、版本和重启后读取。
- Electron IPC：
  - `desktop:save-topic-opportunity`：从账号研究或选题雷达报告重新读取机会，校验证据/信号属于该报告，再创建或复用 Topic；
  - `desktop:list-topics`：读取当前工作区的本地选题候选。
- 账号雷达和选题雷达增加“加入选题库”动作与本地已保存列表。
- 重复点击使用稳定的 `source + reportId + opportunityId` 指纹复用，不产生重复 Topic。

## 边界

- 这一步不生成标题以外的完整脚本，不自动创建 Project，不改变脚本或复盘记忆。
- 账号研究的 `evidenceIds` 必须存在于报告 evidence；选题雷达的 `evidenceIds` 必须存在于报告 signals；校验失败不会写入数据库。
- 平台信号仍是研究证据，不是因果结论；Topic 保留 `riskNotes`，供后续人工确认。

## 验收

- Domain schema：2 个单测覆盖候选对象和非法状态。
- SQLite：migration 10、Topic 保存/列表/重启恢复覆盖在 catalog 测试中。
- `npm run typecheck`、`npm test -- --run`、`npm run build` 必须通过。
- `npm run test:topic:library` 在打包 Electron 中验证 IPC 创建、重复点击幂等和 migration 10。
- 真实 TikHub 调用不属于本切片验收；使用已有报告 fixture，不产生额外费用。

## 后续

1. Topic 状态从 candidate → selected 的显式确认与 revision CAS；
2. 从已选 Topic 创建 ThoughtPlan/ScriptProposal，并携带 source/evidence；
3. 选题库的过滤、搜索、归档和复盘回链。

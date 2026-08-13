# V1 Catalog 持久化实施记录

日期：2026-08-14  
状态：V1 本地持久化合同实现；happy-path 与关键 adversarial fixture 已通过，Electron IPC 与媒体 worker 尚未接入  
分支：[feat/v1-contracts](https://github.com/aqm857886159/creator-copilot-local/tree/feat/v1-contracts)

## 已交付

- `packages/contracts`：版本化 Command/Receipt/Job/Artifact schema；
- `packages/storage`：SQLite catalog migration、WAL、foreign keys、busy timeout；
- Workspace/Project/Artifact 持久化；
- receipt 幂等记录、domain event 记录；
- Job claim/heartbeat/lease 过期恢复；
- outbox claim/lease 过期恢复；
- project revision CAS 更新；
- workspace-relative artifact path 和数据库复制恢复 fixture。

## 当前边界

- 适配器已可在 Node 24 + better-sqlite3 下运行，但尚未从 Electron main IPC 暴露；
- 尚未把 UI demo workspace 替换成 catalog 查询；
- 尚未实现媒体导入、FFmpeg worker 和真实 Job scheduler；
- `executeCommand` 使用 SQLite `BEGIN IMMEDIATE`，在同一事务内完成幂等检查、领域变更、event/outbox 和 receipt；跨数据库 Agent run recovery 仍后置。
- Job/outbox 使用每次 claim 生成的 lease token，旧 worker 不能 heartbeat、完成或覆盖新租约；终态会清空租约字段。
- 无租约的恢复状态（`retry_wait`、`needs_attention`、`timed_out`、`failed`）由 system recovery CAS 推进；`submission_unknown` 只允许进入 `needs_attention`，确认远端状态后回到 `queued` 并重新 claim，不允许无租约直接进入 `running`。
- v2 migration 会为旧 v1 数据库动态补齐 `jobs.lease_token` 与 `outbox_messages.lease_token`，避免改写已完成 migration 的假兼容。

## 验证

```text
npm run typecheck
npm test
npm run build
```

V1 切片验证：`npm run typecheck`、contracts/storage 相关测试（2 files / 11 tests）、`npm run build` 均通过；当前仓库全量测试已随 V2a 增加到 4 files / 15 tests。仍未作为发布门：跨进程 crash/WAL backup、Electron packaged IPC、真实媒体 fixture、跨库 Agent recovery。

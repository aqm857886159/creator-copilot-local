# V2a 媒体导入 Job：从文件动作到可恢复素材事实

日期：2026-08-14
状态：已实现并直接合入 `main`
范围：本地视频导入；不包含 ASR/OCR/VLM、云端 Provider、后台队列和手机传输

## 用户结果

用户从素材库导入一段视频后，软件不再只返回一次性的 FFmpeg 结果，而是把“这次导入”作为本地可观察任务保存下来：

```text
选择视频
→ 读取源文件 SHA-256
→ 创建/复用 media.import Job
→ claim + heartbeat（带 lease token）
→ 生成原件副本、代理视频、缩略图
→ catalog transaction 写入 Artifact manifest
→ Job succeeded + checkpoint
```

相同文件内容再次导入时，稳定 hash 会命中原 Job，不重复生成媒体产物；如果上一次进程崩溃，初始化工作区时会回收过期 lease，下一次导入可以重新 claim。

## 输入、合同和产物

| 层 | 合同 |
| --- | --- |
| 输入 | 已存在工作区内/外的绝对视频路径；默认大小上限 4 GiB；只允许已支持的视频 MIME |
| Job | `kind=media.import`、`inputHash=sourceHash`、`idempotencyScope=workspaceId`、`idempotencyKey=media-import-${sourceHash}` |
| Artifact | `source`、`proxy`、`thumbnail` 三份 manifest，路径为工作区相对路径，父子关系可追溯 |
| Checkpoint | `sourceName`、`sourceHash`、归一化 `probe`、artifact IDs、完成时间 |
| UI 返回 | `status`、`reused`、脱敏媒体事实、相对产物清单和 Job 简要状态 |

## 失败与恢复

- 文件不存在、不是普通文件、超过大小上限、类型不支持：在写入媒体产物前拒绝，不产生半成品；不支持的视频扩展名不会创建 Job，损坏的视频文件会留下失败 Job 供恢复路径观察。
- ffprobe/ffmpeg 失败：清理本次 importer 创建的文件；Job 进入 `failed`，保留可重试错误。
- 同一 hash 的并发请求：只有一个调用取得 lease；另一调用返回 `running`，不会重复付费或覆盖 artifact。
- 进程在 `claimed/running` 崩溃：工作区重启调用 `recoverExpiredLeases`；旧 token 不能 heartbeat/完成新尝试。
- Job 已成功但 artifact 指针不完整：返回 `needs_attention`，不静默重新覆盖原记录。

## 验收

- `npm run typecheck`、`npm test -- --run`、`npm run build` 通过。
- `node scripts/media-import-job-smoke.mjs`（在 packaged app 已构建后）验证：首次导入 `reused=false`，第二次 `reused=true`，成功任务一个 Job、三个 artifact、一个 source artifact；故意的非视频 fixture 两次都进入 `failed`，第二次 `attempt=2`，证明失败后重试路径可达。
- 现有 `npm run test:desktop:ui` 继续覆盖 Take 导入；Take 现在复用同一媒体 Job helper。

## 不在本切片内

- 进度流、取消按钮和独立 scheduler；当前调用仍在主进程等待 FFmpeg 完成。
- ASR/OCR/镜头切分/VLM；导入成功只代表文件事实和可编辑代理存在。
- Windows bundled FFmpeg、签名和模型/二进制供应链清单。
- CommandReceipt 与 Job 的跨库原子事务；本切片只提交 Job + artifact，完整 command executor 仍按 V1 合同后续收敛。

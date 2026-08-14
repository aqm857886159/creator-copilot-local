# 本地内容创作助手：代码实施计划 v0.2

日期：2026-08-14  
状态：已完成反方 CTO 对抗评审；执行基线  
上一版草案：[Code-Development-Plan-v0.1.md](./Code-Development-Plan-v0.1.md)  
架构依据：[Technical-Complete-Solution-v0.1.md](./Technical-Complete-Solution-v0.1.md)、[Agent-Stack-CTO-Review-v0.1.md](./Agent-Stack-CTO-Review-v0.1.md)、[Database-Decision-ADR-v0.1.md](./Database-Decision-ADR-v0.1.md)、[User-Journey-Failure-Test-Cases-v0.1.md](./User-Journey-Failure-Test-Cases-v0.1.md)

## 0. 这份计划解决什么问题

这不是功能清单，也不是“先把所有框架装上”。它规定：

- 当前真实代码如何迁移到目标 Electron workspace；
- 哪些合同必须先冻结；
- 哪个垂直切片先证明用户结果；
- 哪些能力必须后置，避免 Mastra、Rust、模型和媒体打包同时成为阻塞；
- 每个阶段的输入 fixture、命令、产物、失败路径、测试和回滚门。

首条可运行闭环目标（用户看到的产品能力名称是“AI 粗剪 / AI 剪辑”）：

```text
手动脚本
→ 结构化分镜/拍摄包
→ 导入 Take 和已有素材
→ 用户选择 A-roll/B-roll
→ AI 剪辑提案（EditProposal）
→ 用户确认后的 FrozenEditSpec
→ RenderIR 执行内核
→ 不调用模型地导出 MP4 + SRT + manifest
```

对标账号分析、TikHub、Agent、ASR/OCR/VLM、多平台发布和剪映适配都必须接在这条 AI 剪辑主链路上，而不能替代它。这里的“确定性”只描述确认后的执行内核：它不是一个面向用户的笨剪辑功能，而是为了让 AI 提案在确认后可重现、可撤销、可导出。产品命名统一为：用户层叫“AI 粗剪 / AI 剪辑提案”，工程层叫“冻结执行内核”；不再把“确定性剪辑”作为独立功能名。

## 1. 当前代码基线：先迁移，不能假设目标架构已经存在

当前目录仍是早期 Vite/React/Express scaffold，Electron 事实源已迁入 `apps/desktop`，但 workspace 最终化尚未完成：

```text
root package.json       npm scripts、Vite 7、React 19、TypeScript 5.8、Vitest
apps/desktop/renderer/   当前 renderer 入口（root Vite 过渡构建）
src/lib/api.ts          当前 API client
src/types.ts            当前 UI 类型
server/index.ts         当前 Express scaffold
```

因此第一个里程碑不是“实现 SQLite/Agent”，而是证明目标壳能运行：

```text
现有 src/* / server/*
  → 保留为迁移参考和暂时 UI fixture
apps/desktop
  ├─ main
  ├─ preload
  ├─ renderer（已迁入）
  └─ utility workers
packages/*
  ├─ contracts/domain
  ├─ media
  ├─ providers
  ├─ agent-runtime
  └─ exchange
```

迁移规则：

1. 先复制当前 UI 为 `legacy-shell` 或保留在 root，不直接把旧 API 变成领域事实；
2. 新建 pnpm workspace、Electron main/preload/renderer 入口和最小 CI；
3. 明确 root scripts 到 workspace scripts 的映射，保留 `npm run` 兼容别名，直到新入口稳定；
4. 只有 `pnpm typecheck`、`pnpm test`、`pnpm build` 和 packaged smoke 在 macOS arm64 通过后，才开始迁移页面和领域模块；
5. Windows x64 作为第二个平台验证，不因为“代码能编译”就宣称已跨平台。

V0-00 必须先形成一份 baseline migration record，至少列出：旧 `package.json` scripts 到新 workspace scripts 的映射、`src/main.tsx` 的 renderer 去向、`src/lib/api.ts` 的替代边界、`src/types.ts` 哪些类型进入 `packages/contracts`、`server/index.ts` 保留/淘汰时间点、旧 lockfile 的处理和回滚命令。未完成这张映射表，不得开始删除旧入口。

## 2. 目标代码结构与依赖方向

```text
apps/desktop/
  src/main/       Electron 安全边界、IPC、数据库、命令、任务调度
  src/preload/    最小 allowlist API
  src/renderer/   React UI 和查询缓存
  src/utility/    media/analysis/render worker 启动器

packages/contracts/       Zod/JSON Schema、ID、revision、errors、events
packages/domain/          实体、命令处理、repository port、领域规则
packages/agent-tools/     Tool schema、Command Registry、approval、receipt
packages/providers/       AI SDK 7、TikHub、APIMart、发布 adapter
packages/agent-runtime/   AgentRuntimePort、Mastra 1.58 adapter、eval
packages/media/           ffprobe/FFmpeg、ASR/OCR/shot、artifact manifest
packages/exchange/        FrozenEditSpec、RenderIR、FCPXML/OTIO/CapCut
packages/ui/              不接触 main 资源的可复用 UI
packages/fixtures/        mock provider、redacted media、golden snapshots
```

依赖方向必须是：

```text
contracts ← domain ← apps/main
contracts ← agent-tools ← agent-runtime/providers/MCP
contracts ← media ← apps/utility
contracts ← exchange ← apps/utility
```

`domain` 不依赖 Mastra、AI SDK、FFmpeg 或 React；`renderer` 不依赖数据库、密钥和第三方 API。

## 3. P0 合同：代码开发前必须先冻结

### 3.1 CommandEnvelope / Receipt

```ts
type CommandEnvelope<T> = {
  schemaVersion: 1;
  commandId: string;
  name: string;
  target: { type: string; id: string; expectedRevision?: number };
  actor: { type: "user" | "agent" | "mcp" | "system"; id: string };
  actorSessionId?: string;
  permissionSnapshot?: string;
  idempotencyKey: string;
  idempotencyScope: string;
  correlationId: string;
  causationId?: string;
  deadlineAt?: string;
  input: T;
  sourceRunId?: string;
};
```

`CommandReceipt` 必须包含版本化的 `status` union（accepted/rejected/pending/duplicate/conflict）、target revision、event/job/artifact refs、approvalRequired、errorCode/errorDetails 和 correlationId。所有 envelope 默认拒绝未知字段；Agent/UI/MCP 只调用 Command Registry，不能直接写 SQL、文件、FCPXML 或剪映草稿。

### 3.2 Job / outbox / recovery

```text
queued → running → succeeded
             ├→ retryable_failed → queued
             ├→ cancelled
             ├→ timed_out
             └→ submission_unknown
```

Job 必须保存 `inputHash`、`attempt`、`idempotencyKey`、`externalJobId`、`artifactIds`、`lastError`、`sourceRunId`、`workerId`、`leaseExpiresAt`、`heartbeatAt`、`retryAfter`、`checkpoint` 和 cost/usage。worker 通过 compare-and-set claim/lease 取得任务，过期后才能恢复；外部提交先写 outbox 再提交；`submission_unknown` 只能进入查询/人工确认路径，禁止自动重复付费。

Mastra run 和 catalog command 不共享跨库事务，因此必须使用：

```text
AgentRunReceipt(sourceRunId)
  → CommandEnvelope(sourceRunId, idempotencyKey)
  → CommandReceipt(correlationId)
  → recovery/replay query
```

Agent runtime 崩溃后可以重放或补偿；它不能把“Agent 已经说成功”当作领域成功。

### 3.3 ArtifactManifest / RenderIR

媒体产物先写临时文件并完成 hash、ffprobe、fsync、原子 rename，再提交 manifest。`ArtifactManifest` 只保存 workspace-relative path，不保存绝对路径：

```ts
type ArtifactManifest = {
  schemaVersion: 1;
  artifactId: string;
  workspaceId: string;
  kind: string;
  relativePath: string;
  mimeType: string;
  contentHash: string;
  byteSize: number;
  parentArtifactIds: string[];
  sourceRevision?: number;
  validationStatus: "pending" | "valid" | "invalid";
};
```

数据库只引用 manifest；恢复流程必须能处理 orphan artifact、数据库指针缺失、数据库行缺失、源文件移动和目录只读，不保存原始视频 BLOB。

先冻结一个 9:16 真人口播 fixture：A-roll、B-roll、双音频可选、字幕、花字和一处缺口。`FrozenEditSpec → RenderIR → FFmpeg` 必须能在不调用模型时重复编译和渲染。

### 3.4 AgentRuntimePort

```ts
interface AgentRuntimePort {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
  resume(input: ResumeRunInput): AsyncIterable<AgentEvent>;
  approve(input: ApprovalDecision): Promise<CommandReceipt>;
  cancel(runId: string): Promise<void>;
}
```

先实现 mock 和 AI SDK 7 单次 structured call；只有真实 workflow 需要暂停/恢复时才接入 Mastra adapter。Mastra Memory、MCP 和多 Agent supervisor 不得成为前四个垂直切片的前置依赖。

## 4. V0–V8 施工顺序

### V0：可打包桌面基线

**依赖：无。**

**当前状态（2026-08-14）：** Electron main、preload、utility worker 和 sidecar 事实源已迁入 `apps/desktop`；macOS arm64 目录打包、preload IPC、打包后 SQLite runtime smoke、pnpm 包级 typecheck/build/test 和 UI smoke 已通过。Windows、签名、公证、CI clean checkout、root renderer/package 化和最终 pnpm lock 迁移仍未完成。详见 [V0 基线迁移记录](./plan/2026-08-14-v0-baseline-migration.md) 与 [V0 打包施工记录](./plan/2026-08-14-v0-packaged-desktop-smoke.md)。

代码任务：

- pnpm workspace、Node 24/Electron 43/TypeScript 6 版本锁定；
- Electron main/preload/renderer 最小入口；
- `contextIsolation`、sandbox、preload API allowlist、受控 workspace path；
- 迁移现有 Vite UI 为 `apps/desktop/renderer`，暂不迁移 Express 业务逻辑；
- CI：依赖冻结、typecheck、test、build、secret scan、SPDX/NOTICE 检查；
- macOS arm64 packaged app smoke；再增加 Windows x64 smoke。

**验收门：** 新机器安装后打开空应用；renderer 无法访问 `fs/child_process/key`；`pnpm typecheck/build/test` 可复现；打包应用能启动并通过 typed preload → main IPC。

**回滚：** 保留现有 root Vite 入口，目标壳失败时不破坏旧 scaffold。

### V1：本地项目、SQLite 和 Domain/Command/Job

**依赖：V0。**

代码任务：

- `packages/contracts`：ID、revision、errors、events、CommandEnvelope、Job、Artifact；
- SQLite/Drizzle migrations：Project、Script、Storyboard、Asset、Job、Artifact 最小表；
- WAL、foreign keys、busy timeout、单一写入队列；
- repository port + SQLite implementation；
- Command Registry、权限、幂等、revision 冲突、receipt；
- Job/outbox、重试/取消/超时/恢复；
- workspace manifest、备份/恢复、数据库复制和媒体路径重定位。

**验收门：** 创建项目 → 重启 → 读回；重复命令不重复写入；target revision 冲突被拒绝；进程崩溃后 outbox 可恢复；数据库和媒体 manifest 可恢复一致；两个 worker 不能同时 claim 同一个 Job。

### V2：单一媒体基线

**依赖：V1。**

先只证明一个跨平台媒体链路，不同时开 Rust、Python、ASR/OCR 全矩阵：

```text
1 个 MP4
→ import/MIME/size check
→ hash
→ ffprobe
→ proxy + thumbnail
→ controlled preview
→ atomic ArtifactManifest
```

实现一个 FFmpeg/ffprobe utility worker，包含进度、取消、崩溃重启、临时文件清理和路径重定位。macOS arm64 通过后再验证 Windows x64；Rust media-core 先只写接口和 reference test，不阻塞首条链路。

**验收门：** CFR/VFR、竖屏、旋转、无音频、双音轨和损坏输入 fixture；输出可播放；产物 hash 与 manifest 对齐；worker 崩溃可重试；内存/CPU/导入 p95 有记录。

### V3：手动创作到拍摄包

**依赖：V1、V2；不依赖 Agent、TikHub、Memory。**

实现：

- 手动 ScriptBlock 编辑和版本；
- `Storyboard`/`Shot` schema：时长、景别、动作、道具、声音、画面目的、拍摄描述；
- `capture_package.export`：静态 HTML/Markdown/PDF 任选其一作为基线，附示意图占位和 checklist；
- 多 Take 导入、预览、选择和关联；
- 手机侧不依赖 localhost：首版用静态文件/二维码或手动导入；配对 HTTP 后置。

**验收门：** 手动脚本 → 分镜 → 拍摄包 → 导入多个 Take → 用户选择；拍摄包离线可读；不控制摄像头。

### V4：AI 剪辑提案与可复现执行

**依赖：V2、V3。**

**当前状态（2026-08-14）：** reference RenderIR、MP4/SRT/manifest、AI 粗剪人工审阅、render Job/lease、输出 ArtifactManifest、启动时过期租约恢复，以及 AI proposal/freeze 的 CommandReceipt 已落地；freeze 失败回执和 FrozenEditSpec 已进入同一事务；Provider `submission_unknown` 已支持重启后发现、用户核对用量后的人工收口与新幂等键重试；`test:creation:edit:e2e` 已用真实 FFmpeg/SQLite 跑通“脚本→分镜→拍摄包→导入/选择 Take→本地 AI 提案→冻结→导出”域级用户任务；`list-render-recoveries` / `retry-render` 和 `test:render:recovery` 已验证过期 lease 恢复、失败重试及同一 FrozenEditSpec 成功重渲染；`test:desktop:ui` 已在真实 macOS arm64 打包应用中验证创作→导入/选择 Take→AI 提案→导出，并对照 SQLite 成功 render run；更广泛故障注入和 Rust 对账仍未完成。

产品对外名称是“AI 粗剪 / AI 剪辑”。这一阶段不是取消 AI，而是把 AI 放在正确的位置：模型根据脚本、分镜、ASR/OCR/视觉事实和素材库生成 `EditProposal`，用户可以预览、替换、拒绝、撤销并确认；确认后的 `FrozenEditSpec` 再由无模型的媒体执行器稳定编译和导出。这样每次重渲染都不会偷偷换镜头或改变用户已经确认的创作意图。

实现顺序：

1. TypeScript reference compiler：`EditSelection → FrozenEditSpec → RenderIR`；
2. 9:16 口播 golden fixture：A-roll、B-roll、字幕、花字、音频和缺口；
3. 预览与正式渲染共用 RenderIR；
4. FFmpeg/ASS/SVG 输出 MP4、SRT/VTT、封面和 manifest；
5. 资产替换、proposal review、undo/revision；
6. 通过 golden fixture 后迁移时间和 IR 热路径到 Rust；
7. FCPXML/OTIO 后置；剪映适配器最后且必须输出 LossReport。

**验收门：** 不调用任何模型；同一 FrozenEditSpec 可重复编译；输出可播放/可重开；时长、轨道、编码和字幕符合 CapabilityReport；TypeScript 与 Rust 结果一致。

### V5：一个 Provider、一个 Agent 提案

**依赖：V1、V4。**

实现：

- `ModelCatalog`、`CapabilityProfile`、usage/cost/error normalization；
- AI SDK 7：先 mock，再一个真实 Provider；
- `AgentRuntimePort` 的 mock 和一次 structured call；
- `script.generate_proposal` 或 `edit.propose` 二选一作为第一个 Agent 命令；
- proposal → approval/reject/undo → CommandReceipt；
- Mastra 1.58.x adapter 接入，但先不启用 Memory、MCP 和 supervisor；
- prompt injection 防护：ASR/OCR/参考文本都是不可信输入，不能获得工具权限。

**验收门：** 同一业务命令切换 mock/真实 Provider 不改 Domain；批准前不写事实；Agent 不能直接写 DB/JSON；断线恢复、重复批准和取消有 fixture。若 Mastra adapter 失败，AI SDK mock 仍可完成业务测试。

**当前增量（2026-08-14）：** 已先落地“脚本 AI 提案”这一条用户可见闭环：保留用户原始表达和可选 voice profile，生成带 `visualSuggestion` 与结构化 `shotPlan`（拍什么、拍几秒、景别、动作、设备、横竖屏、检查清单）的段落；来源证据必须经过本地白名单校验；用户确认后脚本提案、项目和脚本在同一事务写入，并可复用项目直接进入分镜/拍摄包，Shot/拍摄任务会继承这些拍摄意图。无 APIMart key 时使用离线 local fallback，配置 `AI_EDIT_PROVIDER=apimart` 才走云端 AI SDK；不启用后台生成、自动覆盖或自动重试。施工记录见 [`V5b 脚本 AI 提案与拍摄包衔接`](./plan/2026-08-14-v5-script-proposal.md)。

### V6：本地分析和素材检索

**依赖：V2、V4、V5。**

按一条基线逐步增加，不同时支持所有模型：

- whisper.cpp 作为第一 ASR baseline；
- PySceneDetect 作为第一 shot baseline；
- PaddleOCR 或 Apple Vision 二选一作为第一 OCR baseline；
- Transcript/OCR/Shot/thumbnail facts 写入 catalog；
- SQLite FTS5 + 结构化过滤；
- `VectorIndex` 只做可选 rerank，失败时 FTS5 仍可用；
- 后续再加入 VLM 和第二 ASR/OCR adapter。

当前 AI 粗剪页的候选素材已经支持人工采用：用户预览后点击“作为 Take”，候选素材才会进入对应拍摄任务的 Take 选择；这一步是显式用户动作，不等同于自动选材，也不会绕过后续提案审阅。

**验收门：** 时间戳不越界、不重叠、不漏边界；模型失败不阻塞导入；素材搜索可解释、可重现；有内存峰值、耗时和大库 FTS 基准。

### V7：对标账号研究

**依赖：V5、V6；真实 TikHub 在 mock 后小范围开启。**

实现：

- TikHub connector：账号快照、作品列表、指标窗口、能力、限流和错误；
- mock → 单账号/20–30 条小窗口真实联调；
- 临时 URL 下载回本地，记录过期时间、来源、权限和 cost report；
- 分析 Job：probe → proxy → ASR/OCR/shot → optional VLM；
- `BenchmarkVideoAnalysis`、`PatternFinding`、`TopicOpportunity`、`CoverageReport`；
- evidence 抽屉：每个结论必须关联指标、文案或时间区间；
- 失败、部分覆盖、重复下载和恢复。

**当前增量（2026-08-14）：** 已分析作品会在本地报告中保存逐作品 `analysis.timeline`，把镜头时间段与 ASR/OCR 事实挂接；账号页支持展开查看。基于这些已观察事实会生成 `AccountResearchOpportunity` 候选，用户现在可以显式点击“加入选题库”，系统会校验证据、保存版本化 `Topic` 并保留来源报告；不会自动写入脚本或记忆。账号页还支持在报价确认后读取近 7 日账号聚合表现，并将结果写入 `account_analysis` evidence；作品缺少播放数时，再按另一条报价门调用批量统计写回 `metric` evidence；不做后台自动补齐或自动重试。施工记录见 [`V7 选题库落地`](./plan/2026-08-14-v7-topic-library.md)。

**验收门：** 任一作品失败不丢其他结果；每个模式结论有证据；真实调用范围、成本和清理记录可审计；结果不自动写入素材库或创作记忆。

### V7b：选题雷达（已完成首版）

**依赖：V5；不阻塞 V6 的本地媒体分析。**

这是面向用户的“选题库”入口，不是账号研究的隐式后台任务。首版已完成：低粉爆款、高完播样本、搜索热榜三个 TikHub 来源的动态报价、一次性确认令牌、每源一个本地 Job、成功/部分失败/提交未知状态和本地证据报告。候选机会只引用来源信号；用户可以显式把机会保存为本地 `Topic` 候选，仍不会自动生成脚本、启动 Project 或写入 ReviewMemory。

施工记录：[V7 选题雷达垂直切片](./plan/2026-08-14-v7-topic-radar.md)。后续设置页预算、更多端点、多关键词趋势和本地深度拆解必须保持显式成本门。

### V7c：确认选题进入脚本提案（已完成）

`Topic candidate` 现在必须经过用户点击确认才变成 `selected`；确认使用 revision CAS，过期 UI 不会覆盖新版本。创作页只展示已确认选题，脚本提案会保存 `topicId/topicRevision`，并从本地来源报告回填白名单证据。用户仍可不绑定选题直接写原始思路；脚本确认不会隐式推进选题状态。施工记录：[V7c 选题到脚本](./plan/2026-08-14-v7-topic-to-script.md)。

### V8：交换、发布和受控复盘

**依赖：V4、V7。**

实现：

- FCPXML/OTIO capability matrix 和 loss report；
- 手动发布包：视频、封面、标题、话题、字幕；
- 官方平台发布 connector 后置，必须有审批和 `submission_unknown` 恢复；
- Publication、MetricSnapshot、Experiment；
- `review_memory.propose → user.accept → domain.persist`；
- Mastra Memory/MCP、多 Agent supervisor、多平台、数字人、音色克隆和 AIGC 作为扩展，不阻塞主链路。

## 5. 依赖图与团队分工

```text
V0 → V1 → V2 → V3 → V4 → V5 → V6 → V7/V7b → V8
                 ↑          │
                 └──────────┘
```

V5 之后可以并行：

| 工作流 | 负责目录 | 依赖 | 禁止越界 |
|---|---|---|---|
| Desktop/platform | `apps/desktop` | V0/V1 | renderer 不碰 DB/fs/key |
| Domain/contracts | `packages/contracts`, `domain` | V0 | 不依赖 Agent/Provider/FFmpeg |
| Media | `packages/media`、utility workers | V1/V2 | worker 通过 receipt 回写，不直接改领域表 |
| AI/Provider | `packages/providers`, `agent-runtime`, `agent-tools` | V1/V4 | Tool 只能调用 Command Registry |
| Creation/UI | `packages/ui`, renderer features | V1/V3 | 不直接调用第三方 API |
| Exchange | `packages/exchange` | V4 | 冻结后不再问模型重选参数 |

单人开发也按上述包边界和小 PR 执行；一个 PR 不跨越多个未冻结合同。

## 6. 测试矩阵和质量门

### Contract / Domain

- Zod/JSON Schema versioning、unknown-field policy；
- idempotency、expectedRevision conflict、receipt/replay；
- SQLite migration、WAL、备份/恢复、`-wal`/`-shm`、损坏检测；
- 两进程写入排队/拒绝测试；
- catalog 与 agent-runtime 两库通过 correlation/outbox 恢复，不假设跨库事务。

### Electron / Security

- preload API allowlist；
- renderer 无法访问 fs、child_process、key；
- 路径穿越、SSRF、重定向、MIME、大小和临时文件清理；
- safeStorage 不可用时的明确降级；
- macOS arm64 + Windows x64 packaged smoke；
- 代码签名、更新和模型/二进制 hash 在发布前验证。

### Worker / Media

- CFR/VFR、旋转、无音频、多音频、中文字幕、损坏输入；
- 取消、崩溃、重启、超时、过期临时 URL；
- artifact 原子写入和 stale temp 清理；
- 时间戳边界、RenderIR golden、可播放和可重开；
- import/search/render p95、最大媒体大小/时长、内存峰值和 worker 并发门。

### AI / Agent

- mock 优先，真实 API 只做小范围 smoke；
- schema fail、timeout、rate limit、auth、capability mismatch、cost、cache；
- tool 权限绕过、ASR/OCR prompt injection、恶意 path/URL、审批重放；
- Mastra restart/resume、取消和 memory 不自动晋升；
- Mastra scorer/gate 只测 Agent/tool 行为，领域层另测证据、版权、时间码和渲染。

### 用户任务 E2E

1. 新建项目 → 导入 MP4 → 代理/预览/manifest；
2. 手动脚本 → 分镜 → 拍摄包 → 多 Take 导入/选择；
3. A-roll+B-roll → FrozenEditSpec → MP4/SRT/manifest；
4. 单 Agent 提案 → 审批/拒绝/替换/撤销；
5. 对标账号小窗口 → 证据 → 选题机会 → 脚本。

### 用户旅途与坏路径 E2E

系统测试不能只验证“按钮点击后接口返回成功”。每条用户旅途都必须覆盖：

```text
正常路径
→ 用户做出错误/中断/拒绝
→ 系统给出可理解的状态和下一步
→ 用户恢复、撤销或重新选择
→ 数据、素材和费用不被悄悄破坏
```

最低坏路径矩阵：

| 用户旅途 | 坏路径/用户走差 | 系统必须表现 | 验收证据 |
|---|---|---|---|
| 首次打开/创建工作区 | 用户拒绝目录权限、目录只读、磁盘不足、选择了网络盘 | 明确解释原因，允许重新选择路径；不创建半个项目；显示存储空间和支持范围 | UI 截图、错误码、重试后成功、无孤儿目录 |
| 打开旧项目 | schema 过旧、媒体目录移动、数据库损坏、缺少 `-wal/-shm` | 先备份再迁移；缺媒体显示“找不到/重新定位”，不能伪装成删除；损坏时进入只读恢复/导出诊断 | 旧 fixture、迁移日志、repath 结果、恢复包 hash |
| 导入素材 | 用户拖入不支持格式、损坏视频、超大文件、重复导入、导入中取消 | 逐个显示状态；重复素材提示复用；取消可恢复；单个失败不阻塞其他文件 | 多文件 fixture、cancel/retry、重复 hash、最终素材计数 |
| 素材分析 | ASR/OCR/镜头模型未安装、模型失败、分析很慢、用户关闭应用 | 显示“未分析/失败/排队”，不伪造标签；重启后可继续；允许跳过并先手动搜索 | Job timeline、重启恢复、部分成功和跳过后的可用搜索 |
| 写脚本 | AI 输出空泛、加入未经确认的事实、用户拒绝建议、自动保存冲突 | 原文不被覆盖；显示 diff、来源和“采用/拒绝”；用户可回到上一版 | proposal/reject/undo、revision、事实来源抽屉 |
| 生成分镜/拍摄包 | 用户不理解景别、时长或动作；示意图生成失败；用户修改拍摄顺序 | 每镜头有“拍什么/拍多久/为什么”；允许纯文字模式；导出包可离线阅读 | 静态包、无示意图 fixture、改序后再导出 |
| 导入 Take | 手机拍了多个版本、文件方向错误、音画不同步、用户导入错误文件 | 先预览再关联；保留所有 Take；可标记“待确认”，不能自动覆盖已选版本 | 多 Take fixture、取消选择、替换和回滚 |
| AI 粗剪 | 素材不足、候选不可信、用户拒绝整份提案、只想替换一个镜头 | 输出缺口和证据；支持局部替换、保守提案、全部拒绝后手动继续；不生成虚假事实 | CandidateSet、缺口报告、局部 undo、无模型 fallback |
| 预览/渲染 | 字体/编码器不支持、磁盘满、渲染进程崩溃、用户中途取消 | 保留上一次可用产物；显示失败阶段；可重试/改 profile；不覆盖成功导出 | golden media、磁盘满注入、crash/restart、旧产物仍可播放 |
| 导出交换 | FCPXML/OTIO/剪映能力不兼容、部分字幕/花字丢失 | 先显示 CapabilityReport/LossReport；允许继续导出通用媒体包；不声称无损 | 版本矩阵、损失报告、MP4/SRT 保底包 |
| 发布 | 登录过期、用户双击提交、平台返回未知状态、用户取消授权 | 提交前确认；幂等防重复；`submission_unknown` 进入查询/人工确认；不自动重复付费 | mock 状态机、重复点击、授权拒绝、查询恢复 |
| 复盘/记忆 | 用户不同意 AI 结论、指标缺失、想撤销一条记忆 | 记忆只能 proposal→accept；标记来源和置信度；可撤销，不隐式训练 | accept/reject/revoke、来源链和版本回放 |

坏路径的通过标准：用户不需要查看日志就能知道“发生了什么、我的数据是否安全、下一步是什么、是否会产生费用”；所有不可恢复情况必须给出导出/重试/人工介入路径。

### 用户旅途测试的实现方式

每条旅途建立一个可重放 fixture：

```text
Given：项目/素材/Provider/磁盘/权限的初始状态
When：用户操作 + 故障注入
Then：UI 状态、CommandReceipt、Job 状态、artifact manifest、可恢复动作
And：不得出现数据丢失、静默覆盖、重复付费或未审阅事实
```

故障注入至少包括：进程崩溃、网络断开、Provider 超时/限流、授权拒绝、目录只读、磁盘不足、源文件移动、模型缺失、用户重复点击、用户关闭窗口和 revision 冲突。E2E 不能只断言 HTTP 200，还要断言可观察 UI、恢复动作和最终事实状态。

每个版本至少录制一条真实用户旅途的屏幕或截图证据，保存对应 fixture、命令回执和产物 manifest；不能以单元测试通过替代用户任务通过。

## 7. 每个阶段的交付包

每个版本/里程碑必须同时提交：

- 代码、迁移、fixture、测试和真实 smoke 命令；
- 输入 → 命令 → 产物 → receipt → 失败路径 → 回滚说明；
- 运行截图、可播放媒体或可打开项目文件；
- 依赖、SPDX/NOTICE、模型权利和二进制 hash 变更清单；
- 性能和资源使用记录；
- 文档链接和已知限制。

## 8. 第一批 Issue/PR 顺序

```text
V0-01 pnpm workspace + Electron secure shell
V0-02 legacy-shell migration map + scripts compatibility
V0-03 typed preload/IPC + packaged mac smoke
V1-01 contracts package: ids/revision/errors/commands/jobs/artifacts
V1-02 catalog SQLite migrations + backup/restore
V1-03 Command Registry + receipt/replay + outbox
V2-01 import/hash/ffprobe/proxy/thumbnail worker
V2-02 artifact manifest + crash/cancel/restart fixtures
V3-01 manual Script/Storyboard/Shot editor contract
V3-02 static CapturePackage + Take import/select
V4-01 RenderIR reference compiler + 9:16 golden fixture
V4-02 FFmpeg render + MP4/SRT/manifest + reopen smoke
V5-01 AI SDK ProviderPort + mock/one real smoke
V5-02 AgentRuntimePort + one proposal + approval/reject/undo
V5-03 Mastra adapter contract (Memory/MCP disabled initially)
V6-01 ASR/shot/OCR baseline + FTS5 index
V6-02 asset candidate search + evidence
V7-01 TikHub mock connector + one scoped real account
V7-02 account analysis aggregation + TopicOpportunity
V7b-01 topic radar quote/confirm/report + local history
V8-01 FCPXML/OTIO loss report + manual publish package
V8-02 metrics/review memory proposal + accepted persistence
```

## 9. 反方评审后新增的强制决策

本计划相对 v0.1 草案做了以下调整：

1. 增加 V0 基线迁移，承认当前仓库还不是 Electron monorepo；
2. 把单一媒体链路和确定性渲染提前到 Agent 之前；
3. Mastra 从前置基础设施改为 V5 adapter，Memory/MCP/supervisor 后置；
4. 增加跨 `catalog.sqlite` / `agent-runtime` 的 receipt、outbox 和 recovery contract；
5. 把 ASR/OCR/VLM 从“同时支持”改成一个 baseline、逐个 adapter 增加；
6. 增加 macOS arm64 → Windows x64 的原生打包矩阵；
7. 增加 RenderIR golden、媒体崩溃恢复、SQLite WAL/备份和 prompt injection 测试；
8. 把 TikHub 限制为 mock → 单账号/20–30 条小窗口真实联调；
9. 把剪映、发布、数字人、音色克隆和多平台全部从关键路径后置。

## 10. 完成定义

阶段只有同时满足以下条件才算完成：

1. 用户能完成该阶段描述的真实任务；
2. 正常、失败、取消、重启和重复路径有可观察状态；
3. 数据、媒体和 AI 产物有唯一事实源和来源；
4. 可恢复、可撤销或明确记录不可撤销原因；
5. 相关测试和真实 smoke 已运行并记录；
6. 没有把未实现能力写成已支持。

# 本地内容创作助手：代码开发方案与执行计划 v0.1

日期：2026-08-14  
状态：已被 [Implementation-Plan-v0.2.md](./Implementation-Plan-v0.2.md) 取代；保留作为初稿审计记录  
适用范围：从空的桌面端 workspace 到第一条“研究—脚本—分镜—素材—AI 粗剪—导出”闭环

相关决策：[PRD](./PRD-v0.2-Workflow-and-Scope.md)、[技术完整方案](./Technical-Complete-Solution-v0.1.md)、[Agent 技术栈评审](./Agent-Stack-CTO-Review-v0.1.md)、[数据库 ADR](./Database-Decision-ADR-v0.1.md)、[领域合同](./Domain-Model-and-State-Contracts-v0.1.md)、[Provider/媒体交换合同](./Provider-Media-Exchange-Contracts-v0.1.md)。

## 0. 先给施工结论

代码开发不从“做一个聊天页面”开始，而从四个不可替换的合同开始：

```text
Domain facts + revision
      ↓
Command Registry + permission + receipt
      ↓
Job/outbox + worker + artifact manifest
      ↓
AI proposal / FrozenEditSpec / RenderIR
```

首条可运行闭环是：

```text
导入一个口播素材
→ 本地 probe/hash/proxy/ASR/shot/OCR
→ 生成带证据的脚本/分镜提案
→ 通过拍摄包补拍或选择素材
→ 生成可审阅 EditProposal
→ 用户确认 FrozenEditSpec
→ 不调用模型地渲染 MP4 + SRT + manifest
```

对标账号分析、TikHub、多 Provider、MCP 和剪映适配都围绕这条闭环接入；不是先做一个“万能 Agent”，再猜产品事实。

## 1. 开发原则和禁止事项

### 1.1 必须遵守

- renderer 只使用 typed preload API；不读文件、数据库、密钥或第三方 SDK；
- Domain 事实只由领域命令修改；UI、Agent、MCP 共用同一 `CommandEnvelope`；
- AI 只产生带 schema、sourceRunId、modelKey、promptVersion 和证据的 proposal；
- 长任务进入 Job/outbox，必须有幂等键、外部任务 ID、重试、取消、超时和恢复状态；
- 原始媒体和派生媒体在文件系统，SQLite 保存元数据、索引、引用和 hash；
- 正式渲染只接受 `FrozenEditSpec`，热路径不调用 LLM/VLM；
- 每个跨进程结果都是版本化 artifact，并有 manifest、校验和、创建来源；
- Provider、Mastra、FFmpeg、ASR/OCR 都通过 adapter/worker 隔离，领域层不依赖其内部字段。

### 1.2 首轮不做

- 不做手机/相机远程控制；只生成拍摄包和导入流程；
- 不做数字人、音色克隆、大规模 AIGC B-roll 和团队协作主链路；
- 不把剪映私有草稿当事实源；先做 MP4/SRT/VTT/FCPXML/OTIO/交付包；
- 不默认打包全部本地模型；先实现能力探测、按需安装和云端 fallback；
- 不在首轮引入 PostgreSQL、DuckDB、独立向量数据库或同步服务；保留 adapter 接口；
- 不从 e-cut、OpenChatCut 或 Nomi 直接复制未经许可证审计的业务代码。

## 2. 目标代码结构

```text
apps/desktop/
  src/main/                 # Electron main：安全、IPC、DB、命令、任务调度
  src/preload/              # 最小 typed API
  src/renderer/             # React UI，不持有事实和密钥
  src/utility/              # media/analysis/render worker 启动器

packages/domain/            # 实体、值对象、命令、事件、repository port
packages/agent-tools/       # Tool schema、Command Registry、approval/receipt
packages/providers/         # AI SDK 7、TikHub、APIMart、发布 Connector adapter
packages/agent-runtime/     # Mastra 1.58.x adapter、Agent/Workflow/Eval
packages/media/             # ffprobe/FFmpeg、代理、ASR/OCR/shot、索引
packages/exchange/          # RenderIR、FCPXML、OTIO、CapCut adapter
packages/ui/                # 可复用 UI，不直接访问 main 资源
packages/test-fixtures/     # mock provider、golden media、合同样本
scripts/                    # 迁移、模型/FFmpeg 检查、许可证和打包脚本
docs/                       # PRD、ADR、评测和发布清单
```

第一批文件应按边界建立，而不是按页面建立：

```text
packages/domain/src/ids.ts
packages/domain/src/revision.ts
packages/domain/src/commands/envelope.ts
packages/domain/src/jobs/state.ts
packages/domain/src/ports/repositories.ts
packages/agent-tools/src/registry.ts
packages/providers/src/model-catalog.ts
packages/media/src/artifacts/manifest.ts
packages/exchange/src/render-ir.ts
apps/desktop/src/main/ipc/register.ts
apps/desktop/src/main/db/catalog.ts
apps/desktop/src/preload/api.ts
```

## 3. 关键接口先行

### 3.1 CommandEnvelope

```ts
type CommandEnvelope<T> = {
  commandId: string;
  name: string;
  actor: { type: "user" | "agent" | "mcp" | "system"; id: string };
  projectId?: string;
  expectedRevision?: number;
  idempotencyKey: string;
  input: T;
  sourceRunId?: string;
};
```

每条命令返回 `CommandReceipt`：包含 accepted/rejected、newRevision、eventIds、artifactIds、approvalRequired 和 errorCode。所有写入都通过它，不允许 Agent 直接执行 SQL。

### 3.2 Job/outbox

统一状态：

```text
queued → running → succeeded
             ├→ retryable_failed → queued
             ├→ cancelled
             ├→ timed_out
             └→ submission_unknown
```

Job 至少包含 `kind/inputHash/state/attempt/idempotencyKey/providerKey/externalJobId/artifactIds/lastError`。提交外部付费任务时，先写 outbox，再提交；`submission_unknown` 禁止盲目重复付费。

### 3.3 ArtifactManifest

所有媒体和 AI 产物统一记录：

```ts
type ArtifactManifest = {
  artifactId: string;
  kind: string;
  path: string;
  contentHash: string;
  byteSize: number;
  media?: { durationMs?: number; width?: number; height?: number; fps?: string; codec?: string };
  source: { kind: "local" | "provider" | "derived"; providerKey?: string; modelKey?: string; sourceRunId?: string };
  createdAt: string;
};
```

数据库只引用 manifest；文件落盘必须先临时文件、校验、fsync/原子 rename，再提交引用。

### 3.4 AgentRuntimePort

```ts
interface AgentRuntimePort {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
  resume(input: ResumeRunInput): AsyncIterable<AgentEvent>;
  approve(input: ApprovalDecision): Promise<CommandReceipt>;
  cancel(runId: string): Promise<void>;
}
```

Mastra 是该 port 的实现；AI SDK 7 原生 loop 是可替换 fallback。Agent Tool 只能映射到 `Command Registry`，Memory 不能直接写入创作事实。

## 4. 依赖图与阶段计划

### M0：工程基座和安全边界

**依赖：无。**

实现：

- pnpm workspace、Node/Electron 版本锁定、严格 TypeScript、lint/typecheck/test/build；
- Electron main/preload/renderer/utility process 骨架；
- `contextIsolation`、sandbox、最小 `contextBridge`、受控 workspace path；
- SQLite/Drizzle migration runner、WAL/foreign keys/busy timeout、备份和恢复命令；
- structured logger、error code、safeStorage credential reference、应用配置；
- 基础 CI：依赖冻结、许可证/SPDX、secret scan、单元测试和打包 smoke。

验收：新机器安装后能创建空 workspace；renderer 无法访问 fs/DB/key；数据库可迁移、备份、恢复；CI 能阻止未锁版本和密钥模式。

### M1：Domain、Command 和 Job 核心

**依赖：M0。**

实现顺序：

1. `Id`, `Revision`, `Actor`, `ContentHash`, `Capability` 值对象；
2. Creator/Project/Account/Topic/Script/Storyboard/Asset/Job/Artifact 最小实体；
3. repository port + SQLite implementation；
4. Command Registry、权限、幂等、revision 冲突、receipt/event；
5. Job/outbox、重试/取消/超时/恢复和事件订阅；
6. UI 通过 IPC 创建 project、列出 project、查看 Job。

验收：不用任何 AI 和媒体，能完成“创建项目 → 写一条命令 → 事务提交 → 重启后读取 → 重复命令不重复写入 → revision 冲突被拒绝”。

### M2：媒体导入和本地事实层

**依赖：M1。可与 M3 的 Provider 合同并行。**

实现：

- `asset.import`：文件选择、MIME/大小校验、hash、拷贝/引用策略；
- ffprobe 技术事实、proxy、waveform、thumbnail、artifact manifest；
- FFmpeg/ffprobe utility process，主进程只调度和收 receipt；
- PySceneDetect 主切分，TransNetV2 作为争议发现；
- whisper.cpp ASR worker，词/句时间戳和 VAD；
- PaddleOCR/Apple Vision adapter，抽帧去重和 OCR evidence；
- AssetSegment、Transcript、OcrEvidence、ShotBoundary 表和 FTS5 索引；
- 失败隔离：单个模型失败不阻塞导入，状态显示为 not_analyzed/failed。

验收：导入 fixture 视频后可播放代理，重新打开项目仍能看到时间线证据；ASR/OCR/shot 时间戳不越界；重复导入按 hash 去重；worker 崩溃可重试。

### M3：Provider 和 Agent runtime 基础

**依赖：M1。M2 可并行，但 Agent 不依赖媒体完成。**

实现：

- `ModelCatalog`、`CapabilityProfile`、structured output、stream、usage/cost/error normalization；
- AI SDK 7 adapter：先 mock，再两个真实 Provider，再一个 OpenAI-compatible/local provider；
- `packages/agent-runtime` 的 `AgentRuntimePort`；
- Mastra 1.58.x adapter，独立 `agent-runtime.sqlite`/namespace；
- Agent instructions、tool manifest、approval pause/resume、run receipt、脱敏 trace；
- research/script/storyboard/asset-curator/edit-planner/review 六类 Agent 的空壳注册，先只启用 research-agent 和 script-agent；
- tool contract fixture：schema、拒绝、审批、重试、断线恢复。

验收：同一个 `script.generate_proposal` 不改业务代码即可切换两个 Provider；renderer 不打包 Mastra 和 key；Agent 重启可恢复；批准前不写入 ScriptRevision 事实。

### M4：第一个垂直切片——脚本到拍摄包

**依赖：M1、M3；M2 只需要有素材/图片引用能力。**

实现：

- CreatorProfile/VoiceProfile 的最小版本和用户确认机制；
- `script.generate_proposal`：输入 ThoughtPlan/证据，输出 ScriptRevision proposal；
- diff、局部重写、accept/reject、版本比较；
- `storyboard.generate`：把脚本段落变成 shot、时长、景别、动作、道具、声音、补拍描述；
- `capture_package.export`：手机可读的拍摄任务包、示意图占位、拍摄顺序、take checklist；
- 多 Take 导入和用户选择；
- 通过 e2e 模拟“生成 → 编辑 → 接受 → 导出拍摄包 → 导入 Take”。

验收：用户可以从一条已确认脚本得到逐镜头拍摄包；不控制摄像头；每条拍摄任务可关联素材/Take；AI 生成内容保留来源和版本。

### M5：对标账号研究闭环

**依赖：M2、M3、M4 的 Topic/Script 合同。**

实现：

- TikHub connector：账号快照、作品列表、指标快照、能力/限流/错误合同；
- 参考视频下载本地化、临时 URL 过期处理、来源和权限标记；
- 批量 Job：probe → proxy → ASR/OCR/shot → VLM optional；
- `BenchmarkVideoAnalysis`、`PatternFinding`、`TopicOpportunity`、`CoverageReport`；
- 证据抽屉：指标、文案、分镜、OCR、ASR、视觉 evidence 必须能追溯到时间区间；
- 失败/部分覆盖/成本报告；
- 账号分析结果不自动写入用户素材库，用户确认后才转成 Topic/Creator memory。

验收：fixture 账号和真实小范围联调各跑一遍；分析窗口可恢复；任一视频失败不会丢失其他结果；每个模式结论至少关联一条证据；真实 TikHub 调用有额度、范围和清理记录。

### M6：素材检索和 AI 粗剪提案

**依赖：M2、M4；M3 的 Agent Tool 和 M5 的 evidence 可选。**

实现：

- `asset.search`：FTS5 + 结构化过滤 + 时间/人物/镜头条件；
- `VectorIndex` adapter，先本地/可选 embedding，不让向量服务成为事实源；
- CandidateSet、matchedEvidence、缺口和人工标签；
- `asset-curator-agent` 生成候选解释，不直接选定素材；
- `edit-planner-agent` 生成 A-roll 连续优先的 EditProposal；
- proposal review：接受、替换、拒绝、撤销、版本比较；
- 空缺镜头进入补拍任务，不用模型编造事实。

验收：给定脚本和素材库能生成可解释候选；用户能替换候选并看到差异；没有素材时能产出缺口报告和拍摄任务；没有模型时仍能用规则生成保守提案。

### M7：FrozenEditSpec、RenderIR 和稳定导出

**依赖：M6。**

实现顺序：

1. 用 TypeScript reference compiler 实现 `EditProposal → FrozenEditSpec → RenderIR`；
2. 时间区间、fps/VFR、音频混音、字幕、花字、素材引用和 capability validation；
3. preview render 和 golden media fixtures；
4. FFmpeg/ASS/SVG 正式渲染；
5. MP4、SRT/VTT、封面、manifest、媒体交付包；
6. FCPXML/OTIO adapter；
7. 再把经过 fixture 验证的时间和 IR 热路径迁到 Rust media-core；
8. 剪映草稿作为单版本实验 adapter，输出 LossReport 和 reopen smoke 结果。

验收：渲染热路径零 LLM/VLM；同一 FrozenEditSpec 可重复输出同一 RenderIR；输出文件可重新打开、时长/轨道/编码符合 profile；Rust 与 TypeScript reference 结果一致。

### M8：发布、复盘和受控记忆

**依赖：M7、M5。**

实现：

- 手动发布包：视频、封面、标题、话题、字幕和平台清单；
- 平台官方 Connector 的能力、审批、状态和失败恢复；
- Publication、MetricSnapshot、Experiment；
- 复盘建议只能生成 ReviewMemory proposal；
- `review_memory.propose → user.accept → domain.persist`；
- 用已接受的 VoiceProfile/ReviewMemory 改进脚本，不允许隐式训练或自动覆盖事实。

验收：发布前有明确确认页；提交未知状态不能自动重试；指标可以关联到作品版本和素材使用；复盘记忆有来源、接受人和可撤销历史。

## 5. 并行工作流和关键路径

```text
M0
 ├→ M1 Domain/Command/Job ─┬→ M2 Media facts ─→ M6 Asset/Edit proposal ─→ M7 Render/Export ─→ M8 Publish/Review
 │                          └→ M4 Script/Storyboard/Capture ────────────────┘
 └→ M3 Provider/Agent ──────┘
                M5 Account research 依赖 M2 + M3，并向 M4/M6 提供 evidence
```

推荐团队拆分：

| 工作流 | 主要负责 | 不能越过的边界 |
|---|---|---|
| Platform | Electron、IPC、SQLite、Job/outbox、打包 | 不写 UI 业务规则和 Agent prompt |
| Domain | 实体、命令、事件、迁移、repository | 不依赖 Mastra/Provider/FFmpeg |
| Media | worker、探测、ASR/OCR/shot、artifact | 不直接改领域事实；通过 receipt 回写 |
| AI/Provider | AI SDK、Mastra、模型目录、Tool adapter | 不直接写 SQLite、文件或剪辑工程 |
| Creation/UI | 研究、脚本、分镜、素材、审阅界面 | 不直接调用第三方 API |
| Exchange | RenderIR、FFmpeg、FCPXML/OTIO、CapCut adapter | 不重新让模型决定已冻结参数 |

如果只有一个开发者，仍按这些边界分目录和提交，不按“页面做完再补架构”的顺序开发。

## 6. 测试和质量门

### 每个模块

- 正常、空输入、重复、超时、取消、崩溃恢复、部分失败、迁移、权限拒绝；
- schema contract 和错误码 contract；
- idempotency/revision conflict；
- 日志不泄露 key、Cookie、完整原始视频和不必要的用户原文。

### 领域和数据库

- migration up/down 或明确不可逆迁移说明；
- SQLite WAL、备份、恢复、损坏检测、锁等待和并发读写 fixture；
- repository port 的 SQLite fixture 和未来 PostgreSQL contract fixture；
- command receipt 可回放，event 与新 revision 一致。

### Provider/Agent

- mock Provider 先于真实 API；
- structured output、能力探测、限流、异步轮询、临时 URL、费用和错误映射；
- Agent Tool 只能访问注册命令；审批前后、断线 resume、重复批准和取消；
- Mastra 升级要跑全套 contract；AI SDK provider 兼容性必须有真实 smoke。

### 媒体和导出

- golden fixtures 覆盖 CFR/VFR、不同 fps、竖屏、无音频、双音轨、中文花字、短片段和损坏输入；
- ASR/OCR/shot 时间不越界、不重复、不漏边界；
- RenderIR 时间轴合法、重复编译一致；
- 输出可播放、可重新打开、metadata 与 CapabilityReport 一致；
- Rust reference compiler 与 TypeScript compiler 对账。

### 用户任务 E2E

至少固定四条：

1. 新建项目 → 导入素材 → 看到代理和转写；
2. 选题/脚本 → 分镜 → 导出拍摄包 → 导入 Take；
3. 脚本 + 素材 → AI 粗剪提案 → 替换候选 → 冻结 → 导出；
4. 对标账号 → 小窗口分析 → 证据抽屉 → 选题机会 → 回到脚本。

## 7. 交付门和版本策略

每个里程碑必须同时提交：

- 代码、迁移、fixture 和测试；
- 相关 ADR/合同文档；
- 失败路径和恢复说明；
- 运行截图或导出物；
- 许可证和依赖变更清单；
- `pnpm typecheck`、相关测试、build/package smoke 的真实结果。

版本策略：

- Node 24 LTS、Electron 43.x、TypeScript 6.x、AI SDK 7.x、Mastra 1.58.x 先锁定；
- 不使用 `latest`、Git branch 或未经审计的模型/FFmpeg 构建；
- 依赖升级单独开变更，先跑合同、E2E、媒体 golden 和打包；
- 任何破坏性 schema/项目格式变更都要有迁移和旧项目恢复 fixture。

## 8. 完成定义

一个阶段只有同时满足以下条件才算完成：

1. 用户能完成该阶段描述的真实任务；
2. 正常和失败状态都能从 UI、receipt 或 Job 中解释；
3. 数据、媒体和 AI 产物有唯一事实源和可追溯来源；
4. 可重启、可取消、可恢复、可回滚或明确说明不可回滚；
5. 相关测试和真实 smoke 已运行并记录；
6. 没有把未实现能力写成产品已支持。

## 9. 实施起点

第一批代码任务应按以下顺序拆 Issue/PR：

```text
P0-01 workspace + Electron secure shell
P0-02 SQLite migrations + backup/restore
P0-03 ID/revision/command/receipt contracts
P0-04 Job/outbox state machine
P0-05 typed preload/IPC contract
P1-01 project/asset repository + import fixture
P1-02 ffprobe/hash/proxy worker
P1-03 artifact manifest + media fixture
P1-04 FTS5 transcript/OCR/shot index
P1-05 AI SDK ProviderPort + mock/real smoke
P1-06 Mastra AgentRuntimePort + approval/resume
P2-01 script proposal + review
P2-02 storyboard/capture package
P2-03 take import/select
P2-04 asset candidate search
P2-05 edit proposal/review
P3-01 FrozenEditSpec/RenderIR reference compiler
P3-02 FFmpeg preview/export + golden media
P3-03 FCPXML/OTIO + capability report
P4-01 TikHub account research vertical slice
P4-02 publication/review/accepted memory
```

这些任务的 PR 必须小于一个完整阶段，跨包合同先合并；禁止以“先把所有 UI 做出来”作为进度标准。

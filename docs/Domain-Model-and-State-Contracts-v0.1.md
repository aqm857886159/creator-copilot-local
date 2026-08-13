# 领域模型与状态机契约 v0.1

版本：v0.1  
日期：2026-08-13  
上游：[PRD-v0.2-Workflow-and-Scope.md](./PRD-v0.2-Workflow-and-Scope.md)、[Technical-Complete-Solution-v0.1.md](./Technical-Complete-Solution-v0.1.md)、[Independent-Product-Review-v0.1.md](./Independent-Product-Review-v0.1.md)、[Agent-Stack-CTO-Review-v0.1.md](./Agent-Stack-CTO-Review-v0.1.md)

## 1. 目标

本文件把产品流程拆成稳定的业务对象、版本、状态和事件。它不是数据库迁移脚本，也不是最终 TypeScript 实现；它是 UI、Agent、Provider、媒体管线和导出器共同遵守的领域契约。

核心判断：

> 项目记录“用户创作了什么”；任务记录“系统正在做什么”；产物记录“系统产出了什么”；证据记录“为什么这样建议”。

## 2. 统一约定

### 2.1 ID 与版本

- 每个领域对象使用不可变 `id`，推荐 UUIDv7 或带时间排序的随机 ID；
- 每个可编辑对象同时有单调递增 `revision`；
- 每个引用都保存 `objectId + revision`，不能只存显示名称；
- 每个 AI 输出保存 `sourceRunId`、`modelKey`、`promptVersion`、`createdAt` 和 `adoptionStatus`；
- 删除优先使用软删除或归档，不删除原始媒体和已发布证据；
- 本地数据库写入使用事务，跨进程命令带 `expectedRevision`，冲突时拒绝而不是覆盖。

### 2.2 时间与媒体

- 内部时间统一使用整数毫秒或明确标注的帧数，禁止混用浮点秒和毫秒；
- 任何媒体区间使用半开区间 `[start, end)`；
- 所有时间线对象保存 `timebase`、`fps` 或音频采样率；
- 外部 Provider 返回的 URL 不是资产 ID；下载完成后必须生成本地 `Asset`。

### 2.3 来源与证据

用户事实、外部数据、模型推断和人工确认必须分开：

```text
ObservedFact       外部或本地观察到的事实
Inference          AI/规则推断
UserDecision       用户确认、修改或否决
EvidenceLink       事实或推断的来源
```

模型推断不能覆盖事实字段；用户确认后也要保留原始建议，便于复盘。

## 3. 核心实体

### 3.1 Workspace

工作区是本地数据、媒体目录和配置的边界。

```ts
type Workspace = {
  id: WorkspaceId;
  name: string;
  rootPath: string;
  schemaVersion: number;
  defaultLocale: "zh-CN" | "en";
  createdAt: string;
  updatedAt: string;
};
```

约束：workspace 导出包不得包含明文 Provider key；workspace 迁移时通过 credential reference 重新绑定密钥。

### 3.2 CreatorProfile 与 Account

`CreatorProfile` 是创作者对自己的定位和表达约束，`VoiceProfile` 是从创作者真实样本中归纳出的表达/思考档案，`Account` 是平台账号连接和公开信息快照。

```ts
type CreatorProfile = {
  id: string;
  workspaceId: string;
  name: string;
  audience: string[];
  positioning: string;
  pillars: Array<{ id: string; name: string; description?: string }>;
  tone: string[];
  forbiddenClaims: string[];
  confirmedRevision: number;
};

type VoiceProfile = {
  id: string;
  workspaceId: string;
  creatorProfileId: string;
  revision: number;
  sourceEvidenceIds: string[];
  surfaceStyle: {
    sentenceLength: "short" | "mixed" | "long";
    directness: "indirect" | "balanced" | "direct";
    vocabulary: string[];
    connectors: string[];
    preferredOpenings: string[];
    avoidOpenings: string[];
  };
  thinkingPattern: {
    defaultStructures: string[];
    claimToReasoning: string[];
    evidencePreference: "experience" | "examples" | "data" | "mixed";
    counterpointHabit: "rare" | "sometimes" | "often";
    uncertaintyStyle: "explicit" | "qualified" | "decisive";
  };
  speechPattern: {
    pauseMarkers: string[];
    emphasisMarkers: string[];
    repairStyle: string[];
    allowedDisfluency: "none" | "light" | "preserve";
  };
  boundaryRules: {
    forbiddenPhrases: string[];
    forbiddenClaims: string[];
    neverInventPersonalExperience: boolean;
    citationRequiredFor: string[];
  };
  status: "draft" | "confirmed" | "stale" | "archived";
};

type Account = {
  id: string;
  platform: "douyin" | "tiktok" | "bilibili" | "youtube" | "other";
  handle?: string;
  profileUrl?: string;
  role: "owned" | "benchmark" | "watched";
  latestSnapshotId?: string;
  connectionStatus: "manual" | "connected" | "expired" | "error";
};
```

### 3.3 SourceEvidence 与 BenchmarkVideo

外部平台结果必须先落为证据，再转为业务对象。

```ts
type SourceEvidence = {
  id: string;
  sourceKind: "tikhub" | "platform" | "user_import" | "local_analysis";
  endpoint?: string;
  query?: Record<string, unknown>;
  fetchedAt: string;
  rawPayloadHash?: string;
  retention: "full" | "redacted" | "hash_only";
  confidence?: number;
};

type BenchmarkVideo = {
  id: string;
  evidenceId: string;
  platform: string;
  platformVideoId?: string;
  title: string;
  shareUrl?: string;
  creatorAccountId?: string;
  publishedAt?: string;
  durationMs?: number;
  metrics: Record<string, number | null>;
  rankings: string[];
  normalizedAt: string;
};
```

### 3.4 TopicOpportunity

选题机会不是标题，而是一个可验证的内容方向。

```ts
type TopicOpportunity = {
  id: string;
  workspaceId: string;
  title: string;
  audienceProblem: string;
  thesis: string;
  angle: string;
  evidenceIds: string[];
  benchmarkVideoIds: string[];
  visualOpportunities: string[];
  riskNotes: string[];
  score?: { value: number; rationale: string };
  status: "candidate" | "selected" | "in_progress" | "used" | "archived";
  revision: number;
};
```

### 3.5 Script 与 ScriptBlock

脚本文本和结构化段落必须保持双向可定位关系。

```ts
type Script = {
  id: string;
  projectId: string;
  revision: number;
  status: "draft" | "reviewing" | "approved" | "archived";
  blocks: ScriptBlock[];
  estimatedDurationMs: number;
  voiceProfileRevision?: number;
  thoughtPlanId?: string;
  authenticityReportId?: string;
  spokenEditStatus?: "not_run" | "reviewing" | "accepted";
  promptVersion?: string;
  sourceRunId?: string;
};

type ThoughtPlan = {
  id: string;
  projectId: string;
  topicOpportunityId?: string;
  voiceProfileRevision?: number;
  thesis: string;
  reasoningSteps: Array<{ id: string; claim: string; reason: string; evidenceIds: string[] }>;
  examples: string[];
  counterpoints: string[];
  uncertaintyNotes: string[];
  personalInputs: Array<{ text: string; sourceEvidenceId?: string; userConfirmed: boolean }>;
  status: "draft" | "user_confirmed" | "superseded";
};

type AuthenticityReport = {
  id: string;
  scriptId: string;
  voiceProfileRevision?: number;
  voiceMatch: number;
  spokenNaturalness: number;
  specificity: number;
  stanceClarity: number;
  aiPatternRisk: number;
  factualRisk: number;
  findings: Array<{
    spanId?: string;
    kind: "template" | "written_language" | "unsupported_claim" | "over_polished" | "missing_boundary" | "generic_filler";
    severity: "info" | "warning" | "block";
    reason: string;
    suggestion?: string;
  }>;
  status: "draft" | "reviewed" | "accepted";
};

type ScriptBlock = {
  id: string;
  order: number;
  kind: "hook" | "claim" | "evidence" | "example" | "counterpoint" | "transition" | "conclusion" | "cta";
  text: string;
  emphasis: string[];
  evidenceIds: string[];
  visualNeed?: "none" | "support" | "must_show";
};
```

`VoiceProfile` 不等同于音色克隆：前者约束文字的思考方式和口语表达，后者属于独立的音频 Provider 能力。`ThoughtPlan` 必须先经过用户确认，才能成为正文生成的依据；`AuthenticityReport` 只提供可解释的审校建议，不能自动改写用户已经确认的事实和立场。

### 3.6 Storyboard 与 Shot

`Storyboard` 表达内容如何变成画面；它不是时间线，也不能直接当渲染输入。

```ts
type Storyboard = {
  id: string;
  projectId: string;
  scriptRevision: number;
  revision: number;
  status: "draft" | "reviewing" | "approved" | "frozen";
  shots: Shot[];
};

type Shot = {
  id: string;
  order: number;
  scriptBlockIds: string[];
  purpose: "explain" | "prove" | "transition" | "emotion" | "reset" | "brand";
  mode: "talking_head" | "broll" | "screen_recording" | "graphic" | "generated" | "still";
  framing?: "wide" | "medium" | "close" | "detail" | "screen";
  cameraDirection?: string;
  actionDescription: string;
  referenceImageId?: string;
  duration: { targetMs: number; minMs?: number; maxMs?: number };
  sourceRequirement: "existing_asset" | "shoot_task" | "generated_asset" | "any";
  assetCandidates: AssetCandidate[];
  selectedAssetRef?: AssetSegmentRef;
  status: "planned" | "needs_material" | "ready" | "covered" | "rejected";
};
```

### 3.7 ShootTask

拍摄任务把“需要什么画面”变成创作者可执行的动作。

```ts
type ShootTask = {
  id: string;
  projectId: string;
  shotId: string;
  title: string;
  instruction: string;
  duration: { targetMs: number; minMs?: number; maxMs?: number };
  deviceHint?: "phone" | "camera" | "screen" | "any";
  orientation?: "portrait" | "landscape" | "any";
  checklist: string[];
  referenceImageId?: string;
  capturePackageId?: string;
  status: "todo" | "recorded" | "imported" | "accepted" | "skipped";
  linkedAssetIds: string[];
  takeIds: string[];
};

type CapturePackage = {
  id: string;
  projectId: string;
  storyboardRevision: number;
  format: "html" | "qr" | "image_sheet" | "text";
  localPath: string;
  taskIds: string[];
  expiresAt?: string;
  status: "draft" | "ready" | "superseded" | "archived";
};

type Take = {
  id: string;
  shootTaskId: string;
  assetId: string;
  capturedAt?: string;
  sourceDevice?: "phone" | "camera" | "screen" | "unknown";
  orientation?: "portrait" | "landscape";
  technicalFlags: string[];
  transcriptSpanIds: string[];
  userRating?: number;
  selection: "unreviewed" | "candidate" | "selected" | "rejected";
  rejectionReason?: string;
};
```

软件只负责指导、跨设备交接、接收和检查，不默认控制拍摄设备。一个 ShootTask 可以有多个 Take，只有用户选择或明确批准的 Take 才能进入正式剪辑提案。

分镜引用的辅助类型：

```ts
type AssetTag = {
  key: string;
  value: string;
  source: "system" | "ai" | "user";
  confidence?: number;
};

type AssetCandidate = {
  assetSegmentId: string;
  score: number;
  reasons: string[];
  warnings: string[];
};

type AssetSegmentRef = {
  assetSegmentId: string;
  startMs: number;
  endMs: number;
};
```

### 3.8 Asset 与 AssetSegment

文件是容器，镜头区间才是可检索和可剪辑的使用单元。

```ts
type Asset = {
  id: string;
  workspaceId: string;
  kind: "video" | "image" | "audio" | "document";
  originalPath: string;
  contentHash: string;
  mediaFingerprint?: string;
  technical: { width?: number; height?: number; fps?: number; durationMs?: number; codec?: string; sampleRate?: number };
  derivativeIds: string[];
  rights: { status: "owned" | "licensed" | "unknown" | "restricted"; note?: string };
  tags: AssetTag[];
  transcriptId?: string;
  ocrId?: string;
  status: "discovered" | "ingesting" | "ready" | "needs_review" | "missing" | "archived";
};

type AssetSegment = {
  id: string;
  assetId: string;
  startMs: number;
  endMs: number;
  thumbnailPath?: string;
  tags: AssetTag[];
  transcript?: string;
  visualSummary?: string;
  searchableText?: string;
  orientation?: "portrait" | "landscape" | "square";
  shotType?: string;
  people?: string[];
  actions?: string[];
  status: "candidate" | "approved" | "rejected";
};
```

### 3.9 EditProposal、FrozenEditSpec 与 RenderIR

剪辑建议和正式执行合同必须分离。

```ts
type EditProposal = {
  id: string;
  projectId: string;
  basedOn: { scriptRevision: number; storyboardRevision: number };
  operations: TimelineOperation[];
  rationale: Array<{ operationId: string; shotId?: string; reason: string; confidence?: number }>;
  status: "draft" | "previewed" | "partially_adopted" | "adopted" | "rejected";
};

type FrozenEditSpec = {
  id: string;
  projectId: string;
  revision: number;
  sourceProposalId?: string;
  tracks: FrozenTrack[];
  outputProfile: OutputProfile;
  assetLocks: Array<{ assetId: string; contentHash: string }>;
  authoredSpecHash: string;
};

type RenderIR = {
  version: string;
  projectId: string;
  resolvedSpecHash: string;
  tracks: RenderTrack[];
  outputProfile: OutputProfile;
  deterministic: true;
};
```

时间线辅助类型：

```ts
type TimelineOperation = {
  id: string;
  kind: "insert" | "remove" | "move" | "trim" | "split" | "set_property";
  targetId?: string;
  payload: Record<string, unknown>;
};

type FrozenTrack = {
  id: string;
  kind: "video" | "audio" | "subtitle" | "text" | "effect";
  clips: Array<Record<string, unknown>>;
};
```

### 3.10 Publication、MetricSnapshot 与 ReviewMemory

发布和复盘不能改写原始作品，只能产生新的事实快照和记忆建议。

```ts
type Publication = {
  id: string;
  projectId: string;
  platform: string;
  versionId: string;
  publishedAt?: string;
  externalId?: string;
  status: "draft" | "scheduled" | "published" | "failed" | "removed";
};

type MetricSnapshot = {
  id: string;
  publicationId: string;
  capturedAt: string;
  window: string;
  metrics: Record<string, number | null>;
  sourceEvidenceId?: string;
};

type ReviewMemory = {
  id: string;
  workspaceId: string;
  sourceProjectId?: string;
  statement: string;
  evidenceIds: string[];
  confidence: number;
  status: "candidate" | "confirmed" | "rejected" | "expired";
  appliesTo: { pillars?: string[]; formats?: string[]; platforms?: string[] };
};
```

## 4. 项目状态机

### 4.1 Project

```text
idea → planning → scripting → storyboarding → shooting
     → ingesting → rough_cut → review → exported
     → published → reviewing → archived
```

允许的异常状态：`blocked`、`needs_attention`、`cancelled`。

规则：项目阶段只能由领域命令推进；任务失败不会自动把项目回退到上一个阶段，而是写入阻塞原因和下一步动作。

### 4.2 Asset

```text
discovered → ingesting → ready → needs_review
                         └──────→ missing
ready → archived
```

原始文件缺失时保留资产记录、hash、历史引用和重新定位入口。

### 4.3 Shot 与 ShootTask

```text
planned → needs_material → ready → covered
    └──────────────→ rejected

todo → recorded → imported → accepted
  └──────────────────────→ skipped

Take: unreviewed → candidate → selected
                 └───────→ rejected
```

“covered”表示分镜已有可用镜头，不表示一定已经进入最终时间线。选中新的 Take 不删除旧 Take；它只改变当前选择，旧素材仍保留用于回看和重新选择。

### 4.4 AI/Provider Job

```text
planned → authorization_required → authorized
        → submit_intent_persisted → submitting
        → provider_accepted → polling → downloading
        → validating_technical → validating_content
        → ready → adopted

任意外部阶段可进入：retry_wait / failed / needs_attention
提交回执不明：submission_unknown → reconciling → provider_accepted 或 needs_attention
```

禁止从 `submission_unknown` 直接再次提交。

## 5. 事件与命令

所有修改通过领域命令产生事件，事件必须包含：

```ts
type DomainEvent = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  aggregateRevision: number;
  type: string;
  payload: unknown;
  actor: "user" | "agent" | "system" | "provider";
  idempotencyKey?: string;
  occurredAt: string;
};
```

第一批命令：

```text
project.create / project.advance / project.archive
topic.create / topic.select / topic.reject
script.generate / script.update / script.approve
storyboard.generate / storyboard.update / storyboard.freeze
shoot_task.create / capture_package.export / shoot_task.complete / shoot_task.skip
take.import / take.select / take.reject
asset.import / asset.relocate / asset.tag / asset.segment_approve
edit_proposal.create / edit_proposal.preview / edit_proposal.adopt
timeline.apply / timeline.undo / timeline.redo
render.submit / render.reconcile / render.adopt
publication.record / metrics.capture / memory.confirm
```

命令必须支持版本冲突检查和幂等键；Agent 与 UI 使用同一套命令，不各自修改数据库。

## 6. 核心不变量

1. 没有 `FrozenEditSpec`，不能进入正式渲染队列；
2. 没有本地 content hash 的资产，不能进入可复现的正式剪辑；
3. 任何引用素材的时间线片段都必须指向 `AssetSegment` 或明确的整文件区间；
4. 任何外部事实必须有 `SourceEvidence` 或标记为用户手动输入；
5. 供应商 key 不能出现在领域对象、项目文件、事件 payload 和日志中；
6. 同一 `idempotencyKey` 与不同请求内容必须报冲突；
7. `submission_unknown` 状态禁止自动重复提交；
8. 删除项目不会删除 workspace 中仍被其他项目引用的资产；
9. 渲染过程不能修改脚本、分镜、素材标签和 FrozenEditSpec；
10. 用户拒绝的 AI 建议可以保留为历史，但不能再次作为“已采用”事实召回。
11. 同一 ShootTask 可关联多个 Take，但同一时刻最多只有一个默认 selected Take；正式剪辑若使用其他 Take 必须显式记录选择原因。

## 7. 本地持久化建议

SQLite 保存事实和索引，文件系统保存媒体与派生物：

```text
workspace/
  workspace.db
  assets/originals/<content-hash>/*
  assets/derivatives/<asset-id>/*
  projects/<project-id>/exports/<version>/*
  evidence/<evidence-id>/payload.json
  fixtures/                         # 脱敏测试数据
```

数据库至少需要：`projects`、`creator_profiles`、`voice_profiles`、`thought_plans`、`authenticity_reports`、`accounts`、`evidence`、`topics`、`scripts`、`storyboards`、`shots`、`shoot_tasks`、`capture_packages`、`takes`、`assets`、`asset_segments`、`tags`、`edit_proposals`、`timeline_versions`、`jobs`、`job_attempts`、`publications`、`metric_snapshots`、`memories`、`events`。

搜索第一阶段使用 SQLite FTS5 + 结构化过滤；向量索引作为可替换加速层，不能成为唯一检索路径。

## 8. 迁移和兼容

- 数据库 schema 使用显式版本和单向迁移；
- 新增字段优先可选，删除字段必须经过一个迁移周期；
- Provider 状态和外部响应保存原始值，同时保存归一化值，方便上游字段变化时重放；
- 项目导出包包含 `manifestVersion`、schema version、hash 和生成软件版本；
- 任何变更项目文件结构的提交必须新增 fixture，并验证旧 fixture 可读。

# Provider、素材传输与交换格式契约 v0.1

版本：v0.1  
日期：2026-08-13  
上游：[Domain-Model-and-State-Contracts-v0.1.md](./Domain-Model-and-State-Contracts-v0.1.md)、[Technical-Complete-Solution-v0.1.md](./Technical-Complete-Solution-v0.1.md)、[Independent-Product-Review-v0.1.md](./Independent-Product-Review-v0.1.md)、[Agent-Stack-CTO-Review-v0.1.md](./Agent-Stack-CTO-Review-v0.1.md)

## 1. 架构结论

Provider 是能力执行器，不是业务决策器；Connector 是外部数据连接器，不是产品事实库。

~~~
领域命令
  → Capability Router
  → Provider/Connector Adapter
  → Job / Evidence / Asset 回收
  → 领域事件
~~~

业务层只使用稳定的 capability 和 modelKey。供应商端点、鉴权、模型内部 ID、参数名称、状态词和响应路径全部封装在适配器中。

## 2. 最终技术栈基线

本节保留协议层需要的最小基线；完整的版本锁定、进程拓扑、worker 协议、分阶段施工和打包策略见 [Technical-Complete-Solution-v0.1.md](./Technical-Complete-Solution-v0.1.md)。

### 桌面端

- Electron + React + TypeScript；
- main process：SQLite、文件系统、FFmpeg、Provider、任务调度、密钥仓库；
- renderer：工作区 UI、预览、审核和编辑交互；
- preload：最小、版本化 IPC API；
- 不允许 renderer 直接访问 Node、API key、第三方网络或数据库。

### 数据和媒体

- SQLite 作为本地事实库；
- 文件系统保存原始媒体、代理、缩略图、波形、字幕和导出；
- FFmpeg/ffprobe 作为确定性媒体底座；
- SQLite FTS5 作为第一阶段全文检索；
- 向量索引为可替换加速层，不得取代结构化过滤和全文检索。

### AI 执行

- 文本、视觉、ASR、图像、视频、音频均通过 Provider Registry；
- 本地 Provider 优先支持 Ollama、Whisper/Qwen ASR、ComfyUI 等；
- 云端 Provider 通过统一 job/outbox 运行；
- AI 输出必须有 schema、版本、来源和失败路径。

## 3. Capability 和 Provider 类型

公共类型别名：

~~~
type MediaKind = "image" | "video" | "audio" | "document";
type CanonicalParams = Record<string, string | number | boolean | string[] | null>;
~~~

~~~
type Capability =
  | "text_generate"
  | "structured_text"
  | "benchmark_search"
  | "account_snapshot"
  | "image_understand"
  | "image_generate"
  | "video_generate"
  | "audio_generate"
  | "transcribe"
  | "ocr"
  | "scene_detect"
  | "publish"
  | "metrics_read";

type ProviderDescriptor = {
  key: string;
  name: string;
  kind: "cloud" | "local" | "connector";
  capabilities: Capability[];
  baseUrl?: string;
  credentialRef?: string;
  health: "unknown" | "available" | "degraded" | "disabled";
};

type ModelDescriptor = {
  key: string;
  providerKey: string;
  label: string;
  capabilities: Capability[];
  inputKinds: Array<"text" | "image" | "video" | "audio" | "document">;
  outputKinds: Array<"text" | "image" | "video" | "audio" | "json">;
  parameterSchemaVersion: string;
  priceHint?: { currency: string; minimum?: number; maximum?: number };
  sources: Array<{ url: string; checkedAt: string; note?: string }>;
};
~~~

modelKey 稳定地写入项目和事件。供应商内部模型 ID 只能由 mapping 读取。任何端点、参数枚举、默认值、上限、状态词或结果路径都必须能追溯到 `sources`；官方文档未写明时记录 unknown，不允许用猜测补齐契约。

Provider 运行时辅助类型：

~~~
type ProviderContext = {
  workspaceId: string;
  credentialRef: string;
  readAsset: (assetId: string) => Promise<LocalAssetBytes>;
  writeArtifact: (artifact: LocalArtifact) => Promise<void>;
};

type ProviderOutput = {
  kind: "text" | "image" | "video" | "audio" | "json";
  url?: string;
  text?: string;
  providerMeta?: Record<string, unknown>;
};

type ProviderError = {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  providerStatus?: string;
};

type LocalArtifact = {
  path: string;
  contentHash: string;
  kind: MediaKind;
  contentType: string;
};

type LocalAssetBytes = {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
};

type ValidationReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  technical?: Record<string, unknown>;
};
~~~

## 4. 统一任务契约

### 4.1 请求

~~~
type ProviderRequest = {
  jobId: string;
  idempotencyKey: string;
  capability: Capability;
  modelKey: string;
  prompt?: string;
  inputs: AssetInput[];
  params: CanonicalParams;
  callback?: { mode: "poll" | "webhook"; url?: string };
  costCeiling?: { currency: string; amount: number };
};
~~~

### 4.2 响应

~~~
type Submission = {
  providerTaskId: string;
  acceptedAt: string;
  providerState?: string;
  estimatedCost?: { currency: string; amount?: number };
};

type ProviderStatus = {
  state: "queued" | "submitting" | "processing" | "succeeded" | "failed" | "cancelled";
  providerState?: string;
  progress?: number;
  outputs?: ProviderOutput[];
  error?: ProviderError;
  observedAt: string;
};
~~~

### 4.3 Provider 接口

~~~
interface AsyncProvider {
  submit(request: ProviderRequest, context: ProviderContext): Promise<Submission>;
  poll(taskId: string, context: ProviderContext): Promise<ProviderStatus>;
  download(output: ProviderOutput, context: ProviderContext): Promise<LocalArtifact>;
  validate?(artifact: LocalArtifact, context: ProviderContext): Promise<ValidationReport>;
}
~~~

Provider 不负责创建 Topic、Script、Storyboard，也不负责决定用户是否采用结果。

### 4.4 统一错误

~~~
type ProviderErrorCode =
  | "not_configured"
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "insufficient_balance"
  | "rate_limited"
  | "timeout"
  | "provider_rejected"
  | "provider_failed"
  | "download_failed"
  | "validation_failed"
  | "submission_unknown";
~~~

每个错误保存 retryable、providerStatus、脱敏 message、attempt 和建议动作。

## 5. Provider Router 与参数层

参数分三层：

1. Canonical 参数：比例、时长、分辨率、质量、音频、参考图、首尾帧等；
2. Model 参数：某个模型支持的枚举和约束，由 schema 校验；
3. Provider 参数：只存在 mapping 中，用于转换或补充供应商字段。

规则：

- UI 不直接读取 Provider body schema；
- 不支持的参数显式返回 unsupported_parameter 或记录为 drop；
- 变体通过 stable profile 选择，不在 UI 内部拼供应商字符串；
- 同一模型不同 Provider 的参数翻译必须有 fixture；
- mapping 必须是纯转换，不能产生业务副作用。

## 6. TikHub Connector

### 6.1 负责的能力

- 抖音公开作品搜索；
- 对标账号作品快照；
- 热点/话题查询；
- 公开指标和排名信号；
- 后续评论和内容诊断。

### 6.2 处理流程

~~~
用户查询
  → Zod/Schema 校验
  → TikHub 请求
  → HTTP + 业务 code 双重判断
  → 原始响应脱敏/hash
  → normalize
  → SourceEvidence + BenchmarkVideo
~~~

适配器必须：

- 配置 Base URL 和超时；
- key 只从主进程 credential store 读取；
- 对不同响应形状做候选字段归一；
- 缺一个字段时保留记录并填 null，不因单字段缺失丢整批结果；
- 保留查询参数、抓取时间、来源和数据窗口；
- 将部分指标明确标记为 unavailable，不能伪造播放量、完播率或粉丝增长。

### 6.3 领域输出

TikHub 不直接返回 UI 专用数据，统一输出：

~~~
type BenchmarkSearchResult = {
  evidence: SourceEvidence;
  items: BenchmarkVideo[];
  partialMetrics: string[];
  nextCursor?: string;
};
~~~

### 6.4 与账号授权和发布的边界

- TikHub Connector 只作为研究/公开数据证据源，不等同于平台账号登录；
- TikHub 的非官方数据接口不能代替平台官方发布 API；
- 发布能力必须使用独立 PublishingConnector，分别管理 OAuth/scope、应用审核、隐私级别、配额、重复发布和 token 过期；
- 没有可用发布 Connector 时，系统仍可输出本地发布包，主创作流程不得被阻断。

## 7. APIMart Provider

### 7.1 已知异步形状

第一版按当前内部实现封装：

~~~
POST /v1/images/generations
POST /v1/videos/generations
        ↓ data[0].task_id
GET  /v1/tasks/{task_id}
        ↓ data.status + data.result.images/videos
~~~

所有上游状态映射为统一状态；所有输出 URL 必须下载回本地并完成技术校验。

### 7.2 适配器边界

- APIMart 内部模型 ID 只写在 Provider seed/mapping；
- 图片上传和视频/音频上传按不同 ingestion capability 处理；
- 创建请求使用 canonical 参数转换；
- 轮询最多按 job policy 重试，不允许无限轮询；
- 供应商返回成功但本地下载失败时，任务进入 download_failed，不能标为 ready；
- 供应商返回空 task id 时视为提交失败；
- 请求已发出但回执不明时进入 submission_unknown，禁止盲目重提。

### 7.3 APIMart 早期能力映射

| 统一能力 | APIMart 映射 | 第一阶段处理 |
|---|---|---|
| image_generate | /v1/images/generations | 支持文生图、改图和轮询 |
| video_generate | /v1/videos/generations | 支持文生视频、图生视频和轮询 |
| audio_generate | 供应商模型 mapping | 先保留 Provider 能力，不进入首条闭环 |
| text_generate | OpenAI-compatible endpoint | 可作为文本 Provider，不绑定业务层 |

具体模型列表、价格和参数必须以对应 Provider mapping 与 fixture 为准，不写死在 PRD。

## 8. Asset Transport

### 8.1 输入

~~~
type AssetInput = {
  assetId: string;
  kind: "image" | "video" | "audio" | "document";
  segment?: { startMs: number; endMs: number };
};
~~~

### 8.2 传输策略

~~~
type AssetIngestion =
  | { strategy: "none" }
  | { strategy: "inline-base64"; accepts: MediaKind[]; maxBytes?: number }
  | { strategy: "upload-multipart"; endpoint: string; accepts: MediaKind[]; expiresInMs?: number }
  | { strategy: "upload-stream"; endpoint: string; accepts: MediaKind[]; expiresInMs?: number }
  | { strategy: "upload-url"; endpoint: string; accepts: MediaKind[]; expiresInMs?: number }
  | { strategy: "local-model-upload"; endpoint: string; accepts: MediaKind[] };
~~~

处理顺序：

1. 读取本地 Asset/Segment；
2. 检查 content type 和大小；
3. 目标 Provider 自有通道优先；
4. 没有通道时按媒体类型选择可用中转；
5. 一个请求内同一 asset 只上传一次；
6. 记录策略、创建时间、过期时间和上传结果；
7. 供应商任务完成后下载成品并尽快回收临时 URL。

### 8.3 安全规则

- 不向只接受图片的接口上传视频或音频；
- 不将长期凭证写进 URL；
- 不把匿名临时托管当作默认的长期素材库；
- 默认减少上传，能使用新鲜 sidecar URL 时不重复上传；
- 任务和日志中只记录 asset ID、策略和 hash，不记录明文 key。

## 9. 本地媒体管线

### 9.1 导入阶段

~~~
扫描/拖入
  → content hash
  → ffprobe
  → 原始资产落盘
  → proxy/poster/waveform
  → scene cut
  → ASR/OCR/VLM
  → AssetSegment
  → FTS/可选向量索引
~~~

导入必须可恢复、可重复执行、可暂停；同一 content hash 不重复生成相同派生物。

### 9.2 质量门

至少检查：

- 文件存在且可读；
- duration、fps、宽高和 codec 可探针；
- 代理和缩略图可生成；
- ASR 时间码不越界；
- AssetSegment 使用半开区间且不越界；
- 原始文件删除或移动后能进入 missing 并提供重新定位。

## 10. AI 输出契约

### 文本

- 结构化输出优先于自由文本；
- 脚本生成输出必须符合 Script schema；
- 个性化脚本请求必须显式携带已确认的 `VoiceProfile` 修订号和 `ThoughtPlan`；Provider 只能据此表达，不能替用户创造个人经历、资历、事实或立场；
- `VoiceRender`、`SpokenEdit` 和 `AuthenticityPass` 是独立阶段，不能用一次“humanize”调用替代；用户修改和边界规则优先于模型偏好；
- 文本风格匹配与音色克隆是两个独立能力，不能因为接入了语音 Provider 就默认获得创作者的文字表达授权；
- 对标分析输出必须带 evidence IDs；
- 失败时返回可解释的 validation error，不能静默降级为一段散文。

### 视觉理解

- 输出标签、摘要、人物/动作/场景和置信度；
- AI 标签是候选，不直接覆盖人工标签；
- 任务失败时保留技术元数据，允许只重跑 VLM。

### ASR/OCR

- 保存 provider、模型版本、语言、时间码和置信度；
- 转写文本可人工校正；
- 字幕导出使用校正后的文本，不直接使用临时模型输出。

## 11. RenderIR 与输出规格

### 11.1 RenderIR 最小结构

~~~
type RenderTrack = {
  id: string;
  kind: "video" | "audio" | "subtitle" | "text" | "effect";
  clips: RenderClip[];
};

type RenderClip = {
  id: string;
  sourceAssetId?: string;
  sourceSegment?: { startMs: number; endMs: number };
  timeline: { startMs: number; endMs: number };
  transform?: { x?: number; y?: number; scale?: number; rotation?: number; crop?: string };
  opacity?: number;
  volume?: number;
  text?: string;
  styleRef?: string;
};

type OutputProfile = {
  container: "mp4" | "mov" | "webm";
  videoCodec: "h264" | "hevc" | "vp9" | "source";
  width: number;
  height: number;
  fps: number;
  videoBitrate?: number;
  audioCodec: "aac" | "opus" | "pcm";
  audioSampleRate: number;
  subtitle: "none" | "srt" | "vtt" | "burn_in";
};
~~~

### 11.2 输出层级

第一阶段保证：

1. MP4 可播放成片；
2. SRT/VTT 字幕；
3. RenderManifest：源素材、hash、时间线、输出 profile、工具版本；
4. 素材交付包：必要素材、字幕、缩略图和 manifest；
5. FCPXML/OTIO 受限导出；
6. 剪映/CapCut 草稿独立实验适配器，只对已验证版本声明能力。

任何输出都必须允许用户设置分辨率、帧率、码率和字幕策略；默认值只是预设。

## 12. FCPXML 与剪映适配器

### FCPXML

- 只映射 RenderIR 中稳定支持的轨道和基础属性；
- 不支持的效果写入 manifest 的 warnings；
- 导出前验证素材路径、时间范围、fps 和 duration；
- 用真实 FCP/兼容编辑器 fixture 验证导入。

### 剪映草稿

- 适配器接收 RenderIR，不直接接收自然语言或任意 Agent JSON；
- 按系统、剪映版本、草稿 schema 和编码器建立矩阵；
- 每个草稿包带 sourceManifest 和适配器版本；
- 每次导出生成 Capability/LossReport，记录已映射、近似映射、丢失和阻断的字段；
- 未在版本矩阵中通过“打开、重新定位素材、修改字幕、保存、重新打开、导出”回归的版本，只能标记为实验性；
- 导入失败时保留 MP4/SRT/素材包作为可靠 fallback；
- 未经真实打开验证，不承诺高级花字、模板、特效和复杂转场可编辑还原。

## 13. 任务、成本与恢复

### 13.1 Outbox

提交外部任务的顺序：

~~~
授权检查 → 成本上限 → 预算预留 → 持久化 submit intent
→ submitting → provider_accepted
~~~

外部回执丢失：

~~~
submission_unknown → provider query/reconcile → accepted 或 needs_attention
~~~

不能使用“请求超时所以供应商没收到”作为重试依据。

### 13.2 成本策略

- 每个 job 保存 cost ceiling 和 estimated cost；
- 供应商不提供可估算成本时，默认进入 authorization_required；
- 测试任务和正式用户任务使用不同 workspace/project 标识；
- 真实测试可使用内部 key，但必须有 task 范围、费用记录和结果清理；
- 永不把 key 或完整 prompt 写进通用日志。

## 14. Provider Conformance Test

每个 Provider 至少有以下脱敏 fixture：

1. healthy/configured；
2. invalid request；
3. unauthorized/forbidden；
4. rate limited；
5. create accepted；
6. queued → processing → succeeded；
7. provider failed；
8. empty task id；
9. lost receipt → submission_unknown；
10. output download and technical validation；
11. repeated idempotency key；
12. unsupported media kind/parameter。

Provider 合同测试通过后才允许接入 UI；真实在线联调只是额外证据，不能代替 fixture。

## 15. 相关文件

- PRD-v0.2-Workflow-and-Scope.md
- Domain-Model-and-State-Contracts-v0.1.md
- Research-and-Architecture-v0.1.md
- Internal-Reuse-Audit-v0.1.md

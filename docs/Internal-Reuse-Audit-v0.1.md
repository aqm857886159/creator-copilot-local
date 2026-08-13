# 两个内部仓库复用审计与落地边界

版本：v0.1  
日期：2026-08-13  
状态：内部参考实现审计；不等同于直接复制代码或生产实现承诺

本审计服务于当前契约：[PRD-v0.2-Workflow-and-Scope.md](./PRD-v0.2-Workflow-and-Scope.md)、[Domain-Model-and-State-Contracts-v0.1.md](./Domain-Model-and-State-Contracts-v0.1.md)、[Provider-Media-Exchange-Contracts-v0.1.md](./Provider-Media-Exchange-Contracts-v0.1.md)、[Independent-Product-Review-v0.1.md](./Independent-Product-Review-v0.1.md)。

## 1. 审计结论

两个仓库已经覆盖了本产品最难的几类基础问题，但它们解决的是不同层级的问题：

- `e-cut` 更强在内容研究、参考内容拆解、素材事实、类型化编辑操作和确定性剪辑执行；
- `Nomi` 更强在 Electron 本地运行时、模型目录、素材上传适配、异步生成任务、审批、预算和外部任务恢复。

两个仓库属于项目方自己的内部代码资产，因此本项目可以直接阅读、复用、迁移和重构其中的实现；这里真正需要控制的不是“有没有资格看代码”，而是迁移时的许可证、版权、依赖和领域边界。首轮可落地的组合是：

```text
e-cut 的内容/剪辑事实层
          +
Nomi 的桌面 Provider/任务安全层
          +
本项目自己的 Creator/Topic/Script/Storyboard/Asset/Review 领域层
```

最重要的架构判断：TikHub 和 APIMart 都不是业务层能力，它们只能作为 `Connector/Provider` 实现；用户的账号、选题、脚本、素材、剪辑计划和复盘必须保存在本地事实库中，不能把第三方响应当成产品数据模型。

## 2. 审计范围与安全边界

### 2.1 已检查的本地仓库

| 仓库 | 远程来源 | 当前观察 | 可用结论 |
|---|---|---|---|
| `e-cut` | `1251912798/EcCut` | 工作树存在用户未提交修改和未跟踪文件；远程分支已刷新 | 只读审阅，不重置、不清理、不覆盖现有工作 |
| `Nomi` | `aqm857886159/Nomi` | `main` 存在用户未提交修改和未跟踪文件；仓库含 `LICENSE` | 只读审阅；代码许可与本项目许可证需单独核验 |

两个仓库均能发现环境变量、Provider 配置或测试中的密钥接入路径。本审计不记录密钥值、不把密钥写入文档、不把密钥复制到本项目。APIMart 图片/视频生成通常是有成本的异步调用，TikHub 的数据调用也可能受额度和套餐约束；在没有单独确认测试范围、预算和脱敏 fixture 之前，不执行真实生成任务。

### 2.2 代码复用规则

1. 先确认每个源文件的许可证、版权声明和依赖许可证，再决定是复制、改写还是提取为共享包；这是为了保证未来完全开源时许可证链条清楚。
2. `Nomi` 当前为 AGPL-3.0；直接复制其代码到核心应用时，目标项目相应部分继续遵守 AGPL 的再发布义务。
3. `e-cut` 当前 checkout 未发现顶层 `LICENSE` 文件，需补齐仓库许可证事实后再决定哪些代码进入公共发行包；这不是阻止内部复用，而是避免未来发布时出现来源不明。
4. 复用优先级为：先复用已经验证的领域契约、状态机、测试和适配器；然后再迁移经过审计的小范围实现；UI、业务命名和 Provider 脚本按本项目边界重构。

## 3. 可直接继承的设计模式

### 3.1 Provider 目录与稳定模型键（来自 Nomi）

`Nomi/electron/catalog` 已把供应商、模型、能力档案和参数翻译分开：

- 用户选择稳定的 `modelKey`，APIMart 内部模型 ID 只出现在 Provider 配方中；
- 同一模型可以有文生图、改图、文生视频、图生视频等多个 capability/profile；
- 中性参数先进入统一请求，再由每个 Provider mapping 做字段翻译；
- 不支持的字段应显式 `drop` 或返回结构化错误，不能把任意参数原样透传给供应商。

这直接解决了 APIMart 模型字段不一致的问题。例如比例可能叫 `aspect_ratio` 或 `size`，清晰度可能叫 `resolution` 或 `mode`，图生视频可能使用数组 `image_urls`、字符串 `first_frame_image` 或带角色的参考图结构。我们的公共 UI 不应暴露这些供应商字段。

本项目应提取为：

```ts
type ProviderModel = {
  key: string;                 // 用户和项目文件使用的稳定键
  providerKey: string;         // tikhub/apimart/openai/local...
  capability: Capability[];   // text/image/video/audio/transcribe
  profiles: CapabilityProfile[];
  price?: PriceHint;
};

type GenerationRequest = {
  modelKey: string;
  capability: Capability;
  prompt?: string;
  inputs: AssetRef[];
  params: CanonicalGenerationParams;
};
```

### 3.2 本地素材到供应商可达素材的吞入策略（来自 Nomi）

`assetLocalization.ts` 是目前最适合抽象成公共 SDK 的部分。它将本地 `nomi-local://` 素材递归收集、去重，然后按供应商声明选择策略：

- `inline-base64`：适合小图片和本地模型；
- `upload-multipart`：适合 APIMart 图片上传等；
- `upload-stream`：适合视频/音频大文件；
- `upload-url`：适合供应商要求 JSON + base64 的接口；
- `comfyui-upload`：把素材放入本地 ComfyUI 的输入目录，返回节点可识别的文件名；
- `anon-chain`：多个匿名临时托管服务按顺序尝试。

应当继承的硬规则：

1. 先读本地文件内容类型，再决定上传通道，不能把视频误送到 image-only 上传接口。
2. 临时公网 URL 必须有信任窗；过期后重新上传。
3. 上传后的 URL/文件名只在 Provider 请求边界使用，不替换本地事实源。
4. 上传失败要给出明确原因；不能静默丢弃参考素材。
5. 一个请求中同一素材只上传一次，然后递归替换所有引用。

本项目会把它改名为 `AssetLocator + AssetTransport`，并将上传审计记录写入任务事件：素材 ID、目标 Provider、媒体类型、策略、过期时间和是否完成本地回收；不记录长期可复用的供应商密钥。

### 3.3 APIMart 异步任务与参数适配（来自 Nomi + e-cut 设计文档）

APIMart 当前接入路径已经验证出稳定的形状：

```text
POST /v1/images/generations 或 /v1/videos/generations
        ↓ data[0].task_id
GET  /v1/tasks/{task_id}
        ↓ data.status + data.result.images/videos
```

生产层需要统一为：

```text
queued → submitting → processing → succeeded
                         └──────→ failed/cancelled
```

并保留以下供应商信息：`providerTaskId`、原始状态、结果 URL、错误分类、第一次提交时间、最后轮询时间和 attempt。成品 URL 不能直接作为长期资产引用，必须下载到自己的媒体目录并生成 hash、探针信息和本地资产记录。

APIMart Provider 的职责应只有四件事：

1. 把中性请求转换为 APIMart body；
2. 发起创建和查询请求；
3. 将响应映射成统一状态/结果；
4. 将 HTTP、余额、权限、限流、任务失败映射为统一错误。

Provider 不应决定选题、选材、分镜或剪辑策略。

### 3.4 外部提交 outbox 与 `submission_unknown`（来自 Nomi）

生成/发布调用最大的风险不是“请求失败”，而是“请求已经成功，但客户端没有拿到回执”。Nomi 的 `submissionOutbox` 已实现了值得保留的事务边界：

```text
授权检查 → 预算预留 → 持久化提交意图 → submitting
       → provider_accepted(providerTaskId)
       → polling / downloading / validating
```

如果回执不确定：

- 标记 `submission_unknown`；
- 将预算标为 unsettled；
- 禁止盲目再次提交；
- 先使用 Provider 查询或人工确认进行 reconciliation。

这套机制不仅适用于 APIMart，也适用于未来的数字人、音色克隆、平台发布和云端转码。第一版即使不做复杂预算，也要保留 `idempotencyKey + attempt + providerTaskId + unknown receipt` 四个字段。

### 3.5 TikHub 薄适配器与证据归一（来自 e-cut）

`e-cut/apps/web/src/server/radar/tikhub.ts` 的方向正确：

- API key 只在服务端/环境变量边界读取；
- Base URL 可配置；
- 请求参数先用 Zod 限定合法范围；
- 设置超时；
- 对 HTTP 状态和供应商业务 `code` 双重判断；
- 通过单独的 `normalizeTikHubVideoList` 将复杂响应归一到 `RadarVideo`。

归一器采用候选字段和深层结构容错，能应对 TikHub 不同端点响应形状不完全一致的问题。但本项目不能只保存归一结果，还应保存：

```text
SourceEvidence {
  source: "tikhub";
  endpoint;
  fetchedAt;
  query;
  rawPayloadHash;
  normalizedRecord;
  confidence;
}
```

这样“某个选题为什么被推荐”才能回溯到具体样本和时间窗口。原始响应应按隐私和体积策略选择性保留，至少保留 hash、请求参数和可脱敏的字段快照。

### 3.6 类型化 Agent 编辑操作（来自 e-cut）

e-cut 的编辑 Agent 使用 Zod 约束增删、移动、裁剪、拆分、排序、音量、静音、可见性、播放头、范围选择、波纹删除、对齐和生成媒体等操作，并在破坏性动作前执行 `get_scene_state` 和 `preview_operations`。

本项目应保留这一层，但把它放在自有 `TimelineCommand` 上：

- Agent 只能调用注册过的命令；
- 命令必须带项目版本/场景版本；
- 破坏性命令先返回预览 diff；
- 每次应用产生可撤销事件；
- 不能让 Agent 直接写剪映草稿或直接改底层 JSON。

这也是 UI、内置 AI 和 MCP 共享能力的基础。

## 4. 不应直接继承的部分

### 4.1 e-cut 的业务假设

e-cut 的部分流程围绕电商爆款复刻、参考视频和商品素材。我们的首个工作流是抖音深度口播，领域对象要改为：

```text
CreatorProfile → BenchmarkAccount → TopicOpportunity
→ Script → Storyboard → ShootTask → Asset → EditProposal
→ Export → Publication → ReviewMemory
```

素材匹配的目标不是“复制参考视频”，而是为一句观点提供解释、举证、转场、情绪或节奏重置镜头。

### 4.2 Nomi 的自由脚本/custom call

`customCallContract` 提供了很强的供应商逃生口，但允许模型级自定义请求/轮询脚本后，安全面、供应商误调用和可复现性都会扩大。第一版不把任意脚本作为普通用户能力：

- 内置 Provider 使用编译期声明；
- 自定义 Provider 仅在开发者模式或沙箱进程中运行；
- 禁止任意 shell、文件系统遍历和未声明域名访问；
- 网络 host、上传类型和最大字节数需显式 allowlist；
- 每个脚本必须有 mock contract test。

### 4.3 当前密钥实现的改进点

Nomi 已使用 Electron `safeStorage`，并在不可用时回退到明文。对本项目而言，回退必须是明确的用户选择和风险提示，不能静默发生：

- 主进程持有明文 key，渲染进程只能拿到 `hasCredential`；
- 使用异步/封装后的密钥仓库，避免业务代码直接依赖 Electron API；
- key 不进入项目 JSON、日志、错误、telemetry、截图和导出包；
- API 调用日志只保留 provider、model、status、耗时、费用估计和脱敏错误；
- 项目迁移时不迁移 key，只迁移 credential reference。

## 5. 映射到本项目的目标包结构

```text
apps/desktop
  main/                 Electron 主进程、SQLite、文件系统、任务调度、密钥仓库
  renderer/             React 工作区和审核界面
  preload/              最小、版本化 IPC API

packages/domain
  creator/              CreatorProfile、账号、对标、内容支柱
  research/             TopicOpportunity、SourceEvidence、PatternFinding
  creation/             Script、Storyboard、ShootTask、Prompt
  media/                Asset、Tag、Transcript、Rights、Derivative
  editing/              EditProposal、FrozenEditSpec、RenderIR、AlignmentReport
  publishing/           Publication、MetricSnapshot、ReviewMemory

packages/provider-contracts
  provider.ts           Provider/Model/Capability/Health
  generation.ts         统一文本/图片/视频/音频请求和状态
  ingestion.ts          AssetLocator/AssetTransport
  connector.ts          TikHub/平台连接器接口

packages/provider-gateway
  router.ts              稳定 modelKey → Provider mapping
  jobs.ts                submit/poll/download/validate
  outbox.ts              idempotency、预算、未知回执、对账
  errors.ts              统一错误分类和重试策略

packages/media
  ingest.ts              ffprobe、代理、缩略图、波形、hash
  understand.ts          ASR、OCR、镜头切分、标签和向量索引
  retrieval.ts           FTS5 + 可替换向量索引 + 结构化过滤

packages/agent-tools
  registry.ts            UI/Agent/MCP 共用 Tool/Command 注册表
  timeline.ts            可逆、可预览、版本化编辑命令

packages/exchange
  mp4.ts                 FFmpeg 确定性输出
  fcpxml.ts              FCPXML 交换
  jianying/              独立、版本化的剪映草稿适配器
  package.ts             素材、字幕、时间线、manifest 的交付包
```

## 6. 对剪映和交换格式的边界

两个仓库都支持“自有事实源 + 外部编辑器/渲染器”的方向。本项目应明确：

1. 内部时间线以 `RenderIR` 为事实，不直接以剪映私有 JSON 为事实。
2. 第一版稳定交付 `MP4 + SRT/VTT + 素材包 + RenderManifest`。
3. FCPXML 作为公开交换格式，先做受限轨道/字幕/基础音频映射。
4. 剪映草稿作为独立 adapter；按操作系统、应用版本和编码器建立 fixture 矩阵。
5. 未经真实导入验证，不承诺“可编辑草稿 100% 还原”。私有草稿格式的加密、版本字段和资源路径必须视为不稳定实现细节。

## 7. 许可证和开源落地

当前产品方向仍采用分层许可证：

- 核心桌面端、领域模型、素材库、工作流、RenderIR、第一方适配器：`AGPL-3.0-only`；
- Provider/Connector SDK、公共 schema、CLI 和可独立复用的协议包：`Apache-2.0`；
- 文档和示例按内容类型使用 `CC BY-SA` 或 `CC0`；
- 第三方模型、API、字体、音效、素材和剪映格式的使用条款独立处理。

该策略允许我们完全开源软件，同时保留公共协议层被其他项目复用的空间。它不意味着可以直接复制 Nomi/e-cut 的代码；复用仍以每个文件的许可证和版权声明为准。

## 8. 下一轮技术验证，不使用真实付费调用

### P0：本地 mock 合同测试

1. APIMart image/video `create → poll → result` 的响应 fixture、状态映射和错误映射；
2. 本地图片/视频/音频分别走 `AssetTransport`，验证 URL 过期、重复素材去重和媒体类型路由；
3. TikHub 多种响应形状归一为 `BenchmarkVideo`，缺字段不能导致整批数据静默消失；
4. `submission_unknown` 恢复后禁止重复提交，只有对账成功才能继续；
5. `FrozenEditSpec → RenderIR` 结果可重复，LLM 不出现在执行热路径；
6. Agent timeline command 的版本冲突、预览、撤销和幂等。

### P1：脱敏最小在线验证（需单独确认）

只做不产生内容或低成本的验证，例如供应商健康检查、鉴权失败码/额度状态读取、文档所允许的 dry-run。禁止用真实图片、视频、音频或用户账号数据直接上传。

### P2：真实端到端验证（需明确授权和预算）

在用户确认单次预算、素材范围、保存位置和清理策略后，才执行一个最小 APIMart 任务、一个 TikHub 查询和一个下载回收闭环；结果进入隔离 fixture，不进入正式产品数据。

## 9. 本轮建议确认的三件事

1. 是否同意把两个仓库定位为“内部参考实现”，首轮采用 clean-room 重新实现，不直接复制未确认许可的代码？
2. 是否同意下一步先完成 P0 mock 合同测试和领域模型草案，再做真实 key 的最小联调？
3. 真实联调时，APIMart 和 TikHub 的单次预算/额度上限、测试素材类型、结果保留时长由谁确认？

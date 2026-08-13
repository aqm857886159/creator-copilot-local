# 本地内容创作助手：独立产品评审 v0.1

版本：v0.1  
日期：2026-08-13  
状态：反方评审与调研结论；用于调整 PRD、领域模型和技术验证顺序

## 0. 评审声明

本文件不把当前方案当作既定答案，而是主动寻找：

- 我们是不是把用户真正愿意持续使用的结果定义错了；
- 哪些能力被低估，尤其是拍摄交接、素材权利、导出兼容和恢复；
- 哪些“AI 能力”只是演示上成立，不能成为产品承诺；
- 哪些成熟产品和开源项目已经验证了可复用的边界；
- 哪些当前文档需要降级为实验、改成可选能力，或补充领域对象。

结论中的“事实”来自产品官方文档、开源仓库或本地内部仓库；“推断”是基于这些事实对本项目的判断；“建议”是需要产品决策或实验验证的动作。

## 1. 执行摘要

### 1.1 总体结论：方向成立，但当前产品承诺仍然过宽

产品最有机会的部分不是“再做一个 AI 剪辑器”，而是：

> 把一个真人创作者的观点，变成可拍的画面计划；把拍完的多条口播和个人素材，变成一个可审阅、可修改、可交付的粗剪工程。

这条价值链比“账号分析、热点、脚本、数字人、音色克隆、多平台分发全部打通”更容易形成真实闭环，也保留未来扩展空间。

当前最需要调整的不是继续增加功能，而是收紧五条产品承诺：

1. 首个闭环应聚焦“观点 → 分镜/拍摄包 → 多条素材导入 → B-roll 粗剪提案 → 可交付工程”，研究和发布先作为支撑能力；
2. 桌面端不能只生成拍摄任务，还要生成手机可打开的拍摄包、二维码或可分享清单；不控制设备，但必须完成跨设备交接；
3. 自有工程格式是唯一事实源，FCPXML/OTIO/媒体包是正式交换出口；剪映/CapCut 草稿只能作为版本化、实验性的适配器；
4. 脚本个性化不能只靠五到十个样本和一个 VoiceProfile，要按场景区分“内容立场、思考方法、口语表达”，用用户采用/拒绝的偏好对持续校准；
5. 发布、多平台分发、数字人和音色克隆必须后置，且每个能力都要有独立授权、成本和风险门，不得被“全流程”叙事提前承诺。

### 1.2 当前方案中最危险的两个假设

**假设 A：可以把剪映/CapCut 项目作为稳定输出格式。**

CapCut 官方帮助中心明确表示目前不支持从第三方剪辑软件直接导入/导出项目文件；公开的草稿逆向项目依赖私有 draft_content.json，且不同版本存在加密、字段变化和“内容已损坏”风险。这个方向可以做，但不能进入核心交付承诺。

**假设 B：五到十条样本就能稳定复刻一个人的非正式表达。**

2025 年 EMNLP Findings 的大规模评测显示，当前 LLM 对日常作者隐含写作风格的模仿仍然困难，尤其是博客、论坛等非正式文本；样本数量和提示策略并不能稳定解决问题。我们的 VoiceProfile 设计是正确方向，但必须把“像本人”当作待评测能力，而不是已解决能力。

## 2. 现有方案的优点

### 2.1 架构边界是对的

- 本地事实源、Provider 适配器、FrozenEditSpec、RenderIR 和可追溯事件，避免把云端响应直接当产品数据；
- AI 先提案、用户审阅、冻结后确定性执行，符合可恢复和可解释要求；
- VoiceProfile、ThoughtPlan、SpokenEdit、AuthenticityPass 已经把脚本“像本人”和“去 AI 味”从一个 Prompt 拆成了可测试链路；
- A 方案不控制手机/相机，避免把桌面软件变成不可靠的硬件控制器；
- AGPL 核心 + 可复用协议/SDK 包的许可证方向与本地开源目标一致，但仍需完成依赖和素材许可证矩阵。

### 2.2 内部项目已经提供了重要的“肩膀”

**e-cut：**

- 已有内容研究、素材事实、剪辑操作、媒体处理和真实用户任务复测；
- 创作工作流审查明确区分用户阶段与内部异步状态，并要求失败恢复、历史只读和质量门；
- AI 剪辑执行契约已经把 DraftEditSpec、FrozenEditSpec、ResolvedEditSpec 和 RenderIR 分开；
- 素材库方案和真实测试包适合直接拿来做本项目的检索、镜头覆盖和导出 fixture。

**Nomi：**

- 已有 Electron 本地运行时、Provider catalog、模型参数翻译、媒体上传、异步任务恢复和预算/授权机制；
- Production Run 采用单一事实、命令幂等、revision CAS、提交未知状态和 durable approval；
- MCP 审计明确禁止外部 Agent 直接批准预算、导出、发布、删除或覆盖；
- Provider 接入纪律要求结构化 sources、逐项核对端点/参数/上限/状态机，不允许把猜测写成契约。

本项目不应重新发明这几套基础设施，而应把它们合并到本项目自己的 Creator、Topic、Script、Storyboard、Asset 和 Review 领域层。

## 3. 竞品与开源项目研究

### 3.1 Descript：文本、场景和时间线必须互相联动

官方编辑器文档把工作区拆成 Script editor、Scene editor、Timeline、Sidebar；文本编辑可以直接改转写和媒体，场景负责视觉层，时间线负责精确时序。官方产品页也强调用文字稿删除、重排内容，媒体同步变化。

**可借鉴：**

- 脚本不是一次性生成结果，而是与 ASR、场景和时间线共用稳定 span；
- 口播创作者需要“文字视图 + 画面视图 + 时间线视图”，但三者不能存三份互相漂移的文本；
- AI 操作应以“删停顿、改本段、插入 B-roll、重排场景”等局部命令出现。

**不能照搬：**

- Descript 面向录音/播客/访谈的文本编辑优势，不能替代我们的分镜、素材权利和拍摄任务；
- 我们不应把“能编辑文字”误认为已经解决“深度观点如何变成更有画面的内容”。

来源：[Descript 编辑器界面](https://help.descript.com/hc/en-us/articles/37585546799757-The-editor-interface)、[Descript 视频编辑](https://www-staging.descript.com/video-editing)。

### 3.2 Captions：拍摄、提词器和后期必须形成跨设备闭环

Captions 的官方说明把提词器、录制、眼神修正、自动字幕、B-roll 和 AI 编辑放在同一产品中；提词器目前主要在移动端，录完后可以继续在编辑器中处理。这正好暴露了我们当前方案的盲点：用户通常在手机或相机前拍摄，而不是在桌面软件里完成任务。

**可借鉴：**

- 拍摄任务不能只是桌面上的一张清单，必须有手机可读、可逐镜完成的版本；
- 任务要携带目标时长、台词/提示词、画面目的、拍法、拍摄状态和重新拍摄入口；
- 提词器与脚本应共享版本，不能让用户复制粘贴后产生两个事实源。

**不能照搬：**

- 眼神修正、数字人和移动端全量录制是高风险能力，不是本项目第一阶段必须解决的问题；
- 我们的核心不是替创作者“读得像”，而是帮助他先想清楚并拍出足够的画面证据。

来源：[Captions AI Teleprompter](https://captions.ai/features/ai-teleprompter)。

### 3.3 OpusClip：结果页、约束输入和交付桥接比“全自动”更重要

OpusClip 官方文档提供多模态 ClipAnything、品牌模板、视频时长/画幅/片段数量/提示词约束、文本和时间线编辑、B-roll、发布以及 XML 导出到 Premiere/DaVinci 的链路。

**可借鉴：**

- AI 处理结果应先以可比较的候选列表呈现，再进入局部编辑；
- 品牌模板、画幅、时长、字幕和发布目标应是结构化约束，而不是每次写在 Prompt 里；
- 导出桥接的价值在于把“粗剪提案”带到专业工具，而不是假装替代专业工具。

**不能照搬：**

- OpusClip 的主问题是长视频切短片，不等于深度口播的观点拆解和补拍；
- 自动选“爆点”不能替代我们对论证、证据和画面目的的建模。

来源：[OpusClip 官方介绍](https://help.opus.pro/docs/article/introduction-to-opusclip)。

### 3.4 Palmier Pro：AI 应进入编辑器核心，但它不是本项目的跨平台底座

Palmier Pro 是 Swift 原生、macOS 26/Apple Silicon 专用的视频编辑器。公开源码把 Agent、MCP、Editor、Compositing、Timeline、Transcription、Project、Export 和 Generation 分成明确模块；编辑层存在 Undo、Ripple、Overwrite，时间线有 Snap、Multicam 和 AI Edit 菜单，导出层包含队列、FCPXML、项目包和 HDR。它让内置 Agent 与外部 Claude/Codex/Cursor 通过 MCP 操作同一工程，说明“AI 不是旁边的聊天框，而是编辑器命令调用方”这一方向成立。[Palmier Pro 仓库](https://github.com/palmier-io/palmier-pro)

**应重点参考：**

- Project package、timeline model、undo/ripple/overwrite 和 export queue 的边界；
- Agent Tools 与 MCP 使用同一工程命令，而不是另存一套 AI JSON；
- FCPXML/项目包作为明确导出模块，不与生成 Provider 混在一起；
- 转写、媒体缓存、预览、合成和导出是独立性能域。

**不应直接采用：**

- 它只支持最新 macOS 和 Apple Silicon，与我们的 Windows/macOS 双平台目标冲突；
- Swift/Metal 原生栈无法直接复用 e-cut/Nomi 的 Electron/TypeScript 资产；
- 仓库说明生成式 AI 处理部分闭源并需要登录订阅，所以不能把它当作开源 Provider 实现来源；
- GPLv3 代码如需迁移到 AGPL 核心，仍要逐文件核对许可证、版权和组合发布方式，架构借鉴不等于直接复制。

结论：Palmier 最值得研究的是编辑器核心和 Agent 接口的分层，不是拿它替换当前技术栈。

### 3.5 OpenChatCut：Agent 必须写入真实工程，但所有副作用都要过门

OpenChatCut 的公开文档明确强调本地工程、多轨时间线、词级转写、素材/生成、FCPXML/工程导出、内置 Agent 与外部 MCP 共用同一工具面。它的编辑会话先把操作写进隔离草稿，之后由用户审阅并应用；生成、导出、删除等不可逆副作用不放进可回滚的编辑会话。

**应直接吸收：**

- UI Agent 和外部 MCP 共享同一套 EditorCore 命令；
- 编辑提案进入隔离草稿，应用时形成一个可撤销节点；
- 读取/规划、编辑提案、付费生成、导出、发布、删除必须是不同权限层；
- MCP 输出应是安全投影，不泄露绝对路径、Provider URL、任务 ID、Prompt 或密钥。

来源：[OpenChatCut 中文 README](https://github.com/0xsline/OpenChatCut/blob/main/README_ZH.md)。

### 3.6 OpenCut：值得参考的长期架构，不应作为当前依赖

OpenCut 当前重写方向包括 Rust 核心、Editor API、插件优先、桌面/移动/Web 共用、MCP、无头批渲染和脚本标签页；同时它公开说明重写仍在架构阶段，经典版才是当前可用版本。

**评审结论：**

- 这证明“编辑器核心 + API + MCP + headless render”是有吸引力的长期形态；
- 但我们不应直接把尚在重写中的 OpenCut 当运行时依赖；
- 当前应从 e-cut/Nomi/OpenChatCut 已验证的命令、状态和测试中抽取最小 EditorCore，再保留未来迁移到 Rust 的边界。

来源：[OpenCut GitHub](https://github.com/OpenCut-app/OpenCut)。

### 3.7 剪映/CapCut 草稿生态：可研究，不能当稳定协议

公开的 capcut-cli、pyJianYingDraft 和其他工具说明了 draft_content.json 的结构：materials、tracks、segments、texts、effects 和 transitions 互相引用，确实可以程序化生成草稿。但同一批公开资料也说明了：

- CapCut 官方不承诺第三方项目交换；
- 草稿字段和枚举随版本变化；
- 剪映/CapCut 新版本存在加密或打开后“内容已损坏”；
- 文本内容是 JSON-in-JSON，部分范围使用 UTF-16 偏移，手写修改很容易破坏草稿；
- 即使草稿能打开，字体、贴纸、特效、模板和资源 ID 也不一定存在于用户机器。

**正式调整：**

1. 正式出口：MP4、SRT/VTT、媒体包、RenderManifest、FCPXML/OTIO；
2. 实验出口：JianyingDraft/CapCut draft，必须记录 app/version、能力覆盖和 LossReport；
3. 任何私有草稿适配器都不能成为事实源，也不能作为“支持剪映编辑”的无条件承诺；
4. 每个版本先做导入/打开/替换素材/字幕/特效/导出矩阵，再决定是否对用户展示。

来源：[CapCut 官方第三方项目交换说明](https://www.capcut.com/help/how-to-export-pro-project)、[CapCut/剪映草稿 schema 资料](https://gist.github.com/renezander030/80823f1d47081c312d2c1f9edd20dc22)、[capcut-cli](https://github.com/renezander030/capcut-cli)、[pyJianYingDraft](https://github.com/h-k-c/pyJianYingDraft-main)。

### 3.8 OpenTimelineIO：作为交换边界，而不是业务数据库

OpenTimelineIO 的官方仓库将 FCPXML、AAF、EDL 等适配器作为可版本化插件维护；核心对象适合描述时间线和媒体引用，但不承载我们自己的账号、脚本、素材语义、权利和复盘事实。

**建议：**

- 内部保持自己的 RenderIR/FrozenEditSpec；
- 通过 OTIO/FCPXML 适配器输出通用时间线；
- 适配器版本、舍入算法、素材路径策略和缺失媒体策略必须写入 manifest；
- 不把 OTIO 当作用户项目的唯一保存格式。

来源：[OpenTimelineIO 官方仓库与适配器说明](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/releases)。

## 4. 关键盲点与严重性

### P0：拍摄任务没有真正跨设备完成

当前 ShootTask 只描述了“要拍什么”，但没有定义：

- 手机端或可分享的任务载体；
- 多次 Take、选中最佳 Take、重拍原因；
- 拍摄完成后如何回传任务上下文；
- 竖屏、可变帧率、外接麦克风、音画不同步和文件重复导入；
- 一次拍摄任务与多个 Asset/AssetSegment 的关系。

**调整：**

- 新增 Recording/Take 领域对象；
- ShootTask 支持导出轻量拍摄包：HTML/二维码/图片清单/提词文本；
- 导入时支持按任务、文件名、时间窗口和用户选择关联；
- 一个 ShootTask 可以有多个 Take，只有用户选定的 Take 才进入剪辑提案；
- 第一阶段不做手机原生 App，但必须验证“桌面生成任务 → 手机查看/拍摄 → 回到桌面导入”的闭环。

### P0：剪映桥接被错误地写成确定性交付

这是当前文档最需要降级的承诺。FCPXML/OTIO/媒体包应是保底交付，剪映草稿适配器只能实验化、版本化和可失败。

**调整：**

- PRD 的“首个外部编辑器”改成“剪映桥接实验”；正式出口改成通用交换包；
- 每次生成桥接包时输出 Capability/Loss report；
- 只在已验证版本和已覆盖字段内显示“可尝试导入”，不显示“支持剪映工程”。

### P0：账号分析和发布依赖的不是同一类 API

TikHub 是非官方社交数据基础设施，官方文档提示有权限、余额、限速和接口变化；其条款也说明它与 TikTok/ByteDance 无隶属关系，最终数据使用责任在用户。TikTok 官方 Content Posting API 则需要应用审核、video.publish 权限和用户授权，未审核客户端发布内容受私密可见限制。

**调整：**

- TikHub Connector 只负责研究证据和公开数据快照，不默认等于“账号登录”或“发布能力”；
- 发布 Connector 必须单独设计，第一阶段默认为导出和手动发布；
- 研究数据保存来源、抓取时间、过期时间、查询和原始响应 hash；
- 任何平台连接器都要有手动导入降级路径，不能让主创作闭环被平台接口阻断。

来源：[TikHub API docs](https://docs.tikhub.io/)、[TikHub Terms](https://docs.tikhub.io/5508540m0)、[TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started?enter_method=left_navigation)。

### P1：素材库有标签，但缺少“使用决策模型”

标签和向量搜索只能回答“这是什么”，不能直接回答：

- 这个镜头是否适合证明当前观点；
- 是否已经被其他项目占用；
- 是否有版权/肖像/品牌限制；
- 是否满足画幅、清晰度、连续性和声音要求；
- 为什么它被推荐、用户为什么拒绝。

**调整：**

- 资产和镜头区间增加 rights、provenance、usage history、quality flags；
- AssetCandidate 必须返回“匹配原因 + 不适合原因 + 风险”；
- 保存用户采用/拒绝/替换记录，作为检索重排信号；
- 检索评测用 Top-3 命中、MRR、延迟、费用、人工修正率和最终采用率，不只看 embedding 相似度；
- 对口播 B-roll 增加 visual role：proof、example、context、emotion、transition、reset，避免把画面密度误当装饰数量。

### P1：没有 Recording/Take，素材与拍摄任务会断链

当前 Asset/AssetSegment 关系不足以表达“我拍了三遍，第二遍最好，第三遍只补了一个词”。没有 Take 层，系统无法解释重录、最佳片段、同步和剪辑选择。

建议新增：

~~~ts
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
~~~

### P1：工作区结构可能过于线性

研究、创作、制作、复盘适合作为项目阶段，但创作者日常会跳转：

- 先从素材库找一个镜头；
- 回到旧稿复制表达；
- 从复盘打开一个表现好的 Hook；
- 再回到当前项目改分镜。

**建议：**

- 保留阶段模型用于进度和恢复；
- 主入口增加 Project Home/Inbox，显示当前项目、待处理异常和最近资产；
- 研究、素材库、表达档案和复盘记忆应是可从任何项目调用的全局资料，不要让用户每次重新走一遍线性流程。

### P1：复盘记忆容易把相关性误当因果

一个视频表现好，可能是题材、发布时间、账号状态、平台分发、封面或偶然事件共同造成。不能根据一条结果自动生成“以后都这样做”的长期规则。

**调整：**

- ReviewMemory 必须记录样本量、时间窗口、平台、对照组和置信度；
- 单条发布只生成候选记忆，不自动升格为 confirmed；
- “经验”与“实验”分开：保留假设、变量、结果和下一次验证动作；
- 复盘输出应回答“哪些因素值得再次测试”，而不是“算法已经知道答案”。

### P1：个人表达档案容易过拟合或把引用当本人

历史视频的 ASR 可能包含口误、剪辑后的句子、引用他人、嘉宾声音和平台字幕。五到十条样本只是启动校准，不是稳定模型。

**调整：**

- VoiceProfile 拆成通用表达层、场景表达层和边界层；
- 任何样本可标记为原创、引用、转述、合作发言或不纳入；
- 用采用/拒绝对和真实录制反馈持续更新；
- 用盲评、重写率、录制卡顿和个人经历编造率评测，不使用单一 AI 检测分数；
- 允许用户选择“这次更像我讲专业内容的方式”，而不是只有一个全局人格。

研究依据：[EMNLP 2025 日常作者风格模仿评测](https://aclanthology.org/2025.findings-emnlp.532/)、[ACL 2025 Personalized Text Generation with Contrastive Activation Steering](https://aclanthology.org/2025.acl-long.353/)。

### P2：发布、多平台分发、音色克隆和数字人被提前放进主叙事

这些能力都能做，但每个能力都有不同的授权、内容标识、平台审核、成本和安全边界。它们不应和“素材组织 + 口播粗剪”共用一个模糊的“AI 能力”入口。

建议按四个独立扩展包管理：

- Publishing connectors：账号授权、隐私级别、审核、失败恢复；
- Voice/audio：音色授权、声纹数据、合成标识、撤销和水印；
- Avatar/video identity：肖像授权、合成标识、内容审核；
- Distribution analytics：指标定义、平台口径、时区和数据保留。

## 5. 对当前 PRD 的建议改动

### 5.1 把首个闭环改成“口播生产闭环”

推荐的首条用户任务：

~~~text
输入一个观点或选题
  → 生成并确认 ThoughtPlan
  → 生成结构化脚本和提词视图
  → 生成有画面目的的分镜
  → 生成手机可执行的拍摄包
  → 导入多条 Take 和已有素材
  → 召回/补拍/替换镜头
  → 生成可解释的粗剪提案
  → 用户确认并输出 MP4/SRT/媒体包/FCPXML/OTIO
~~~

账号对标、热点、发布和复盘仍保留为通用内核，但不应该阻断这条本地生产闭环。

### 5.2 将剪映出口拆成三档

| 档位 | 用户承诺 | 技术要求 |
|---|---|---|
| A | 通用交付包，稳定可复现 | MP4、SRT/VTT、RenderManifest、素材包、FCPXML/OTIO |
| B | 已验证版本的剪映/CapCut 草稿 | 版本矩阵、字段覆盖、打开/导出回归、LossReport |
| C | 未验证版本的实验适配 | 开发者设置或高级导出中显示，失败不影响主流程 |

### 5.3 将“多平台发布”改为连接器能力，不作为第一阶段结果

第一阶段默认输出本地文件和发布包；之后分别接入 TikTok/Douyin/YouTube/Bilibili 等连接器。每个连接器必须拥有自己的 auth、scope、quota、privacy、publish status 和 retry contract。

## 6. 必须做的验证实验

### 实验 A：拍摄交接

- 5 位真人口播创作者；
- 每人 1 个 60–90 秒观点；
- 桌面生成分镜和手机可读拍摄包；
- 创作者用自己的手机拍摄 3–5 个 Take；
- 回到桌面导入、自动关联、选择最佳 Take。

通过标准：用户不需要重新理解镜头编号；能够在两分钟内找到下一镜、知道拍几秒、知道拍法，并能在导入后修正错误关联。

### 实验 B：脚本个性化

- 每位创作者提供 10 条历史样本、3 条“我不会这样说”的样本；
- 同一 ThoughtPlan 生成三个版本：通用稿、VoiceProfile 稿、用户改写稿；
- 由创作者本人和不了解生成过程的评审做盲选；
- 记录采用率、手动重写率、录制卡顿、事实错误和个人经历编造。

通过标准：不以“AI 检测器分数”作为唯一门槛；至少证明 VoiceProfile 版本相对通用稿能减少用户修改，且不增加事实和立场错误。

### 实验 C：素材检索与画面有效性

- 30–50 条真实口播/B-roll 素材；
- 20 个带画面目的的镜头查询；
- 比较关键词、FTS、embedding、VLM 重排和用户反馈重排；
- 记录 Top-3、MRR、延迟、费用、人工修正率和最终采用率。

通过标准：候选不仅“看起来相关”，还要能解释为什么适合当前观点和画面角色。

### 实验 D：剪映/CapCut 兼容

- 先冻结 3 个目标应用版本和 macOS/Windows 组合；
- 对每个版本测试导入、打开、素材替换、字幕、基础转场、字体缺失、导出和重新打开；
- 记录每个字段的覆盖率和失败类型；
- 将失败结果进入 LossReport，不允许人工“这次能打开”代替回归。

通过标准：如果无法建立稳定矩阵，就把剪映桥接明确降为 C 档实验出口。

### 实验 E：发布与数据回流

- 先用手动发布包验证标题、封面、字幕、隐私级别和素材权利；
- 再申请/验证官方平台授权；
- 对未审核、token 过期、上传中断、隐私级别和重复发布分别测试；
- 对比平台快照和本地记录，确认时间、指标口径和证据来源。

## 7. 建议的评审后路线

### 必须先补的 P0

1. Recording/Take 与手机拍摄包；
2. 通用交付包和剪映实验适配器分层；
3. Provider/TikHub/发布连接器的授权、成本、过期和恢复边界；
4. 项目级单一事实与 Agent 提案/审批门；
5. 真实样本评测 fixture，而不是先做功能数量。

### 可以随后做的 P1

1. 资产权利、来源、使用历史和负反馈重排；
2. Project Home/Inbox 与全局素材/表达档案；
3. ThoughtPlan/VoiceProfile 的场景化和偏好对；
4. ReviewMemory 的实验和因果标记；
5. FCPXML/OTIO 的可逆导出和对账报告。

### 明确后置的 P2

1. 多平台自动发布；
2. 音色克隆；
3. 数字人；
4. 大规模 AIGC B-roll；
5. 社区模板、素材生态和团队协作。

## 8. 评审后的产品定义

推荐把产品定义改成：

> 一个本地优先的真人内容生产工作台：帮助创作者把自己的观点和表达，组织成可拍的分镜与拍摄包，再把真实拍摄素材和个人素材库，变成可审阅、可修改、可导出的粗剪工程。

这一定义仍然通用，因为账号、选题、表达档案、素材、时间线、发布和复盘都是通用内核；但首个产品结果非常具体，用户能够判断“今天有没有帮我完成一条视频”。

## 9. 证据与来源

### 官方产品和平台

- [Descript 编辑器界面](https://help.descript.com/hc/en-us/articles/37585546799757-The-editor-interface)
- [Captions AI Teleprompter](https://captions.ai/features/ai-teleprompter)
- [OpusClip 官方介绍](https://help.opus.pro/docs/article/introduction-to-opusclip)
- [CapCut 官方第三方项目交换说明](https://www.capcut.com/help/how-to-export-pro-project)
- [TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started?enter_method=left_navigation)
- [TikHub API 文档](https://docs.tikhub.io/)
- [TikHub Terms of Use](https://docs.tikhub.io/5508540m0)
- [OpenTimelineIO releases and adapters](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/releases)

### 开源项目和格式研究

- [Palmier Pro](https://github.com/palmier-io/palmier-pro)
- [OpenChatCut](https://github.com/0xsline/OpenChatCut/blob/main/README_ZH.md)
- [OpenCut](https://github.com/OpenCut-app/OpenCut)
- [capcut-cli](https://github.com/renezander030/capcut-cli)
- [pyJianYingDraft](https://github.com/h-k-c/pyJianYingDraft-main)
- [CapCut/剪映 draft schema 资料](https://gist.github.com/renezander030/80823f1d47081c312d2c1f9edd20dc22)

### 学术研究

- [Catch Me If You Can? Not Yet: LLMs Still Struggle to Imitate the Implicit Writing Styles of Everyday Authors](https://aclanthology.org/2025.findings-emnlp.532/)
- [Personalized Text Generation with Contrastive Activation Steering](https://aclanthology.org/2025.acl-long.353/)
- [Text-based Editing of Talking-head Video](https://arxiv.org/abs/1906.01524)
- [Context-Aware Talking-Head Video Editing](https://arxiv.org/abs/2308.00462)

### 本地内部肩膀

- `/Users/aoqimin/Desktop/e-cut/docs/eccut-creation-workflow-prd.md`
- `/Users/aoqimin/Desktop/e-cut/docs/ai-edit-execution-contract-alignment.md`
- `/Users/aoqimin/Desktop/e-cut/docs/qa/frictionless-creation-v2-final-user-task-review.md`
- `/Users/aoqimin/Desktop/e-cut/EcCut-素材库方案-v1.1.md`
- `/Users/aoqimin/Desktop/Nomi/docs/superpowers/specs/2026-08-08-agentic-production-experience-design.md`
- `/Users/aoqimin/Desktop/Nomi/docs/plan/2026-08-08-production-run-foundation.md`
- `/Users/aoqimin/Desktop/Nomi/docs/audit/2026-08-09-production-mcp-adversarial-review.md`
- `/Users/aoqimin/Desktop/Nomi/docs/plan/2026-08-12-provider-integration-discipline.md`

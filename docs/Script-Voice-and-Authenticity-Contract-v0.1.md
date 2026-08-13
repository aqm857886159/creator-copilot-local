# 脚本表达档案与去 AI 味契约 v0.1

版本：v0.1  
日期：2026-08-13  
状态：脚本模块设计补充，适用于 PRD v0.2 和领域模型 v0.1

## 1. 产品判断

脚本模块的目标不是“生成一篇语言流畅的文章”，而是：

> 让系统先理解创作者平时怎么想、怎么组织观点、怎么说话，再把新的内容写成他愿意讲、也讲得出来的话。

需要同时解决两个问题：

1. 表达贴合：语气、句式、节奏、用词、论证方式和情绪接近创作者本人；
2. 降低 AI 味：避免模板化开头、均匀排比、空泛总结、过度完整和没有真实立场的表达。

两者不能靠一个“更像人”的 prompt 解决，必须有可持续积累的个人表达档案、可引用的真实样本和生成后的审校环节。

## 2. “像他”到底包括什么

不能只提取口头禅。个人风格至少分四层：

### 2.1 表层表达

- 常用词、连接词和口头语；
- 句子长度和长短变化；
- 语气强弱、停顿和重复；
- 常用比喻、例子和类比；
- 开头、转折、收束的习惯；
- 适合口播的词和不容易说出口的词。

### 2.2 论证结构

- 先讲结论还是先讲故事；
- 如何定义问题；
- 如何拆解概念；
- 如何使用案例、数据和反例；
- 是否喜欢先承认常见观点再反驳；
- 如何从抽象观点落到具体行动；
- 结尾是总结、追问、判断还是留白。

### 2.3 思考方式

- 关注因果、机制、利益、时间和约束中的哪些；
- 喜欢从哪个角度质疑常识；
- 对证据的要求；
- 如何区分事实、推测和价值判断；
- 什么情况下会改变观点；
- 对复杂问题的默认简化方式。

### 2.4 个人边界

- 不愿说的词和观点；
- 不愿冒充的经历；
- 不能未经确认生成的事实、数字和案例；
- 对争议话题的风险边界；
- 可以使用的个人经历、专业经历和素材来源。

系统要把这四层分开存储，不能把全部内容压成一个“风格描述”。

## 3. 个人表达素材的来源

用户可以显式选择用于建立表达档案的来源：

- 已发布的视频及 ASR 转写；
- 用户导入的旧脚本、文章和笔记；
- 用户自己录制的 3–5 分钟自由表达；
- 用户在软件内修改和采用过的脚本；
- 用户标记为“这就是我会说的话”的句子；
- 用户拒绝或改写 AI 生成内容时留下的差异。

默认不把整个电脑文件夹或所有聊天记录自动拿来训练。每个样本都保存来源、时间、范围和是否允许用于后续生成。

### 3.1 素材清洗

原始素材进入档案前先做：

1. ASR/OCR 或文本导入；
2. 去除明显的标题、字幕模板和平台文案；
3. 按句子、段落和完整观点切分；
4. 标记录音口误、临时改口和被用户删除的部分；
5. 区分“本人原创表达”和“引用/转述他人内容”；
6. 用户确认是否纳入表达档案。

不要把 ASR 错字、平台标题和剪辑字幕误当成创作者的语言习惯。

## 4. VoiceProfile 数据契约

~~~ts
type VoiceProfile = {
  id: string;
  workspaceId: string;
  creatorProfileId: string;
  revision: number;
  status: "draft" | "calibrating" | "active" | "paused" | "archived";
  language: "zh-CN" | "zh-TW" | "en" | "mixed";
  surfaceStyle: SurfaceStyle;
  thinkingPattern: ThinkingPattern;
  speechPattern: SpeechPattern;
  boundaryRules: BoundaryRule[];
  approvedSampleIds: string[];
  rejectedSampleIds: string[];
  sourceSampleCount: number;
  confidence: number;
  updatedAt: string;
};

type SurfaceStyle = {
  preferredWords: string[];
  avoidedWords: string[];
  connectors: string[];
  sentenceLength: { short: number; medium: number; long: number };
  rhythm: "fast" | "measured" | "variable" | "unknown";
  rhetoricalDevices: string[];
  openingPatterns: string[];
  closingPatterns: string[];
};

type ThinkingPattern = {
  problemFrames: string[];
  reasoningMoves: string[];
  evidencePreferences: string[];
  counterpointHabits: string[];
  abstractionLevel: "concrete" | "mixed" | "abstract";
  defaultStance: "questioning" | "analytical" | "provocative" | "empathetic" | "mixed";
  recurringLenses: string[];
};

type SpeechPattern = {
  pausePreference: "low" | "medium" | "high";
  fillerWords: string[];
  emphasisPatterns: string[];
  difficultWords: string[];
  preferredBreathGroupMs?: number;
};

type BoundaryRule = {
  kind: "forbidden_claim" | "requires_source" | "personal_experience" | "sensitive_topic" | "voice_exception";
  rule: string;
  severity: "warn" | "block";
  evidenceIds?: string[];
};
~~~

VoiceProfile 是版本化对象。每次用户确认新的表达样本、修改风格或改变边界，都生成新 revision，不覆盖旧版本。

## 5. 生成前的思维建模

脚本生成不应该直接把题目丢给大模型。先生成一份 ThoughtPlan：

~~~ts
type ThoughtPlan = {
  id: string;
  topicId: string;
  voiceProfileRevision: number;
  centralQuestion: string;
  thesis: string;
  audienceMisconception?: string;
  reasoningPath: Array<{
    step: number;
    claim: string;
    whyItMatters: string;
    evidenceIds: string[];
    counterpoint?: string;
  }>;
  personalAngle?: string;
  visualOpportunities: string[];
  uncertaintyNotes: string[];
  status: "draft" | "approved" | "rejected";
};
~~~

ThoughtPlan 解决“写得像 AI”背后的结构问题：很多 AI 味不是词的问题，而是没有真实立场、没有具体约束、每段都平均用力。

生成前必须先确认：

- 这条内容真正要回答什么问题；
- 创作者的判断是什么；
- 哪些内容是事实，哪些是推断；
- 有哪些证据；
- 哪些地方需要个人经验；
- 哪些观点需要承认反例；
- 哪些内容可以通过画面补充。

## 6. 脚本生成流水线

~~~text
选择 VoiceProfile
  → 生成 ThoughtPlan
  → 用户确认核心立场
  → 生成结构化 ScriptDraft
  → VoiceRender：改写为创作者口吻
  → SpokenEdit：检查是否真的说得出来
  → AuthenticityPass：检查 AI 味、空话和事实风险
  → 用户逐段确认/修改
  → Script approved
  → 生成 Storyboard
~~~

### 6.1 ScriptDraft

先生成“能把逻辑讲通”的结构，不急着追求漂亮句子。

输出必须包含：

- hook；
- 核心判断；
- 论证段落；
- 案例和证据；
- 反例或边界；
- 结论；
- CTA；
- 预估时长；
- 每段的画面需要。

### 6.2 VoiceRender

在逻辑通过后，根据 VoiceProfile 进行表达重写：

- 保持观点、证据和边界不变；
- 使用真实样本中出现过的表达方式；
- 保留自然的短句、停顿和转折；
- 避免为了“像人”随机添加错别字和无意义口头禅；
- 对不确定的个人经历和事实保持占位，不替用户编造。

### 6.3 SpokenEdit

这是口播专用的可说性检查：

- 一口气是否过长；
- 句子是否适合提词器；
- 是否存在连续难读词；
- 重音是否明确；
- 复杂概念是否需要先解释；
- 连接是否适合真实口头表达；
- 估算时长是否和目标一致。

系统可以提供分段录音预览，但不要求用户先录完整视频。

## 7. 去 AI 味审校

“去 AI 味”不是让文本故意变差，而是让内容更具体、更有立场、更像真实的人在说话。

### 7.1 需要重点检查的信号

- 模板化开头：“在当今时代”“很多人都认为”“今天我们来聊聊”；
- 机械连接：“首先、其次、最后”被平均使用；
- 过度对称：每段长度相同、每个观点都三点展开；
- 空泛形容词：“非常重要”“深刻影响”“全面提升”没有具体对象；
- 无来源数字、案例和权威口吻；
- 每段都先铺垫再总结，缺少自然跳转；
- 过度完整：没有真实创作者会保留的重点和取舍；
- 结尾自动升华、自动鼓励、自动 CTA；
- 为了显得口语而大量添加“其实、大家、你会发现”；
- 句子书面化，读起来不像人在镜头前说话；
- 观点没有风险、犹豫和适用边界，像万能答案。

### 7.2 AuthenticityReport

~~~ts
type AuthenticityReport = {
  scriptId: string;
  voiceProfileRevision: number;
  scores: {
    voiceMatch: number;
    spokenNaturalness: number;
    specificity: number;
    stanceClarity: number;
    aiPatternRisk: number;
    factualRisk: number;
  };
  findings: Array<{
    blockId: string;
    kind: "generic_opening" | "template_transition" | "empty_claim" | "over_polished" | "unsupported_fact" | "hard_to_say" | "voice_mismatch";
    severity: "info" | "warn" | "block";
    explanation: string;
    suggestion?: string;
  }>;
  passed: boolean;
};
~~~

报告给用户看的不是“AI 味 72 分”，而是可操作的解释：

> 这一段用了常见的三段式总结，但你的历史表达更习惯先给判断，再补一个具体例子。建议把“第一、第二、第三”改为一个直接判断和一个案例。

## 8. 用户控制方式

不要让用户面对几十个风格参数。提供少量可理解的控制：

- 沿用我平时的说法；
- 更口语一点；
- 更锋利一点；
- 更克制一点；
- 保留我的停顿和转折；
- 这段必须有事实依据；
- 这段必须使用我的亲身经历；
- 这段不要替我下结论。

所有控制最终映射到 VoiceProfile + ThoughtPlan + StyleConstraints，而不是在 UI 中为每个 Provider 单独做参数。

生成结果采用对照审阅：

- 原始逻辑；
- AI 草稿；
- 更像你的版本；
- 修改理由；
- 用户采用/拒绝/手动修改。

用户的手动修改比模型的自评更重要，采用和修改结果持续更新 VoiceProfile，但必须经过用户确认才能提升为长期规则。

## 9. 个人表达档案的建立流程

第一次使用时不要求用户填写一份长问卷。推荐：

1. 选择 5–10 条自己满意的旧视频、文章或脚本；
2. 系统提取转写和观点段落；
3. 生成一页“我理解的你的表达方式”；
4. 用户只需确认、删除错误项或补充三条“我不会这样说”的例子；
5. 生成一篇短测试稿；
6. 用户选择更像自己的版本；
7. 形成 VoiceProfile v1。

之后通过真实工作流渐进更新，不在每次生成前重新问一遍风格问题。

## 10. 评测指标

### 10.1 表达贴合

- 用户盲选“更像自己”的比例；
- 用户需要手动改写的字数比例；
- 旧样本中的句式/连接方式能否合理迁移；
- 观点结构与创作者历史思路的相似度。

### 10.2 去 AI 味

- 人工盲评 AI 味出现率；
- 模板化开头和连接词命中率；
- 空泛句被识别并修正的比例；
- 口播录制时卡顿、重录和跳句次数。

### 10.3 质量底线

- 事实错误率；
- 无来源数字率；
- 个人经历编造率；
- 用户拒绝后再次出现同类问题的比例；
- 生成速度和成本。

不要把第三方 AI 检测器分数当作唯一标准。最终以创作者本人和目标受众的盲评、实际录制表现和发布后数据为主。

## 11. 风险边界

- 不把“口头禅”当作全部个人风格；
- 不用随机错别字、语病和低质量句子伪造人味；
- 不未经用户确认生成个人经历、专业资历或事实判断；
- 不从对标账号复制独特表达和观点；
- 不将用户的私密内容默认用于其他 workspace；
- 不把模型自评“这很像你”当作证据；
- 用户可以关闭长期学习，或删除某个表达样本对档案的影响；
- 表达档案和声音克隆是不同能力，不能因为有 VoiceProfile 就默认允许音色复制。

## 12. 与其他契约的关系

- CreatorProfile 保存定位和内容边界；VoiceProfile 保存表达和思维方式；
- ThoughtPlan 是 Script 生成前的结构化中间层；
- Script 增加 voiceProfileRevision、thoughtPlanId 和 authenticityReportId；
- Storyboard 使用 ScriptBlock 的语义和视觉需求，不直接读取散文式文本；
- ReviewMemory 可以沉淀“这个创作者在什么情况下更喜欢怎样表达”，但必须有用户确认或真实复盘证据；
- Provider 只执行 structured_text、text_generate 和 transcribe 等能力，不自行保存个人风格事实。


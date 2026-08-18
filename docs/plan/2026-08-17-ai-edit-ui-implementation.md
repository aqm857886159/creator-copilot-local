# AI 剪辑界面实现计划

设计稿：`docs/design/ai-edit-v9.html`
状态：草案，待拍板
日期：2026-08-17
方法：按 AGENTS.md §6「先找现成解法」——先查谁解决过，再决定写什么

---

## 1. 结论先行

原计划里我列了三个「需要做 spike 才能决定」的风险。按新规则去查，结果是：

| 原风险 | 实际情况 |
|---|---|
| 中文字级时间戳准不准 | **有标准解法，而且交互设计本身是错的**——没有产品在字级剪 |
| 未渲染的时间线怎么预览 | **Kdenlive 2010 年就解决了**，而且我们已有 90% 的代码 |
| agent 循环烧钱 | e-cut 的 `LLMRunGuard` + Codex 的失控护栏，直接移植 |

没有一个需要重新发明。

---

## 2. 中文时间戳：问题不成立

### 别人怎么做的

中文生态统一用 **FunASR / Paraformer**，时间戳来自 **CIF（Continuous Integrate-and-Fire）预测器**——编码器逐帧累积权重，越过阈值就「发火」，发火位置本身就是时间戳。因为 Paraformer 词表是字，一次发火 = 一个字。**时间戳是识别架构的副产品，不需要第二遍强制对齐。**

西方栈（Whisper → wav2vec2 强制对齐）是在给 Whisper 补课，因为 Whisper 自回归、无对齐机制、时间戳只能事后从 cross-attention 反推。这条路对中文尤其差：WhisperX 的中文模型是**字表 CTC**不是音素 CTC，CTC 后验是尖峰状、系统性偏晚。

已发表数据（Paraformer-TP 论文，M7 集，5550 条人工标注字级边界）：

| 方法 | AAS 平均边界误差 |
|---|---|
| Kaldi 混合强制对齐 | 80.1 ms |
| **Paraformer-TP** | **71.0 ms** |
| 未优化 CIF | ~213 ms |

**ASR 自带的预测器比 Kaldi 强制对齐还准 12%。**

### 但真正的发现是：没人在字级剪

**FunClip 是 Paraformer 团队自己做的剪辑工具**，手握全世界最好的中文字级时间戳，它的交互是——**复制你要的文字段落**，段落级，不是字级。

原因是声学事实，不是工程不足：

- 普通话协同发音严重，「中国」的中和国之间**没有静音**，是连续的共振峰过渡。「正确的字边界」在物理上不存在，71ms 是天花板不是缺陷。
- 删掉一个字会留下爆音或截断的声调，**即使时间戳完美，剪出来也难听**。
- 中文词多为双字，删一个字通常produces 一个非词。

**Descript 从来不支持中文**（官方语言列表只有拉丁字母语言，中日韩是长期未实现的需求）。所以没有西方参考实现——中文转写剪辑的先例全在中文生态：FunClip、剪映、云厂商。

### 采用的设计

**把「显示」和「执行」拆开**：

- **字级时间戳只用于显示**——高亮、跟随播放头、点击定位。71ms ≈ 2 帧，人感觉不到。
- **实际的刀口吸附到 VAD 静音边界**，不是字边界。FunASR 同一套工具里就有 FSMN-VAD。
- 用户可以**框选一个字范围**（点「中」拖到「国」），系统在包住这个范围的停顿处下刀，并把吸附后的区间显示出来。选择是字级的，执行是停顿级的。

这同时满足了 `FrozenEditSpec` 的确定性要求：对齐是对冻结文本的确定性二次处理，停顿吸附是 VAD 输出的确定性函数。

### 口播场景还有一条捷径

剪映的**文稿匹配**就是强制对齐：你给已核对的稿子，系统对到音频上。中文用户用它是因为自动 ASR 有错别字，而稿子没有。

我们第一个工作流正是**有稿口播**——稿子本来就在项目里。所以应该用 `funasr/fa-zh`（38M 参数、5000 小时中文对齐模型）做**对齐**，而不是跑 ASR 再纠错。绕开错别字问题。

### 许可证（未解决）

- `FunASR/LICENSE` = **MIT**（代码，干净）
- `FunASR/MODEL_LICENSE` = **阿里自定义协议 v1.1**（权重）。问题：§3「仅供参考和学习使用」、**§4.2 恶意贬损即自动丧失全部授权**（无任何 OSI 协议有此条）、§6 单方面可追溯修改、**§7 管辖法律是未填的占位符 `[Country/Region]`**
- HuggingFace 卡片自相矛盾：`funasr/paraformer-zh` 标 `apache-2.0`，`funasr/fa-zh` 标 `other`，且其 `license_link` 指向已改名的旧仓库

**商用前必须让法务看，或向阿里要书面澄清。** 备选：走阿里云 API（`enable_words: true` 返回字级时间戳，是正常商业合同）或 MFA（MIT，无歧义，但重）。

---

## 3. 预览：Kdenlive 的方案，我们已有 90%

### 别人怎么做的

**没有任何 NLE 是「播放一个 EDL」的。** 统一形态是**时钟驱动的拉取式帧服务器**：时间线是个函数 `getFrame(n) → 合成好的帧`，消费者线程尽力拉帧、缓冲、跟不上就丢视频帧。**音频永远不丢，它是主时钟。**

- **MLT**（LGPL-2.1+ 核心，Shotcut/Kdenlive 的引擎）：`consumer_read_ahead_thread` 里的丢帧启发式；跨文件精确定位是 `av_seek_frame(AVSEEK_FLAG_BACKWARD)` 到目标前的关键帧 → `avcodec_flush_buffers()` → 向前解码到精确帧。**所有正确实现都是这个模式，包括 JS 的。**
- **Kdenlive `PreviewManager`**（最值得抄的设计）：时间线切成**固定 25 帧的块**（约 1 秒），脏块交给**独立进程**渲染，产物按 `<chunkStart>.<ext>` 命名，**渲染好的块作为最顶层轨道插进 tractor**——播放逻辑不需要任何特判，渲染块直接盖住下面的实时合成。编辑时 `invalidateZone` 把范围向下取整到块边界，把受影响的块打回脏。

**「渲染好的预览就是另一条轨道」这个技巧是关键**，而且直接对得上我们的 `FrozenTrackSchema`。

### 我们的实现路径

`packages/exchange/src/index.ts:643` 的 `renderMp4` **已经有完整 filtergraph**——逐片段 `-ss`/`-t`、`scale`+`pad`+`fps`+`setpts`、`concat`、链式 `overlay`。**EDL 合成逻辑已经写好并测过了。**

所以：

1. 给 `renderMp4` 加一个 `previewProfile`——640×360、`-preset ultrafast -crf 28`（或 `mjpeg` 换取瞬时定位）。同一个函数，不同 `OutputProfile`。
2. 把 `FrozenEditSpec` 按 clip 边界切成约 2 秒的块，脏块走现有任务队列在主进程渲染，缓存键 = `(块范围 + 影响它的 clips + assetLocks)` 的 hash。我们已有 `authoredSpecHash` 和 `stableStringify`，**失效键几乎是白送的**。
3. 渲染器用普通 `<video>` 播拼接好的块。**帧精度天然正确，因为合成已经发生过了。**

不引入任何新依赖，FFmpeg 留在主进程符合 IPC 边界规则，零新增许可证暴露。代价是每次编辑后的延迟——这正是 Kdenlive 和 Premiere 都在承受的取舍。

**升级路径**（等拖拽定位的延迟开始难受时）：加 **mediabunny**（MPL-2.0，v1.55.1，周下载 210 万）做实时拖拽。它在 JS 里用和 MLT 在 C 里一样的方式解决精确定位。MPL-2.0 是文件级 copyleft，**作为依赖不修改地用在闭源商业应用里是安全的**——所以要包装，不要 fork。

### 设计修正：A/B 对比对我们不成立

Kdenlive 的 `Monitor::buildSplitEffect` 是**一个播放器**：克隆 producer、剥掉效果做成「改前」、两条塞进同一个 tractor、用 alpha 渐变擦除混合。一个时钟一个播放头，完美同步。

**但这成立的前提是改前改后共享同一条时间轴**——它比的是效果和调色。

我们的 AI 剪辑**会改变时长**，改前 38.5 秒改后 37.9 秒，根本没有共享时间轴，擦除对比没有意义。

**修正**：结构性编辑不做画面 A/B，改成**切换播放哪个版本**（v1 / v2 两个按钮，同一个播放器）。两个不等长的时间线并排播是明确要避免的。设计稿 `ai-edit-v9.html` 里预览区那个「改前/改后」需要按此修改。

### 明确避开

- **Remotion**：非开源，3 人以上公司需付费，且 `license-blacklist.tsx` 内置域名 hash 黑名单
- **Diffusion Studio Core**：标 MPL-2.0 但打包内含签名 key 校验，无 key 打水印
- **Olive / OpenShot Qt 前端 / MLT 的 `qt` 和 `plusgpl` 模块**：GPL
- **HTMLVideoElement 堆叠**（Remotion 预览的做法）：其源码 `DEFAULT_ACCEPTABLE_TIMESHIFT_WITH_NORMAL_PLAYBACK = 0.45` ——**容忍 450ms 漂移**。对动态图形可以，对以切为主的剪辑器不行。

---

## 4. agent 成本护栏：直接移植

- e-cut `LLMRunGuard`：`budget_cny` + `ensure_capacity` 预检，阶段开始**前**判断最小请求数能否装进预算，装不下直接失败，不做半途而废的付费运行
- Codex：连续 N 轮工具调用后暂停确认方向
- OpenChatCut 的思路（只学不抄）：外部 agent 会话只暴露**草稿安全**的工具，生成/导出/删除不给——因为这些在提案被拒绝后无法回滚

---

## 5. 不动项

- 不移植 e-cut 的 wgpu/wasm 渲染路径（浏览器渲染，与我们 FFmpeg 主进程架构冲突）
- 不引入 MLT（`melt` 为 GPL-2，唯一 Node 绑定已停更且 shell 调 GPL 二进制）
- 不把 OTIO 当内部模型（effects 不透明，只做导出适配器）
- 不复制 OpenChatCut 任何代码（AGPL-3.0 无例外）
- 不做实时合成播放器（先走 Kdenlive 分块预渲染）
- 本阶段不做协作、云同步、移动端

---

## 6. 分阶段

排序原则：**每个阶段结束都能跑一次真实用户任务；对话最后做。**

对话最后做的理由：AI 只能调用软件已经会做的事（AGENTS.md §4「Agent 只能调用注册过的结构化命令」），而 `packages/agent-tools` 当前**不存在**。

### Phase 1 · 地基
- P1-1 设计令牌层：替换 334 个散落 hex、20 级字号收敛到 7 级；lint 禁止裸 hex 和 <11px
- P1-2 `CurrentProjectProvider`：修**恢复项目→AI 剪辑断点**（`creation-workbench.tsx:145` 只设本地 state 不上抛）；删死代码 `lib/api.ts`；修 `package.json` 指向不存在的 `server/index.ts`
- P1-3 三区骨架落地，用真实数据

**验收**：能恢复昨天的项目并进入 AI 剪辑页；今天页显示真实项目而非 demo 数据。

### Phase 2 · 预览与时间线
- P2-1 `renderMp4` 加 `previewProfile` + 分块 + 缓存失效（Kdenlive 模型）
- P2-2 vendor `opencut-classic` 的 `timeline/`（**MIT，保留版权头**），砍掉关键帧/遮罩/书签，收敛成三轨，整数 tick 时基
- P2-3 版本切换式预览（不做画面 A/B）

**验收**：手动剪出一条 30 秒成片，改一刀后 2 秒内能看到画面。

### Phase 3 · 转写与自动剪辑
- P3-1 接 `funasr/fa-zh` 强制对齐（有稿路径）+ FSMN-VAD
- P3-2 文字稿视图：字级显示、**刀口吸附到停顿**
- P3-3 移植 `auto-editor` 删停顿算法（**Unlicense/公有领域**，核心约 130 行：每帧最大绝对振幅 + `mutMargin` 0.2s 外扩 + `smoothing` 丢弃过短切口）
- P3-4 `operation-catalog`：`implemented` + `adapter` + `assertion`，不支持的能力显式报错
- P3-5 版本表 + 前向还原 + 按类还原

**验收**：一键出粗剪；收据里每一类能单独还原；还原后版本号前进不回退。

### Phase 4 · 对话与 agent
- P4-1 新建 `packages/agent-tools` 命令注册表
- P4-2 agent 从一次性提案改成多轮工具循环 + 预算预检
- P4-3 提问工具 = 设计稿的选择器；落决策记录（问题、选项、选择、补充说明、时间戳）
- P4-4 每回合 = 一个 checkpoint

**验收**：说「开头再紧一点」能真改并生成新版本；缺素材时停下来问而不是塞空镜。

### Phase 5 · 渲染能力扩展
- P5-1 FFmpeg 原生能力接入：`xfade`（58 种转场）、`zoompan`、`setpts`+`atempo`、`lut3d`+`eq`、`acrossfade`
- P5-2 字幕烧录（需自带启用 libass 的 ffmpeg 构建，待定）

---

## 7. 待拍板

1. **FunASR 模型许可证** —— 走开源权重（风险未解）还是阿里云 API（正常商业合同）？
2. **字幕烧录做不做** —— 抖音口播几乎必须烧字幕，但要自带 libass 构建随包分发
3. **e-cut 编辑器与 opencut-classic 的关系** —— 相同 `SceneTracks` 结构、相同 controller 命名、都从 `@/wasm` 导入，我判断前者是后者衍生。若属实应直接走上游 MIT 保留版权头。**需确认。**

## 8. 证据边界

- 未运行过本应用（无 `node_modules`），代码结论均为静态分析
- FFmpeg 能力为本机 8.0.1 实测：`xfade` 58 种、`zoompan`/`setpts`/`atempo`/`lut3d`/`eq`/`acrossfade` 存在；`subtitles`/`drawtext`/`ass` 不存在（构建未启用 libass/freetype/fontconfig）
- Paraformer AAS 数字来自论文（arXiv 2301.12343），未在本仓库复现
- 许可证均已读 LICENSE 原文；FunASR 的仓库协议与 HuggingFace 卡片互相矛盾一事已核实

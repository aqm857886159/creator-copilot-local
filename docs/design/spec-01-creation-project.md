# 页面规格 01 · 创作项目

范围：项目列表 + 脚本 / 分镜 / 拍摄包 三个阶段
状态：待你确认，确认后再出 HTML
日期：2026-08-17

已定的结构决定：
- 「创作项目」从编辑器变成**项目列表**，点进去才进编辑器
- 项目内用**阶段导航**（脚本 → 分镜 → 拍摄 → 剪辑 → 发布），侧边栏不再有平级的「AI 剪辑」
- 「创作记忆」独立成全局资料页

---

## 0. 项目列表

**为什么来** 我要继续昨天那条，或者开一条新的。

**做什么** 看到所有项目、各自停在哪一步、下一步是什么。点进去。

**去哪** 项目内当前阶段。

**需要什么**
- 已有：`listProjects`（返回 `stage` 和 `revision`）
- 缺：**「下一步是什么」的推导**。现在 `stage` 只有 script/capture/editing/rendered/published 五个值，要变成一句人话（「还有 3 个镜头没选 take」），得结合 `tasks` 和 `takesByTask` 算。

---

## 1. 脚本

**为什么来** 选题定了，要把一个观点写成能讲出口的稿子。

**做什么** AI 出初稿，你逐段改。每段有两个属性要定：

- **段落类型**：hook / claim / evidence / example / counterpoint / transition / conclusion / cta
- **视觉需求**：`none` 不需要画面 / `support` 有画面更好 / `must_show` 必须有画面

**关键交互：标视觉需求。** 这是整个下游的输入 —— 标了 `must_show` 的段落，分镜阶段必须给它配镜头，剪辑阶段配不上就会停下来问你（就是设计稿里那个「缺画面证据」）。**这个标注是人做的判断，不该由 AI 代劳。**

**去哪** 生成分镜。

**需要什么**
- 已有：`proposeScript` / `acceptScriptProposal` / `listTopics` / `selectTopic`
- 已有 schema：`ScriptBlock`（kind + text + visualNeed）
- **缺：表达档案**。AGENTS.md 第三条原则是「表达优先 —— 先理解创作者的真实表达、思考方式和边界」，但代码里没有 VoiceProfile 这个东西。而 `Independent-Product-Review` 已经警告过：五到十条样本就能稳定复刻一个人的表达，是**未验证的假设**，不能当已解决的能力。**建议本阶段不做，先让 AI 出结构、人来写句子。**

---

## 2. 分镜

**为什么来** 稿子定了，要决定每段话配什么画面。

**做什么** 左边脚本段落，右边镜头，一一对应。每个镜头定：

| 字段 | 取值 |
|---|---|
| `purpose` 画面目的 | explain / prove / transition / emotion / reset / brand |
| `mode` 画面类型 | talking_head / broll / screen_recording / graphic / generated / still |
| `framing` 景别 | wide / medium / close / detail / screen |
| `sourceRequirement` **素材从哪来** | existing_asset / shoot_task / generated_asset / any |
| `targetMs` 目标时长 | — |
| `cameraDirection` 拍法 | 自由文本 |

**关键交互：`sourceRequirement` 决定这个镜头进不进拍摄包。** 只有 `shoot_task` 会变成要现场拍的任务；`existing_asset` 直接去素材库找；`generated_asset` 走生成。这是分镜和拍摄包之间唯一的连接点。

**已有的规则**：`assertLayeredStoryboardCoverage` 会检查覆盖 —— 标了 `must_show` 的脚本段落有没有对应镜头。这个规则已经实现了，UI 要把它的结果显示出来。

**去哪** 导出拍摄包。

**需要什么**
- 已有：`createCaptureWorkflow`（一次性接收 blocks + shots，产出 storyboard + shoot tasks + capture package）
- 注意：现在是**一次性提交**，不是逐步保存。要改成可增量编辑。

---

## 3. 拍摄包

**为什么来** 分镜定了，我要拿着手机去拍。

**做什么** 把任务带到手机上 → 逐镜拍 → 拍完导回来 → 每个镜头选一条 take。

**去哪** AI 剪辑。

**需要什么**
- 已有：`createCaptureWorkflow` / `importTake` / `selectTake`
- 已有 schema：`ShootTask`（status: todo/recorded/imported/accepted/skipped）、`Take`（status: unreviewed/candidate/selected/rejected + `note`）
- 已有产出：`renderCapturePackageHtml` —— 一个静态 HTML，带 viewport meta 和打印样式，每个镜头一张卡片

### 三个真缺口

**缺口一：没有台词。**

`ShootTask` 里没有台词字段，导出的 HTML 里也没有。但这是**口播**——台词就是全部内容。现在拿着这个拍摄包到手机上，你知道要拍「正面中景」，但不知道要说什么。

好消息是**可以推导**：`shot.scriptBlockIds` → 脚本段落 → 文本。路径是通的，只是没传下去。

`Independent-Product-Review` 明确要求过：「提词器与脚本应共享版本，不能让用户复制粘贴后产生两个事实源」。所以**不要把台词复制进 ShootTask**，要在生成拍摄包时按引用取，这样脚本改了拍摄包重新导出就是新的。

**缺口二：HTML 是只读的，状态回不来。**

`ShootTask.status` 有五个状态，但导出的 HTML 里体现不了，也打不了勾。你在手机上拍完第 3 个镜头，桌面这边不知道。

**缺口三：怎么到手机上，没有定义。**

现在只是工作区里的一个 `.html` 文件。用户要自己 AirDrop 或者用微信传给自己。这是流程断点。

### 三个缺口的解法(待你选)

| | 做法 | 代价 |
|---|---|---|
| **A 最小** | HTML 里加台词和勾选框，勾选状态存 `localStorage`，回来手动同步 | 几乎不用做后端；但状态要手工对，容易忘 |
| **B 局域网** | 主进程起一个只在局域网可达的小服务，桌面显示二维码，手机扫码打开，打勾直接写回本地库 | 要处理端口、防火墙、设备发现；但流程是通的，且**素材和数据都不出局域网**，符合本地优先 |
| **C 不做** | 只导 HTML，用户自己想办法 | 零成本；但「拍摄包」这个能力基本等于没有 |

**我的建议是 B。** 理由：这是 A 方案拍摄（软件不控制相机，用户自己拍）唯一能闭环的方式，而且二维码扫码是创作者已经熟悉的动作。局域网服务不碰公网，不违反本地优先。

但 B 有个前提要确认：**你实际拍摄时，手机和电脑在同一个 Wi-Fi 下吗？** 如果你经常在外面拍，B 就不成立，得退回 A。

---

## 4. 本规格没有覆盖的

- **表达档案 / VoiceProfile** —— 建议后置，理由见 §1
- **重拍原因的记录** —— `Take` 有 `note` 字段可以先用
- **一个拍摄任务对应多个素材** —— `takeIds` 是数组，schema 支持，UI 待定
- **竖屏 / 可变帧率 / 外接麦克风 / 音画不同步 / 重复导入** —— `Independent-Product-Review` 列为 P0 缺口，属于素材导入的范畴，放到「素材库」规格里

## 5. 需要你确认

1. **拍摄包走 A / B / C 哪条** —— 取决于你拍摄时手机和电脑在不在同一网络
2. **表达档案后置，接受吗** —— 本阶段 AI 只出结构，句子你自己写
3. **分镜阶段要不要保留「一次性提交」** —— 现在 `createCaptureWorkflow` 是一把梭，改成增量保存是额外工作量，但不改的话中途退出会丢

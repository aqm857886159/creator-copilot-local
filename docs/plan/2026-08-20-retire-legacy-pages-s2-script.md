# 切片 2:脚本页真实化 + 旧页退役路线

日期:2026-08-20
方案:Fable 5;执行:Opus;验收:Fable 5 + 用户人设 agent
视觉蓝本:`docs/design/02-script.html`(已过独立验收)
用户拍板(2026-08-20):**旧 scaffold 页面全部作废,不投入换肤**;按已验收蓝本逐个重建,建成一个、路由摘一个、最后删一个。

## 旧页退役路线(总方向,本切片只执行第 1 行)

| 旧组件 | 处置 | 时点 |
|---|---|---|
| creation-workbench 的 script 阶段展示/编辑 | 移交新脚本页,路由摘除 | **本切片** |
| creation-workbench 其余(从头规划向导、capture 阶段) | 维持可达,不再投入 | 选题/拍摄环节重建切片 |
| ai-edit-workbench | 维持可达,不再投入 | S3 剪辑页(蓝本定稿→验收→实现) |
| topic-radar / account-radar / asset-library / review / settings | 维持可达,不再投入 | 各自蓝本落地时替换 |
| 全部旧组件文件 | 最后调用方摘除时删除,不留死代码 | 随各切片 |

## S2 范围

1. **新组件** `apps/desktop/renderer/components/script-page.tsx` + `styles/script-page.css`(类名 `sp-` 前缀,颜色只用 `tokens.css` 令牌,不写裸 hex)。蓝本 `02-script.html` 的结构与样式逐条移植:项目头(← 工作台、标题、阶段页签)、立场卡+时长卡、doc-note、段落网格(kind chip + ~Ns + 17px/2.05 台词 + 右缘单 chip)、底部闸门。
2. **数据接线**:`loadProject` → `script.blocks`(kind/text/emphasis/visualNeed)与 `estimatedDurationMs`;立场卡内容 = 项目 `payload.topicId` 对应选题的 `angle`(经 `listTopics` 查找;无 topicId 或查不到 → 整卡隐藏,不伪造「已确认」);`payload.visualSuggestions[blockId]` 作为 must chip 下的 `.why` 行(无则不显示)。
3. **视觉需求 chip**:三档映射 `none→不配画面`、`support→配画面更好`、`must_show→必须配画面`;点击按此序轮换;must 样式带记号黄豁口(蓝本 `.chip.must`)。映射与轮换写成纯函数并单测。
4. **emphasis 高亮**:段落文本内对 emphasis 词做完整子串匹配加 `<mark>`,全部匹配都标;匹配不到的词不硬造。纯函数 + 单测(含重叠词、匹配不到、空数组)。
5. **例外问题块**:域模型当前没有「AI 拿不准」信号 → 本切片恒为 0 条,闸门句自适应(只说「画面需求已标好 N 段」,不出现「X 段等你拿主意」的假话)。蓝本的问题块样式照留在 CSS 里备用。
6. **编辑与自动保存**:段落 contenteditable;**中文输入法 composition 期间不触发保存**(compositionend 后才算变更);停顿 800ms 或失焦 → 新 IPC。顶部三态「刚刚保存 / 保存中… / 保存失败,点击重试」,不撒谎。时长卡按共享公式即时重估。
7. **新 IPC `desktop:update-script`**(main.cjs + preload `updateScript`):入参 projectId + scriptId + 期望 revision + 全量 blocks;校验项目归属与 `ScriptSchema`,乐观锁(revision 不符返回 `script_revision_conflict`,UI 提示重新载入),成功则 revision+1、updatedAt、重算 estimatedDurationMs;storyboard 不动(靠既有 scriptRevision 字段自然判 stale)。**时长公式从 main.cjs accept 处抽到 `packages/creation` 导出**(领域规则只实现一次),accept / update / 渲染端共用。按 `apps/desktop/AGENTS.md`:preload 白名单变更必须同时覆盖 `test:desktop:package`(IPC 冒烟)与 `test:desktop:ui`(用户路径)。
8. **闸门「生成分镜」**:shots 由 `payload.shotPlans` 组装(与旧 creation 流同源),带 `existingProjectId/existingScriptId` 调 `create-capture-workflow`;成功 → 阶段页签点亮分镜 + 一句人话确认;失败(如「段落 X 需要至少一个补充画面」)→ 闸门旁记号红人话提示,不弹技术栈。当前 revision 已有 storyboard → 按钮文案「重新生成分镜」。
9. **阶段页签(过渡期行为,明写)**:脚本=当前页;分镜/拍摄 → 有数据时进旧 creation-workbench 对应视图,无数据 disabled + title 说明;剪辑 → 有 storyboard 时进现剪辑页(旧),否则 disabled。← 工作台返回工作台。
10. **路由**:`app.tsx` openProject 的 `script` 阶段 → 新脚本页(替换旧 creation 入口);capture/editing/rendered/published 路由不变。
11. **蓝本偏差(本切片明确不做,不渲染假控件)**:右上「让 AI 提结构建议」按钮、立场卡「改立场(全文会跟着改)」按钮——背后流程尚不存在,整个控件不出现,记入偏差清单。

## 决策预算推演

1000 字脚本 ≈ 17 段:用户必做决策 **0**(visualNeed 全部 AI 预标);可选动作 = 改 chip、改文、生成分镜。符合 spec-02 §3.5。

## 不动项

- 其余 41 个 IPC 通道与全部旧组件内部逻辑(仅摘 app.tsx 的 script 路由);
- `packages/*` 除 creation 抽时长公式外不动;
- 不做全局重命名、不动 tokens.css 既有令牌、不升级依赖。

## 验收门(全过才算完)

1. `npm run typecheck`、`npm test`、`npm run build` 全绿;新增单测:chip 三档轮换、emphasis 高亮(含边界)、时长公式;update-script 合同路径(成功/归属错误/revision 冲突)在打包 IPC 冒烟或 catalog 层测试覆盖;
2. `npm run test:desktop:package` 通过(含新通道);
3. `npm run test:desktop:ui` 扩展并通过:种一个 `script` 阶段项目 → 工作台点「继续写脚本」→ 断言脚本页段落数与真实 blocks 一致、chip 文案为三档之一、编辑一段文字后保存态回到「刚刚保存」且 SQLite 里 revision+1、点「生成分镜」后 storyboard 落库;截图 `script-page.png` 落盘;
4. `npm run test:desktop:settings` 不回归;
5. 截图与 `02-script.html` 对账:令牌色、段落网格、chip 三态、闸门形态一致;偏差仅限 §11 清单;
6. 设计验收四问(简洁/句句人话/细节/同类惯例)由主会话跑用户人设 agent 复审,P0/P1 清零。

## 风险与回滚

- contenteditable + IME:composition 处理错误会吞字 → 验收必须真实中文输入实测;
- emphasis 子串在改文后失配 → 允许失配即不高亮,不追着重算;
- revision 冲突在单机极少发生,乐观锁 + 人话提示足够;
- 回滚:单提交 revert;update-script 为纯新增通道,不影响既有数据。

## 完成报告要求

改了什么(文件清单)、每个验收门的实际输出(不许「应该可以」)、截图路径、与蓝本的偏差清单、剩余风险。

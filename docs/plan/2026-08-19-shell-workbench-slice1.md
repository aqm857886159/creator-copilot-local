# 切片 1:新壳 + 工作台真实数据 + 恢复断点修复

日期:2026-08-19
方案:Fable 5;执行:Opus;验收:Fable 5
视觉蓝本:`docs/design/01-workbench.html`(已过独立验收,P0/P1 已修)
产品依据:`docs/design/spec-02-product-shape.md`

## 目标

应用启动后看到的是新壳(顶部导航 + 工作台),工作台显示**真实项目**的 9:16 卡片;点击卡片进入对应阶段的现有工作台;**恢复昨天的项目能直接进入 AI 剪辑页**(修复本会话最早发现的 P0 断点)。

## 范围(全做)

1. **设计令牌**:新建 `apps/desktop/renderer/styles/tokens.css`(幕布 #F4F5F3 / 石板 #22252B / 记号黄 #FFD84D / 录制红 #E0442E / 文字红 #C93B27 / ink2 #62666D / 界线 #E3E4E1,字体三役),新壳与工作台组件只用令牌,不写裸 hex。旧 `styles.css` 原样保留供旧组件用,新样式文件独立,类名不得与旧冲突。
2. **新壳**:重写 `app.tsx` 为顶部导航(原点 | 工作台 选题 素材库 记忆 | 数据在本机 设置),导航样式按蓝本(当前项黄色下划线)。视图路由:工作台=新组件;选题=现有 `TopicRadarWorkbench`;素材库=现有 `AssetLibraryWorkbench`;记忆=现有 `ReviewWorkbench`;设置=现有 `SettingsWorkbench`;账号雷达并入选题视图内的一个入口(不丢失能力,可用简单二级切换)。
3. **工作台组件** `components/workbench.tsx`:
   - `listProjects()` 真实数据 → 9:16 卡片:封面题字(标题,无高亮词数据则不加 mark)、五段阶段条、一句人话下一步、行动按钮;
   - 阶段映射(真实枚举):`script→脚本中/继续写脚本`、`capture→拍摄中/看拍摄进度`、`editing→剪辑中/继续剪辑`、`rendered→已出片/去发布`、`published→已发布/看数据`;阶段条五段按此顺序点亮;
   - 下一步人话由纯函数 `deriveNextAction(project)` 生成,**必须有单元测试**;
   - 新片卡置于**第一格**(蓝本已定):主按钮「拍好了就扔进来」本切片行为=调用现有 `importMedia()`(快剪管线是切片 3,不假装存在;导入成功提示进素材库);次按钮「想从头规划一条 →」=进入现有创作流(`CreationWorkbench`);
   - 空状态:无项目时只显示新片卡 + 一句邀请;
   - 文案与标点**逐字取自蓝本**(全角标点;蓝本没有的新文案按同一语气写)。
4. **恢复断点修复**(P0):
   - 新增适配函数 `workflowFromLoadedProject(loaded: LoadProjectResult): CaptureWorkflowResult`(纯函数,**必须有单元测试**);
   - 工作台点击 `editing/rendered` 阶段卡片 → `loadProject` → 适配 → 设置 app 级 `captureWorkflow` → 进入 `AiEditWorkbench`;
   - 同时修 `creation-workbench.tsx:145` 一带:恢复项目成功后也调用 `onWorkflowReady`(**仅当结果 ok**;顺带修现有 `onWorkflowReady(result)` 在失败时也上抛的 bug:`creation-workbench.tsx:180` 处加 ok 判断)。
5. **清死代码**:删除 `apps/desktop/renderer/lib/api.ts`(全仓无调用方,指向不存在的 server)与 `lib/demo-workspace.ts`、`lib/demo-workspace.test.ts` 及其残余引用;`package.json` 的 `dev`/`start` 指向不存在的 `server/index.ts`,改为 `dev` = 现 `dev:desktop` 语义(保留 `dev:desktop` 别名),删除 `dev:server`/`start`;同步更新 `AGENTS.md` §7 与 `README.md` 命令节。

## 不动项

- `apps/desktop/main.cjs`、`preload.cjs`、全部 IPC 契约 —— 一行不改;
- 旧工作台组件(topic-radar / asset-library / review / settings / creation / ai-edit / account-radar)内部逻辑不改(仅上述两处 creation-workbench 的 `onWorkflowReady` 调用点);
- `packages/*` 全部不改;
- 不做全局重命名、不动旧 styles.css 既有规则、不升级依赖。

## 逐步推进(后续切片,本次不做)

S2 等你定收件箱 + 处理中卡片状态;S3 正门快剪(移植 auto-editor + 一键链路);S4 应用内预览(Kdenlive 分块);S5 剪辑面换肤。

## 风险与回滚

- 风险:新壳丢失旧入口 → 缓解:每个旧视图都有导航可达,验收门逐一点检;
- 风险:样式冲突 → 缓解:新样式独立文件 + 独立类名前缀;
- 回滚:本切片一个提交,`git revert` 即可整体退回;IPC 未动,数据零风险。

## 验收门(全过才算完)

1. `npm run typecheck`、`npm test`(含新增单测)、`npm run build` 全绿;
2. 新增单测覆盖:`deriveNextAction` 五个阶段 + 未知阶段兜底;`workflowFromLoadedProject` 正常/缺 storyboard/缺 tasks 三路;
3. `npm run test:desktop:ui` 打包冒烟通过;先读该脚本现状,**扩展断言**:首页渲染「接着做」与真实项目卡(脚本可先在 SQLite 种入一个项目)、点击 editing 阶段卡后 AI 剪辑视图非空(不是「先准备一组真实素材」空态);冒烟须落截图文件;
4. 截图与 `01-workbench.html` 对账:令牌色、导航形态、卡片结构、文案一致(封面题字允许无 mark);
5. 全仓 grep 无 `demo-workspace`、无 `lib/api` 残留引用;`git diff` 无密钥、无临时文件。

## 完成报告要求

改了什么(文件清单)、每个验收门的实际输出(不许"应该可以")、截图路径、与蓝本的偏差及理由、剩余风险。

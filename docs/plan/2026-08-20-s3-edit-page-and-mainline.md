# 切片 3:剪辑页重建 + 阶段推进 + 合并主线

日期:2026-08-20
授权:用户拍板「自己列计划全部推进,完毕后合并到 main」。
方案与验收:Fable 5;实现:Opus;用户视角复审:人设 agent。

## 背景与目标

退役路线(见 2026-08-20-retire-legacy-pages-s2-script.md)主创作路径上最后一个旧页是米绿宋体的 ai-edit-workbench(两轮用户评审的 P0 集中地)。本切片:按新视觉语言重建剪辑页、修掉「恢复后不显示已存粗剪」的存量断点、补上阶段推进写入,然后把分支合并进 main。

## 范围

### S3a 蓝本 `docs/design/03-edit.html` + 独立验收

剪辑页 = **粗剪审阅台**(页面存在性检验:用户必须亲自判断的是「哪些镜头用、缺口怎么办、是否出片」)。结构:

- 项目壳同 02:← 工作台、项目名(不是 UUID)、阶段页签(剪辑为当前);
- 空态(没有粗剪):页面中央主按钮「让 AI 出一版粗剪」+ 预期管理一句话(本机分析、不联网不花钱、大约多久)+ 素材就位数;
- 粗剪态:头行「粗剪 · N 个镜头 · 共 Ns」+ 安静「重新分析」;镜头行 = 序号 + mono 时间段 + 主干/覆盖 + 人话理由 + 证据引用(素材号+时间码+原话)+ 采用/不用;默认全部采用,用户决策按例外计;
- 缺口行(must 没素材):记号红,给两条出路(用口播带过 / 记进补拍清单),有候选素材时列候选 chip;
- 底部闸门:诚实汇总(几采用几不用)+「确认,出这一版粗剪」;出片后状态条(打开成片 / 导出 / 去发布);
- 恢复横幅(提交状态未知)改人话;
- 词表:用户可见一律「粗剪」;禁止 Provider/合同/可审计/英文小标。

四问验收(简洁/句句人话/细节/同类惯例)P0/P1 修完才进 S3b。

### S3b 剪辑页实现(替换 + 删除旧页)

- 新组件 `components/edit-page.tsx` + `styles/edit-page.css`(`ep-` 前缀,只用令牌,reset 用 `:where()`);
- **能力对账清单**(从旧 ai-edit-workbench 逐项迁移,不丢失):生成/重新分析(propose-edit 幂等)、提交状态未知恢复(reconcile)、镜头行证据与拍摄意图、逐行采用/拒绝、素材候选采用(adopt-asset-candidate)、确认渲染(render-edit)、渲染恢复(list-render-recoveries/retry-render)、导出交换格式(export-exchange)、发布包(create-publish-package)、打开本地文件(open-workspace-file);
- **提案回读(存量 P0)**:`catalog.getLatestEditProposal(projectId)`(按 project_id+updated_at 索引取最新,含单测)→ `desktop:load-project` 响应附加 `latestEditProposal`(向后兼容的新增字段)→ 剪辑页挂载即显示已存粗剪,不再出现「还没有生成提案」的假话;
- 路由:app.tsx 的 editing/rendered 阶段 → 新剪辑页;**删除 `ai-edit-workbench.tsx`**(最后调用方摘除,退役规则)及其专属样式残留;
- 工作台 editing 卡文案随真实回读能力更新(「粗剪已存好,点开接着审」仅当能回读时)。

### S3c 阶段推进写入(S2 遗留)

- propose-edit 成功且当前 stage ∈ {script,capture} → `editing`;render-edit 成功 → `rendered`;create-publish-package 成功 → `published`;只前进不回退(顺序 script<capture<editing<rendered<published);
- 写入点在 main.cjs 对应 handler 内,复用既有 project 更新与事件记录;冒烟断言阶段变化。

### S3d 验收与合并

- 门:typecheck / test(新增 getLatestEditProposal 与阶段推进的用例)/ build / test:desktop:package / test:desktop:ui(扩展:恢复进剪辑页断言已存粗剪行数>0、渲染后工作台卡变「已出片」)/ test:desktop:settings;截图对账蓝本;人设复审 P0/P1 清零或记档移交;
- 合并:re-fetch 后确认 origin/main 仍无独有提交 → `git checkout main && git merge --ff-only claude/clever-nobel-fee210 && git push origin main`;若出现新独有提交,改 merge commit 并在报告说明。

## 明确不做(全部有主)

等你定收件箱(决策源刚出现,随缺口/补拍清单一起做才不是空壳)、正门快剪(独立大切片:auto-editor 移植)、应用内预览(Kdenlive 分块)、选题/素材库/记忆/设置重建(各自蓝本落地时)、拍摄环节与页签虚线语义(拍摄切片)。旧 creation-workbench 的向导与 capture 视图维持可达。

## 不动项

FrozenEditSpec→RenderIR 管线、providers、其余 IPC 契约(load-project 只加字段)、旧组件(除删除 ai-edit-workbench)、tokens 既有令牌。

## 风险与回滚

- 旧剪辑页能力面大 → 以能力对账清单逐项验收,漏一项算门不过;
- 阶段推进误写 → 只前进约束 + 冒烟断言;
- 合并风险低(main 0 独有提交、快进),回滚 = revert 合并前指针(记录合并前 main SHA)。

# V2b：手动脚本、分镜、拍摄包与 Take 工作流

日期：2026-08-14
状态：已完成（本地 Electron/UI smoke 通过）；V2b 不包含 AI 提案、TikHub 或正式剪辑渲染。

## 用户结果

创作者可以在本地工作区内：

```text
编辑口播段落 → 为每段配置镜头/景别/拍法/时长
→ 生成离线 HTML 拍摄包
→ 导入多个 Take（保留原始、代理、缩略图）
→ 选择一个 Take 作为当前版本
```

## 代码范围

- `packages/creation/src/index.ts`：Script/Shot/Storyboard/ShootTask/CapturePackage/Take 合同、HTML 导出、Take attach/select；
- `packages/storage/src/catalog.ts`：本阶段交付时为 schema v3 迁移、创建工作流原子事务、Take 持久化和选择；当前 catalog 已迁移到 schema v6（V4 proposal/render、V6 analysis facts/FTS5、V7 research reports）。
- `electron/main.cjs` / `electron/preload.cjs`：工作区初始化、拍摄包导出、Take 导入、受控文件打开；
- `src/components/creation-workbench.tsx` / `src/app.tsx` / `src/styles.css`：可编辑脚本/分镜工作台和状态反馈；
- `scripts/ui_smoke.py`：保留原首页 smoke；Node Playwright smoke 额外验证创建页的工作区 gate；
- `scripts/provider-smoke.mjs`：Provider 真实联调入口，独立于 V2b。

## 验收与验证

- `npm run typecheck` ✅
- `npm test` ✅（5 files / 19 tests）
- `npm run build` ✅（含桌面 runtime 编译）
- `node --check electron/main.cjs` ✅
- `node --check electron/preload.cjs` ✅
- `npm run start:desktop` ✅ 启动 smoke（手动终止，不把 SIGINT 当业务失败）
- Node Playwright UI smoke ✅：进入“创作项目”、确认标题和工作区 gate、确认未连接工作区时导出按钮 disabled，并保存 `/tmp/creator-copilot-creation.png`。

## 失败路径与当前边界

- 未选择工作区：无法导出，UI 给出选择入口；
- 取消选择文件：不产生 Take；
- 素材导入/数据库写入失败：当前会保留已生成的媒体产物，后续 V2c 增加 orphan artifact GC；
- 工作区/拍摄包使用 workspace-relative path，主进程打开文件前做 lexical + realpath containment；
- 离线拍摄包不依赖手机访问桌面 localhost；二维码/配对 HTTP 后置；
- 尚未提供“重启后从项目列表恢复工作流”的 UI 查询，SQLite 持久化已有测试，V2c 补项目恢复入口；
- 尚未连接 AI、ASR/OCR、TikHub、FrozenEditSpec、RenderIR、剪映/FCPXML。

## 回滚

回滚只需停止使用创建页 IPC；现有首页和 V1/V2a 媒体导入不依赖 V2b 的 UI。schema v3 迁移保持向前兼容，不能用删除数据库的方式回滚；后续 schema v4/v5/v6 同样只能通过迁移或备份恢复回滚。

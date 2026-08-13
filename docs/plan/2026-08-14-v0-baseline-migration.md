# V0-00 Scaffold → Desktop Workspace 基线迁移记录

日期：2026-08-14  
状态：入口迁移第一步已完成；旧根入口保留，尚未删除；`apps/desktop` 仍是兼容壳，不宣称整个代码树已经迁移

## 1. 当前事实

仓库仍以 root `package.json`、npm lockfile、Vite/React renderer 和 Electron CommonJS runtime 工作。当前 macOS arm64 的目录打包、preload IPC、SQLite runtime 和创作 → AI 剪辑 → 导出 UI smoke 已通过。不能因为打包可运行，就把它描述成已经完成的 pnpm monorepo 或 Windows 发布版本。

## 2. 映射表

| 现有 scaffold | 目标位置/边界 | 当前动作 | 删除条件 |
|---|---|---|---|
| `src/main.tsx`、`src/app.tsx`、`src/components/*`、`src/styles.css` | `apps/desktop/renderer` 或后续 `packages/ui` | 先保留 root Vite 入口；`apps/desktop` 只作为桌面入口迁移的目标记录 | 新 renderer 构建、UI smoke 和 preload API 在 clean checkout 通过 |
| `src/lib/api.ts` | `apps/desktop/renderer` 查询 client，写操作走 preload IPC | 不把旧 API client 直接升级为领域事实；现有页面逐步改用 `window.desktop` | 所有生产页面不再依赖 Express scaffold |
| `src/types.ts`、`src/global.d.ts` | `packages/contracts` + renderer-only view model | 已经有部分领域类型在 `packages/*`；逐项迁移并保留兼容类型 | 无生产调用方引用旧重复类型 |
| `electron/main.cjs` | `apps/desktop/main` | 当前由 `apps/desktop/main.cjs` 兼容入口加载，真实逻辑暂保留在旧路径 | main、IPC、worker 和 packaged smoke 全部从新路径直接运行 |
| `electron/preload.cjs` | `apps/desktop/preload` | 当前新路径承载真实 preload；旧路径保留兼容转发 | 所有脚本、构建和发布产物只需要新路径 |
| `electron/analysis-worker.cjs`、`electron/sidecars/*` | `apps/desktop/utility` 与可选 sidecar assets | 暂留旧路径，避免改变已验证的 worker 相对路径和打包规则 | worker 协议、取消、崩溃恢复和 Windows 打包 smoke 通过 |
| `server/index.ts` | 研究/废弃 scaffold，不进入 desktop runtime | 继续保留 `npm run dev:server` 兼容入口；新桌面功能不依赖它 | renderer 不再调用 server，README 和 CI 不再把它当桌面启动方式 |
| root `package.json` + `package-lock.json` | workspace root 或最终 `pnpm-lock.yaml` | 现阶段继续使用 npm，新增入口保留 npm 命令 | pnpm workspace clean checkout、native rebuild、package smoke 全通过 |

## 3. 脚本映射

| 现有命令 | 迁移目标 | 说明 |
|---|---|---|
| `npm run build` | `pnpm --filter desktop build` | 当前 root 命令仍是事实源，迁移期间必须保持等价 |
| `npm run typecheck` | `pnpm typecheck` | 包级 `tsconfig` 逐步接管；不把未编译的 CJS 当作已检查 |
| `npm test` | `pnpm test` | 先保留 root Vitest，迁移后按 package 分片 |
| `npm run package:desktop` | `pnpm --filter desktop package` | 需要 clean checkout 和 native module 重建 smoke |
| `npm run test:desktop:package` | `pnpm --filter desktop test:package` | 至少 macOS arm64，之后增加 Windows x64 |
| `npm run test:desktop:ui` | `pnpm --filter desktop test:ui` | 必须验证实际用户路径和 SQLite render run |
| `npm run dev:web` / `npm run dev:desktop` | `pnpm --filter desktop dev` | 旧命令暂保留，避免贡献者入口断裂 |

## 4. 迁移顺序与回滚

1. 先让 `apps/desktop` 新入口和旧入口同时可启动；不删除 `electron/`、`src/`、`server/` 或 root lockfile。
2. 每迁移一个边界，保留一个兼容 import/entry，并跑 typecheck、unit、package smoke、UI smoke。
3. 若 packaged smoke、native rebuild 或 IPC 行为回归，`package.json.main` 可立即切回 `electron/main.cjs`，无需修改 workspace 数据库或删除用户素材。
4. 删除旧入口前必须有一次 clean checkout 验证、Windows x64 验证和 `git grep` 证明生产代码没有旧边界引用。

## 5. 本阶段验收

- [x] `apps/desktop/main.cjs` 成为 package main 的兼容入口；旧 main 逻辑仍可回滚。
- [x] 新 preload 路径在真实 macOS arm64 packaged UI smoke 中完成 IPC、SQLite 和 AI 剪辑导出闭环。
- [ ] main/preload/utility 逻辑全部迁出旧 `electron/`。
- [ ] root Vite/Express scaffold 完成 workspace package 化。
- [ ] Windows x64 与 clean checkout 验证。

后续施工记录必须引用这份映射，而不是重新猜测 root scaffold 的去向。

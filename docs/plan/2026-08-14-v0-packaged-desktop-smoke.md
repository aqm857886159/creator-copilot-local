# V0 可打包桌面基线：施工记录

日期：2026-08-14  
状态：macOS arm64 目录打包与启动 smoke 已通过；Windows、签名、安装器和 CI 仍待补

## 本次解决的问题

仓库路径包含空格，而 electron-builder 的原生模块重编译会把这个路径传给 node-gyp，导致 `better-sqlite3` 直接失败。不能要求用户把工作区重命名，也不能通过关闭 native rebuild 假装打包成功。

`npm run package:desktop` 现在会：

1. 完成前端、Electron runtime 和各 package 的构建；
2. 把可打包文件复制到无空格临时 staging 目录，并在 staging 内执行隔离的 `npm ci`；
3. 在 staging 内用 Electron 43 arm64 重建 `better-sqlite3`；
4. 生成 `release/mac-arm64/Creator Copilot Local.app`；
5. 修正打包工具产生的内部绝对 symlink，避免 staging 删除后 framework 断链；
6. 删除 staging，不把临时目录或密钥带入仓库。

## 可复现命令

```bash
npm run test:desktop:package
```

该命令会生成目录应用并运行 `scripts/desktop-package-smoke.mjs`。smoke 启动打包后的应用，验证：

- `contextIsolation` / preload 暴露的 `desktop:get-info` IPC 能返回平台和架构；
- 打包后的 `dist-electron` runtime 可以加载；
- 打包后的 `better-sqlite3` 可以创建 catalog 并执行 schema migration；
- 当前 macOS arm64 产物返回 `schemaVersion=7`。

分析 utility worker 已增加 packaged runtime 路径兼容（`app.asar` / `app.asar.unpacked`），但本次 smoke 尚未把 worker 执行标记为通过；它会在下一条独立媒体 worker smoke 中验证。

staging 不复用根目录 `node_modules`，避免 Electron ABI 重编译污染本地 Node/Vitest 的 `better-sqlite3`；package smoke 后根目录 Node ABI 测试仍可通过。

本次实际结果：

```json
{"ok":true,"smoke":"preload-ipc+runtime-sqlite","platform":"darwin","arch":"arm64","schemaVersion":7}
```

## 安全和打包边界

- renderer 仍然只通过 preload allowlist 访问 main；
- `.env` 不在 electron-builder `files` 列表中；
- macOS 当前是未签名目录产物，仅用于本地 smoke；
- 生产发布还需要代码签名、公证、自动更新和模型/FFmpeg/字体的供应链清单。

## 未完成的 V0 门

- Windows x64 目录打包和启动 smoke；
- macOS DMG/安装器、签名、公证；
- CI 上的 clean checkout + `npm ci` + package smoke；
- utility worker 在打包后执行真实分析任务的 smoke；
- 目标 monorepo/pnpm 迁移和旧 Express scaffold 的淘汰记录。

因此本记录只把“macOS arm64 可打包、preload IPC 和 SQLite runtime 可启动”标记为已验证，不把 V0 全部宣称完成。

# Creator Copilot Local

本地优先的内容创作助手，首个工作流聚焦抖音真人深度口播：研究、选题、脚本、分镜、拍摄包、素材库、AI 粗剪、导出和复盘。

当前仓库处于 V0–V8 逐步施工中：已提供 React UI、Electron main/preload 安全边界、SQLite catalog、本地媒体管线、AI 粗剪、TikHub 研究、交换格式、发布包和复盘页面。仍未完成的能力以实施计划和施工记录为准，不把开发壳 smoke 当成跨平台发布完成。

## 本地运行

```bash
npm install
npm run dev:web
```

打开 `http://127.0.0.1:4316` 可以预览 UI。Electron 壳需要先完成 Electron 二进制安装后运行：

```bash
npm run dev:desktop
```

云端能力默认关闭。将 `.env.example` 复制为本地 `.env` 后可配置 TikHub/APIMart；密钥只由 Electron main 和受控联调脚本读取。`AI_EDIT_PROVIDER=apimart` 会启用 AI SDK 结构化剪辑提案，`AI_EDIT_PROVIDER=local-fallback` 保持完全离线。

## 文档入口

- [PRD](docs/PRD-v0.2-Workflow-and-Scope.md)
- [技术实施计划](docs/Implementation-Plan-v0.2.md)
- [用户旅途坏路径测试](docs/User-Journey-Failure-Test-Cases-v0.1.md)
- [Agent 技术栈 CTO 评审](docs/Agent-Stack-CTO-Review-v0.1.md)
- [数据库选型 ADR](docs/Database-Decision-ADR-v0.1.md)
- [Provider 官方接入与小额联调记录](docs/Provider-Official-Integration-Research-v0.1.md)
- [选题雷达垂直切片施工记录](docs/plan/2026-08-14-v7-topic-radar.md)

## 验证

```bash
npm run typecheck
npm test
npm run build

# macOS arm64 目录打包 + preload/SQLite 启动 smoke
npm run test:desktop:package
```

打包产物位于 `release/`，仅为本地未签名目录产物。

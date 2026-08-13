# Creator Copilot Local

本地优先的内容创作助手，首个工作流聚焦抖音真人深度口播：研究、选题、脚本、分镜、拍摄包、素材库、AI 粗剪、导出和复盘。

当前仓库处于 V0 基线阶段：已提供可运行的 React UI 壳、Electron main/preload 安全边界和实施文档；领域数据库、媒体管线和 AI Provider 将按实施计划逐阶段接入。

## 本地运行

```bash
npm install
npm run dev:web
```

打开 `http://127.0.0.1:4316` 可以预览 UI。Electron 壳需要先完成 Electron 二进制安装后运行：

```bash
npm run dev:desktop
```

## 文档入口

- [PRD](docs/PRD-v0.2-Workflow-and-Scope.md)
- [技术实施计划](docs/Implementation-Plan-v0.2.md)
- [用户旅途坏路径测试](docs/User-Journey-Failure-Test-Cases-v0.1.md)
- [Agent 技术栈 CTO 评审](docs/Agent-Stack-CTO-Review-v0.1.md)
- [数据库选型 ADR](docs/Database-Decision-ADR-v0.1.md)

## 验证

```bash
npm run typecheck
npm test
npm run build
```

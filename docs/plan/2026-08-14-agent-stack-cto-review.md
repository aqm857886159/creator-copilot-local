# Agent 技术栈 CTO 评审计划

日期：2026-08-14  
状态：已完成调研，待把结论落入实施基线

## 范围

- 核实 e-cut 中 “Mastra” 的真实使用方式，而不是只看依赖名；
- 对比当前 TypeScript Agent 方案：Mastra、Vercel AI SDK、LangGraph.js、OpenAI Agents SDK；
- 评估 Electron、本地 SQLite、Provider-agnostic、MCP、人工审批、长任务恢复和开源边界下的适配性；
- 给出最终采用方案、禁止的用法、版本锁定、迁移路径和安全门。

## 不动项

- Agent 不能成为账号、素材、时间线、发布和复盘事实库；
- Agent 不能绕过 `Command Registry`、revision、审批和 Job/outbox；
- 媒体导入、ASR、OCR、渲染和发布不能依赖 Agent 运行时保持内存状态；
- 不把 Mastra Cloud、Enterprise 目录或任何托管服务作为本地开源产品的必需依赖。

## 主要风险

- Mastra 和 AI SDK 都在快速迭代，API/版本变化快；
- Mastra 2026-06-16 曾发生 npm 供应链攻击，依赖不能使用 `latest`；
- Mastra 的默认 memory/storage 语义可能与我们的领域事实和本地 SQLite 产生双写；
- AI SDK 7 的 `WorkflowAgent` 和 Mastra durable workflow 都可能与已有 Job/outbox 重复；
- MCP/Provider 的模型能力差异会导致同一个工具在不同模型上表现不一致。

## 验收门

1. 评审能区分 Agent runtime、Provider runtime、Domain/Command 和 Job/Worker 四个边界；
2. 方案明确哪些功能由 Mastra 提供、哪些必须由项目自有代码提供；
3. Agent 可在 Electron main/worker 中运行，renderer 不加载 Agent 框架和密钥；
4. agent-runtime 数据库与内容事实库隔离，重启、审批、取消和恢复都有可追踪状态；
5. 依赖版本、许可证、供应链检查和升级策略写入工程规则；
6. 至少有一个账号分析、一个分镜生成和一个 AI 粗剪提案通过真实 Tool/Command contract fixture。

## 回滚

本轮只修改架构/研究文档，不修改运行时代码。若实施阶段发现 Mastra 版本或 Electron 打包不适配，可保留相同的 `AgentRuntimePort`，替换 Mastra adapter 为 AI SDK 7 原生 loop，不影响 Domain、Command、Provider 和 RenderIR。

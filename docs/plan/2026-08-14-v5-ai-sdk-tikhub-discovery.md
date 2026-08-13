# V5 AI SDK 与 TikHub 发现能力实施计划

日期：2026-08-14  
状态：本切片已完成；选题雷达 UI/IPC 已在 v7 topic radar 切片完成

## 目标

把模型调用和 TikHub 发现接口接入现有本地事实链，同时保持三个边界：凭证只在 Electron main/本地脚本；AI 只生成可审阅的剪辑提案；任何 TikHub 计费动作先读取动态价格并由用户显式触发。

## 本次范围

- 使用官方 Vercel AI SDK 7 与 `@ai-sdk/openai-compatible` 接 APIMart；
- 通过 `Output.object({ schema })` 生成并校验 `EditProposalDraft`；
- 保留现有 HTTP adapter 和纯本地提案器作为回退；
- 增加 TikHub 动态端点价格读取；
- 增加低粉爆款、高完播榜和搜索热榜的受限 connector；
- 将官方端点、参数、动态价格差异和本次小额 smoke 写入 Provider 研究文档。

## 不在本次范围

- 不自动周期抓取，不批量下载视频；
- 不把榜单结果直接晋升为选题结论或创作记忆；
- 不启用 Mastra Memory/MCP、多 Agent 或自动工具调用；
- 不运行图片、视频、TTS、音色克隆、数字人等高成本生成任务；
- 不把 API key 写入代码、文档、fixture、日志或 renderer。

## 风险与防护

- AI SDK 与 OpenAI-compatible 网关的结构化输出能力可能因模型不同而变化：mock 先测请求体和 Schema 拒绝，真实 smoke 只跑一次低成本请求，失败不自动重试。
- TikHub 静态文档价格可能滞后：执行前用 `get_endpoint_info` 读取动态价格，保存价格快照与时间。
- 榜单返回是平台信号，不是事实结论：只保存来源、窗口、过滤条件、作品 ID 和响应 hash。
- 临时链接与公开内容仍有权利边界：默认 metadata-only，下载必须单独确认。

## 验收门

1. AI SDK mock 证明只发一次请求、包含 JSON Schema、无效对象被拒绝；
2. AI SDK 产物仍经过素材白名单和时间码校验，不能引用未确认素材；
3. TikHub connector 拒绝 `pageSize > 20`，能归一化低粉榜与搜索热榜 fixture；
4. 动态端点价格读取不需要把凭证送进 renderer；
5. `npm run typecheck`、`npm test`、`npm run build` 通过；
6. 真实联调总成本保持在美分以内，输出只包含状态、数量、字段结构和脱敏元数据。

## 回滚

- 将 `AI_EDIT_ADAPTER=http` 切回原有 HTTP adapter；
- 将 `AI_EDIT_PROVIDER=local-fallback` 完全关闭云端提案；
- TikHub 发现 connector 没有 UI 自动入口，移除调用方即可停止计费，不影响账号研究和本地媒体链。

## 实施结果

- 引入 `ai@7.0.65` 与 `@ai-sdk/openai-compatible@3.0.30`；
- AI SDK 结构化提案已接入 Electron main，默认只在 `AI_EDIT_PROVIDER=apimart` 且存在本地凭证时启用；
- 发现并修复 APIMart 省略 `stream:false` 时返回 SSE 的协议差异；
- 增加 TikHub 动态价格、低粉爆款、高完播和搜索热榜 adapter；
- 完成基础 Provider/Agent 合同测试、TypeScript 检查和生产构建；测试总数以当前 `npm test` 输出为准，不把测试数量写死为历史快照；
- macOS arm64 打包后 `preload-ipc+runtime-sqlite` smoke 通过，证明新增 AI SDK 依赖可被 packaged runtime 加载；
- 完成一次真实 AI SDK 单镜头提案（1 个操作、0 个缺口）以及总计约 `$0.005` 的 TikHub 榜单字段 smoke；未调用图片、视频、语音或批量下载。

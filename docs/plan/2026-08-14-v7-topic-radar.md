# V7 选题雷达垂直切片计划

日期：2026-08-14
状态：本切片已完成；真实付费联调仍按小额、显式环境变量和本文件边界执行；账号研究页已补齐“结论—证据—本地事实数量”的可见回溯

## 用户结果

用户选择低粉爆款、高完播或搜索热榜，输入可选关键词与时间窗，先看到 TikHub 动态报价；明确确认后才发出计费请求。结果保存为本地证据报告，并生成可继续研究的候选选题，而不是自动改写脚本或创作记忆。

## 本次范围

- `packages/research`：TopicRadarQuery/Quote/Report/Signal/Opportunity 合同及确定性归一化；
- `packages/storage`：schema v8、报告持久化、计费 Job 恢复状态；
- Electron main/preload：报价、确认执行、历史读取 IPC；
- renderer：`TopicRadarWorkbench` 的配置、报价确认、结果、部分失败和历史状态；
- mock/provider/domain/storage/UI 用户旅途验证；账号研究结果页按每条 finding 展示证据标签和可读摘要，每个已分析作品显示已回挂的时间码事实数量。

## 不在本次范围

- 不做后台定时抓取、无限翻页、视频自动下载；
- 不调用 LLM 生成选题文案；
- 不把候选机会自动晋升为 Topic/Project/ReviewMemory；
- 不处理星图、评论全文、多关键词指数等更高成本接口；
- 不把 Provider 原始响应或临时 URL写入 UI 事实。

## 交互合同

- idle：可选择 1–3 个来源，填写关键词、时间窗和每源条数；
- quote-loading：禁用价格按钮，保留表单内容；
- quoted：显示逐项价格、总价、有效期、范围与“调用开始后不能撤销已发请求”；
- stale：表单任一条件变化即清除旧报价，必须重新报价；
- running：确认按钮禁用，防止重复提交；
- success/partial/failed：展示来源运行状态、候选机会和证据数量；
- submission-unknown：明确提示不会自动重试，用户先核对用量再决定是否新建请求；
- empty：说明没有命中，不伪造选题；
- keyboard/accessibility：字段有可见标签，来源使用 checkbox，状态不仅依靠颜色，按钮具有 focus-visible 和 loading 文案。

## 计费与恢复边界

每个真实来源调用对应一个 catalog Job。请求发出前写入本地 submission marker；若进程在响应前退出，lease 恢复为 `needs_attention`，不会自动重新付费。已知 Provider 错误进入 `failed`，网络/超时进入 `submission_unknown`。报价 token 单次使用、绑定 workspace 和查询条件，重启后失效是安全默认。

## 验收门

1. 报价 token 单次使用，过期/跨工作区/条件变化均拒绝；
2. pageSize 最大 20、来源去重、未知字段拒绝；
3. paid Job 在发请求前记录 submission marker，崩溃恢复不回到自动队列；
4. 成功、部分失败、全失败和 submission_unknown 都能持久化报告；
5. 新项目 → 选题库 → 配置 → 报价 → 确认 → 看到候选与证据的界面旅途可运行；
6. typecheck/test/build、Electron CJS syntax、macOS packaged smoke 通过（当前仓库测试总数以命令输出为准，不能替代真实 Provider 计费状态验证）；
7. 对标账号页的每条结论都能回溯到本地报告 evidence；媒体模式摘要明确作品数、镜头数、ASR/OCR 数量，并标注“样本描述而非因果结论”。

## 回滚

- 移除 renderer 入口和三个 IPC 即可关闭所有真实调用；
- schema v8 只新增表，不修改旧表或旧报告；
- TikHub connector 与账号研究链保持独立，选题雷达失败不阻塞本地脚本/拍摄/AI 粗剪。

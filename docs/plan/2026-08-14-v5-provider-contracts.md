# V5 Provider 合同与小额联调边界

日期：2026-08-14  
状态：合同与 mock 已完成；尚未把真实请求接入 UI/调度器

## 1. 目标

把 APIMart 的文本/模型目录和 TikHub 的抖音公开研究接口放到可替换的 main-process adapter 中。领域层只接收归一化对象，不依赖供应商字段、临时 URL 或原始响应。

本切片不做默认批量抓取、不做图片/视频生成、不做自动发布；真实调用只允许由显式用户动作触发，并受到数量、超时、取消和成本门控制。

## 2. 已实现合同

`packages/providers/src/index.ts` 提供：

- `ProviderPort`：`listModels / getCapabilities / chat`；
- `ProviderError`：`invalid/auth/quota/rate_limit/timeout/provider/network/capability` 归一化，带 `retryable`、HTTP 状态和脱敏 request ID；
- `ModelDescriptor` 与能力来源 `declared/inferred/static_fallback`；
- `StructuredChatRequest`：限制消息数量、token、温度和超时，拒绝未知字段；
- `ApiMartClient`：官方 `/v1/models?expand=true` 和 `/v1/chat/completions`；
- `ResearchConnector`：TikHub profile/posts metadata 的中性端口；
- `TikHubDouyinConnector`：官方 `get_sec_user_id`、App V3 账号资料和用户作品分页，分页数量强制 1–20。

## 3. 数据与密钥边界

- adapter 只在 Electron main/worker 使用，renderer 不接触 API key；
- 测试只使用 mock `fetcher`，断言请求体和错误合同，不把真实 key 写入测试；
- 原始响应仅用于计算 `responseHash` 或证据留存，由后续 Job 决定是否限量保存；
- TikHub 返回的公开作品先保存 metadata evidence；下载视频、ASR/OCR/视觉分析必须是下一次用户确认动作；
- APIMart model catalog 的能力字段不稳定时，`capabilitySource` 会显示 `inferred`，不把缺失字段当成事实。

## 4. 验收

```bash
npm run typecheck
npm test
npm run test:providers:live       # 仅健康/凭证/模型目录，无生成任务
```

当前 mock gate：

- APIMart 模型目录和结构化 chat 正常归一化；
- APIMart 401 映射为 `auth` 且不可重试；
- TikHub URL → `sec_user_id` → profile → 20 条以内作品页；
- `count > 20` 在发送网络请求前拒绝；
- API key 不出现在请求日志/测试输出；
- provider 响应包含 `responseHash`，但业务层不接触原始供应商 JSON。

真实 smoke 仍使用 [Provider-Official-Integration-Research-v0.1.md](../Provider-Official-Integration-Research-v0.1.md) 中的脚本和预算范围；它不是合同测试的替代品。

## 5. 下一步

1. 在 main 增加“凭证已配置/余额或用量摘要”只读状态，绝不回传 key；
2. 为 `edit.propose` 增加一个 mock Agent handler，输出严格 `EditProposal`；
3. 让 AI 粗剪页面显示候选镜头、证据、置信度、缺口和预计调用成本；
4. 用户批准后调用 V3 reference render kernel；
5. 只有上述 UI 闭环通过后，再对一个明确账号做 TikHub 20 条 metadata 小窗口真实联调。

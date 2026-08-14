# Provider 小额真实联调规则 v0.1

日期：2026-08-14  
状态：已获项目负责人明确授权；默认仍然关闭真实付费调用

这份文件是本项目以后执行 APIMart / TikHub 真实测试的唯一操作约束。它记录“可以测什么、一次最多测多少、如何留证、如何避免重复扣费”，不记录任何 API key、账户余额、原始响应或用户素材。

## 1. 密钥边界

- 密钥只允许放在本机未跟踪的 `.env` 或进程环境变量中；当前仓库的 `.gitignore` 已忽略 `.env`。
- Electron 只由 main process 读取密钥；renderer、Vite `import.meta.env`、SQLite 项目 JSON、日志、截图和测试 fixture 均不得出现密钥。
- 日志只能输出 `providerKey`、endpoint、请求目的、数量、状态、脱敏响应 hash 和估算成本；禁止输出 `Authorization`、完整 URL query 中的敏感字段、余额、邮箱和原始响应。
- 如果密钥曾经进入公共聊天、截图或日志，应在供应商后台轮换；本项目不把聊天中的密钥复制到代码或文档。

## 2. 默认额度闸门

除非用户在当前任务中再次明确扩大范围，所有真实联调都遵守以下上限：

| Provider | 默认允许 | 单次任务硬上限 | 默认禁止 |
| --- | --- | --- | --- |
| TikHub | 健康检查、账户/端点信息、动态报价、模型/能力目录 | 计费请求最多 5 次；账号研究最多 1 个账号、首批最多 20 条作品；预计 TikHub 费用不超过 `$0.02` | 批量下载、批量评论/粉丝、星图画像、登录/二维码、后台循环、跨账号批量抓取 |
| APIMart | 模型目录、余额查询、文本结构化 smoke | 文本最多 3 条请求；预计费用不超过 `$0.20`；`maxRetries=0` | 图片、视频、音频、TTS、音色克隆、数字人和任何异步媒体生成 |

任何一次调用前，脚本必须先做以下检查：

1. 能用 mock/fixture 验证的，不发真实请求；
2. TikHub 先读取 endpoint info / calculate price，再决定是否计费；
3. APIMart 先读取模型目录和余额，结构化输出只发最短脱敏文本；
4. 任务开始前记录预计请求数、预计费用和停止条件；达到上限立即停止；
5. 真实响应立即归一化并计算 hash，临时媒体 URL 立即本地化，不把 URL 当永久资产。

## 3. 推荐的测试层级

```text
contract fixture
  → mock provider (成功/空结果/超时/401/402/429/schema fail)
  → metadata-only live smoke
  → 单次小额业务 live smoke
  → 用户明确确认后才做媒体生成或批量研究
```

当前可复用的命令：

```bash
# 只读/低风险：健康、凭证状态、动态报价、模型目录
PROVIDER_LIVE_TESTS=1 npm run test:providers:live

# TikHub 单次榜单/账号研究；必须显式打开，脚本有数量闸门
PROVIDER_LIVE_TESTS=1 PROVIDER_DISCOVERY_SMOKE=1 npm run test:providers:live
PROVIDER_LIVE_TESTS=1 PROVIDER_BILLED_SMOKE=1 npm run test:providers:live

# APIMart 只做一条结构化文本提案；不做图片/视频/音频生成
AGENT_SCRIPT_LIVE=1 npm run test:script:live
```

不要用 `curl` 或临时脚本绕过这些命令的额度检查。若要新增 endpoint，先把官方文档 URL、参数 schema、价格读取方式、上限和清理动作写入 `docs/Provider-Official-Integration-Research-v0.1.md`，再补 mock fixture，最后才允许一次真实 smoke。

## 4. 证据与回滚

每次真实测试都要留下脱敏记录：日期、provider、endpoint、目的、请求数量、预计/实际费用（若供应商返回）、状态、response hash、是否产生本地 Artifact、清理结果。失败时保存归一化错误和 `request_id` 的 hash，不保存原始鉴权响应。

出现以下任一情况时立即停止并转人工确认：费用字段无法读取、响应状态为 `submission_unknown`、供应商重复提交、临时 URL 无法下载、返回内容含未授权的私密数据、或实际请求数超过预估。不得为了“重试看看”自动再次发起可能计费的请求。

## 5. 官方来源（核对日期：2026-08-14）

- [TikHub 官方文档索引](https://docs.tikhub.io/llms.txt)
- [TikHub 用户信息](https://docs.tikhub.io/186826050e0)
- [TikHub 动态端点信息](https://docs.tikhub.io/186826054e0)
- [TikHub 价格计算](https://docs.tikhub.io/186826052e0)
- [TikHub App V3 用户作品分页](https://docs.tikhub.io/362985064e0)
- [APIMart 官方文档索引](https://docs.apimart.ai/llms.txt)
- [APIMart Quick Start](https://docs.apimart.ai/en/quickstart)
- [APIMart Chat Completions](https://docs.apimart.ai/en/api-reference/texts/general/chat-completions)
- [APIMart 非流式 Chat Completions](https://docs.apimart.ai/en/api-reference/texts/general/chat-completions-nostream)

官方文档会变动；价格、模型能力、参数和 URL 有效期都必须在真实调用前重新读取，历史记录不能当作当前报价。

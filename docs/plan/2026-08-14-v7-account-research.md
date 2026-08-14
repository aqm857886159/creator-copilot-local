# V7：对标账号证据雷达（metadata-first）

日期：2026-08-14  
状态：metadata-first、选中作品本地化、本地镜头分析 Job、逐作品时间线（镜头/ASR/OCR）、跨作品模式摘要、基于证据的待审阅选题切入、账号聚合表现补充和“报价后确认补齐播放统计”已实现；中文 ASR/OCR 仍按能力配置后置；已补受控真实账号链路 smoke

## 产品名称与用户结果

用户看到的功能名是“对标账号雷达”，不是“TikHub 调试器”。它解决的第一步是：输入一个抖音主页链接或 `sec_user_id`，在可控成本内得到一个可追溯的账号快照，并知道下一步应该选哪些作品做深度拆解。

首轮结果：

```text
主页链接 / sec_user_id
→ 解析稳定账号 ID
→ 账号资料快照
→ 最新 10/20 条作品元数据
→ 统计覆盖范围、来源证据和缺口
→ 用户可选择“补齐播放统计”，先读动态报价再确认
→ 用户明确选择 1–5 条
→ 调用高画质链接接口并立即本地化
→ 写入素材库、代理、缩略图和 artifact ID
→ 创建/恢复本地分析 Job
→ FFmpeg 镜头粗切；ASR/OCR 按配置执行
```

“分析几十条”是研究目标，不等于首次点击就下载和调用视觉模型几十次。首轮先用便宜、可缓存的元数据筛选价值，再增量分析；任何付费动作都要有用户确认、预计请求数和可取消状态。

## 已实现代码路径

- `packages/research/src/index.ts`：`AccountResearchReport`、`ResearchEvidence`、`BenchmarkVideo` 合同和 metadata-first 报告构建器；所有外部 URL 只接受 `http/https`，不把临时 URL当本地资产。
- `packages/storage/src/catalog.ts`：schema v6 的 `research_reports` 表及保存/读取/列表 API。
- `apps/desktop/main.cjs`：`desktop:research-account`，凭证只在 main 进程读取，报告写入当前工作区 catalog。
- `apps/desktop/main.cjs`：`desktop:download-research-media`，一次最多 5 条，逐条下载、导入、代理化、缩略图化；局部失败不回滚已成功素材。
- `apps/desktop/main.cjs`：`desktop:analyze-research-media`，为每条作品创建或恢复 `media.analysis` Job，取得 lease 后由 `apps/desktop/analysis-worker.cjs` 执行 FFmpeg/ASR/OCR，main 只回写事实和 Job receipt；没有中文模型时保留 partial 状态，不伪造 ASR/OCR。
- `packages/research/src/index.ts`：将选中作品的本地事实聚合成描述性账号模式（镜头数量/平均时长、ASR 段数、OCR 条数和开头样本），每条结论关联 `media_fact` evidence；它只描述样本，不把相关性说成因果。
- `packages/research/src/index.ts`：每条已分析作品现在保存 `analysis.timeline`，按镜头时间段挂接 ASR 和 OCR 文本，并保留缺失能力；根据已观察事实生成 `AccountResearchOpportunity` 候选，明确标记为待审阅假设，不自动进入选题库或脚本。
- `packages/research/src/index.ts`：跨作品模式摘要现在保存每条作品的镜头数量、平均/首镜头时长、短镜头比例、ASR/OCR 覆盖、开头文本和可用播放量排序；若有播放量，会把最高样本与其他样本的镜头节奏做描述性对照，并在 evidence/finding 中保留“非因果结论”声明。
- `packages/providers/src/index.ts` + `apps/desktop/main.cjs`：TikHub 批量作品统计只在用户确认报价后调用，最多 50 条；返回的播放/点赞/下载/分享数字写回报告为 `metric` evidence，空结果和部分结果不自动重试。
- `packages/providers/src/index.ts` + `apps/desktop/main.cjs`：TikHub `fetch_hot_account_item_analysis_list` 以 1–30 天为界读取账号聚合表现；同样经过报价→确认门，返回数字写入 `account_analysis` evidence，不把聚合基准误写成单条作品因果结论。
- `apps/desktop/renderer/components/account-radar-workbench.tsx`：账号输入、10/20 条范围、覆盖状态、作品选择、显式本地化动作、逐作品“查看拆解”时间线和证据驱动的切入假设展示。
- `packages/providers/src/index.ts`：TikHub `ResearchConnector`，将 provider 响应归一化为 profile/posts 页面。

## 官方接口事实（2026-08-14 核对）

来自 [TikHub 官方文档](https://docs.tikhub.io/)：

- `fetch_user_post_videos` 使用 `sec_user_id`、`max_cursor`、`count`、`sort_type`；官方要求 `count` 不超过 20，第一页游标为 0，并提示请求会计费。
- `fetch_video_high_quality_play_url` 用于取得原始上传画质播放链接；官方页面标注价格为 `$0.005/次`，支持 `aweme_id`、可选 `share_url` 和地区参数。产品只在用户点击“下载并拆解选中作品”后调用，并把返回的临时 URL直接下载到本地，不保存为资产路径。
- `fetch_multi_video_statistics` 是批量播放统计接口；[官方批量统计文档](https://docs.tikhub.io/256258480e0) 当前写明一次最多 50 个 `aweme_ids`、固定价格 `$0.025/次`，返回字段可能为空。产品仍在运行前读取 endpoint-info 作为实时价格来源，并要求用户确认报价后才调用。
- `fetch_hot_account_item_analysis_list` 是账号作品分析接口；[官方文档](https://docs.tikhub.io/252393848e0) 要求 `sec_uid`，`day` 默认 7 天，返回账号作品聚合分析，官方响应明确提示会计费。产品把它定位为“近 7 日表现基准”，不替代逐作品播放统计和本地镜头事实。
- 账号资料、单作品、作品统计、最高画质播放链接是独立接口；不能把作品列表返回当作已完成播放量、媒体下载或镜头分析。
- 临时结果 URL 和公开内容权限需要记录来源、抓取时间、过期时间和失败原因；私密内容不进入事实库。
- 账号近 7 日表现分析是独立的付费聚合接口；用户必须先看到报价并确认，返回的 `avg_*` / `percentile_*` 数字才会写入账号报告。
- 官方目录还提供热搜、话题、音乐、榜单、评论、粉丝和星图等接口。它们是后续“热点/选题雷达”的候选连接器，不放入首轮默认请求，避免成本和合规边界失控。

## 受控真实联调（2026-08-14）

真实联调只验证“账号资料 + 最新 1 条作品元数据”的第一段链路，不下载视频、不调用高画质接口、不翻第二页。脚本先通过官方 `get_endpoint_info` 读取两条端点的动态价格，超过本次预算就中止；执行还需要第二个显式确认变量，避免后台或 CI 误触付费：

```bash
ACCOUNT_RESEARCH_LIVE=1 \
ACCOUNT_RESEARCH_CONFIRM=1 \
ACCOUNT_RESEARCH_MAX_COST_USD=0.02 \
npm run test:account-research:live

# 可选：在审阅动态报价后，仅调用 1 次近 7 日账号聚合分析
ACCOUNT_RESEARCH_LIVE=1 \
ACCOUNT_RESEARCH_CONFIRM=1 \
ACCOUNT_ANALYSIS_BILLED_SMOKE=1 \
ACCOUNT_RESEARCH_MAX_COST_USD=0.02 \
npm run test:account-research:live
```

脚本为 `scripts/account-research-smoke.mjs`。输出只包含请求数量、动态报价、字段是否存在、结果数量和响应 hash，不打印 API key、`sec_user_id`、昵称或原始响应。2026-08-14 真实运行基础链路报价为 `$0.002`，资料接口返回成功且能读到 `data.user` 中的公开账号字段；选用的 smoke 账号本次作品接口返回 0 条，因此结果标记为 `metadata_only`，不能把它当作“有作品样本”的质量证据。同日按动态报价 `$0.001` 受控调用一次账号作品分析接口，确认真实响应位于嵌套 `data.data`，返回 `avg_*` / `percentile_*` 数字和 `BaseResp`；代码只保留前两类数字并计算响应 hash，不落原始响应。这个 smoke 证明的是供应商合同和归一化字段可用，不证明抖音账号研究已经完成；后续深度拆解仍须用户选择作品后才调用高画质下载和本地 ASR/OCR/镜头分析。

详细端点、APIMart 统一模型网关和小额联调记录集中在 [`Provider-Official-Integration-Research-v0.1.md`](../Provider-Official-Integration-Research-v0.1.md)。后续测试脚本只能从 `.env` 读取本机凭证，不得把 key 写入 fixture、日志或 UI。

## 失败路径与验收

| 情况 | 用户看到的结果 | 数据规则 |
| --- | --- | --- |
| 链接无法解析 | 明确提示改粘贴主页链接或 `sec_user_id` | 不创建空报告 |
| 401/403/402/429/超时 | 显示归一化错误、是否可重试和范围 | 不把失败响应当研究事实 |
| 作品数量少于请求 | 展示 `received/requested` 与 `hasMore` | 保留 coverage evidence |
| 作品缺分享链接/封面 | 仍保留 metadata-only 卡片 | 不伪造 URL |
| 用户尚未选择作品 | 显示“待选中本地化”缺口 | 不自动下载或调用视觉模型 |
| 只成功下载部分作品 | 显示成功/失败数量 | 已成功 artifact 保留；失败作品标记可重试，不重复成功项 |
| ASR/OCR 模型未配置 | 显示“部分完成” | 镜头事实可用；Job 成功但明确记录 ASR/OCR 缺口 |
| 用户展开未完成作品 | 显示已有镜头/事实数量和缺失能力 | 不展示空的“AI 文案”或编造视觉结论；允许稍后重试 |
| 进程重启 | 报告从 catalog 重新打开 | 不重新扣费 |
| 统计报价过期或应用重启 | 提示重新报价，不执行接口调用 | 报价令牌只保存在当前主进程内；已消耗报价不会自动重试 |
| 统计接口只返回部分作品 | 报告显示已补齐数量和缺失作品 ID | 已返回的数字写入 `metric` evidence，缺失项留待用户重新发起新报价 |
| 账号分析返回空数据 | 显示本次没有可用聚合基准 | 报价已消耗，不自动重试；已有报告保持不变 |

当前验收门：`npm run typecheck`、`npm test`、`npm run build`；研究报告必须通过 schema、重启读取和 1–20 数量边界测试。真实联调只做健康、凭证和单账号小样本，禁止批量抓取。

## 下一步（不阻塞主链）

1. 接 Apple Vision 或 RapidOCR/PaddleOCR 的本地 adapter，补齐 OCR `AnalysisFact`。
2. 配置一个中文 whisper.cpp 模型，记录模型许可证、hash、内存和 CER；把 transcript facts 与镜头事实一起回挂 `awemeId + artifactId + time range`。
3. 在已完成的事实之上增加跨作品的结构聚类和视觉语义模式（当前机会只来自单作品时间码事实，VLM/语义模式后置）。
4. 另建热点/榜单连接器，使用缓存和预算门，不把 TikHub 的所有接口直接暴露给 Agent；批量统计仍保持“报价→确认→单次调用”门。

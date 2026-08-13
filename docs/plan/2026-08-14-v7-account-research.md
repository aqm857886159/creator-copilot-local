# V7：对标账号证据雷达（metadata-first）

日期：2026-08-14  
状态：首个可用切片已实现；作品媒体下载与 ASR/OCR/镜头拆解后置

## 产品名称与用户结果

用户看到的功能名是“对标账号雷达”，不是“TikHub 调试器”。它解决的第一步是：输入一个抖音主页链接或 `sec_user_id`，在可控成本内得到一个可追溯的账号快照，并知道下一步应该选哪些作品做深度拆解。

首轮结果：

```text
主页链接 / sec_user_id
→ 解析稳定账号 ID
→ 账号资料快照
→ 最新 10/20 条作品元数据
→ 统计覆盖范围、来源证据和缺口
→ 用户选择 3–5 条
→ 后续才下载临时媒体 URL并做本地 ASR/OCR/镜头分析
```

“分析几十条”是研究目标，不等于首次点击就下载和调用视觉模型几十次。首轮先用便宜、可缓存的元数据筛选价值，再增量分析；任何付费动作都要有用户确认、预计请求数和可取消状态。

## 已实现代码路径

- `packages/research/src/index.ts`：`AccountResearchReport`、`ResearchEvidence`、`BenchmarkVideo` 合同和 metadata-first 报告构建器；所有外部 URL 只接受 `http/https`，不把临时 URL当本地资产。
- `packages/storage/src/catalog.ts`：schema v6 的 `research_reports` 表及保存/读取/列表 API。
- `electron/main.cjs`：`desktop:research-account`，凭证只在 main 进程读取，报告写入当前工作区 catalog。
- `src/components/account-radar-workbench.tsx`：账号输入、10/20 条范围、覆盖状态、最新作品和证据缺口展示。
- `packages/providers/src/index.ts`：TikHub `ResearchConnector`，将 provider 响应归一化为 profile/posts 页面。

## 官方接口事实（2026-08-14 核对）

来自 [TikHub 官方文档](https://docs.tikhub.io/)：

- `fetch_user_post_videos` 使用 `sec_user_id`、`max_cursor`、`count`、`sort_type`；官方要求 `count` 不超过 20，第一页游标为 0，并提示请求会计费。
- 账号资料、单作品、作品统计、最高画质播放链接是独立接口；不能把作品列表返回当作已完成播放量、媒体下载或镜头分析。
- 临时结果 URL 和公开内容权限需要记录来源、抓取时间、过期时间和失败原因；私密内容不进入事实库。
- 官方目录还提供热搜、话题、音乐、榜单、评论、粉丝和星图等接口。它们是后续“热点/选题雷达”的候选连接器，不放入首轮默认请求，避免成本和合规边界失控。

详细端点、APIMart 统一模型网关和小额联调记录集中在 [`Provider-Official-Integration-Research-v0.1.md`](../Provider-Official-Integration-Research-v0.1.md)。后续测试脚本只能从 `.env` 读取本机凭证，不得把 key 写入 fixture、日志或 UI。

## 失败路径与验收

| 情况 | 用户看到的结果 | 数据规则 |
| --- | --- | --- |
| 链接无法解析 | 明确提示改粘贴主页链接或 `sec_user_id` | 不创建空报告 |
| 401/403/402/429/超时 | 显示归一化错误、是否可重试和范围 | 不把失败响应当研究事实 |
| 作品数量少于请求 | 展示 `received/requested` 与 `hasMore` | 保留 coverage evidence |
| 作品缺分享链接/封面 | 仍保留 metadata-only 卡片 | 不伪造 URL |
| 用户尚未选择作品 | 显示“待媒体拆解”缺口 | 不自动下载或调用视觉模型 |
| 进程重启 | 报告从 catalog 重新打开 | 不重新扣费 |

当前验收门：`npm run typecheck`、`npm test`、`npm run build`；研究报告必须通过 schema、重启读取和 1–20 数量边界测试。真实联调只做健康、凭证和单账号小样本，禁止批量抓取。

## 下一步（不阻塞主链）

1. 在雷达卡片增加“选择 3–5 条并分析”动作，调用单作品 metadata 和用户确认的下载接口。
2. 下载后立即 `ffprobe`、hash、代理化并写入 `ArtifactManifest`，临时 URL 只作为证据。
3. 将本地 ASR/OCR/镜头事实挂回 `awemeId + artifactId + time range`，再生成账号级结构模式。
4. 另建热点/榜单连接器，使用缓存和预算门，不把 TikHub 的所有接口直接暴露给 Agent。

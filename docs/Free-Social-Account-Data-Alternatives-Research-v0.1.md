# 各平台账号数据的免费/低成本替代方案调研 v0.1

日期：2026-08-14  
状态：公开资料调研完成；未执行真实批量抓取、未登录第三方平台、未改变现有 Provider 代码。  
适用项目：内容创作助手“对标账号雷达”与后续多平台研究连接器。

## 1. 执行摘要

### 1.1 结论先行

目前没有发现一个同时满足以下条件的长期免费方案：

1. 覆盖抖音、小红书、B 站、快手等中国平台；
2. 支持任意公开竞品账号，而不只是用户自己授权的账号；
3. 能返回账号资料、作品列表、互动指标、评论和可分析媒体；
4. 有稳定 API、清晰许可证、可商用条款和可预期的风控表现。

“免费”通常只是四种情况之一：

- 官方 API 不收按次费用，但只允许自有/已授权账号，或需要资质审核；
- 云端服务给一次性或每月试用额度，超过后按量付费；
- 开源代码不收软件费，但需要自建浏览器、代理、Cookie 管理、维护和合规成本；
- 能访问公开页面，但不能稳定地把它变成可追溯、可复现的产品数据。

对本项目的实际判断是：**暂时不应整体替换 TikHub**。更合理的是做一个分层连接器组合：

1. 保留 TikHub 作为抖音竞品账号的生产基线和兜底；当前账号研究是 metadata-first、首轮 1–20 条作品，成本已经被预算门和用户确认控制。
2. 为低量验证增加 Apify 适配器，使用其免费计划和社区 Actor 做同账号对照测试；它适合 POC，不应直接承诺为生产 SLA。
3. 为用户自己的账号接入抖音、快手、B 站、TikTok、Instagram 等官方 OAuth/API；官方能力更合规，但不能解决任意竞品账号监控。
4. 在本地研究沙箱中评估 `douyin-downloader` 等开源项目；只把明确的公开、低量、用户触发动作作为候选，不把需要登录态和逆向签名的爬虫直接嵌入商业产品。
5. 小红书竞品数据暂不承诺免费替代。官方公开平台目前主要是分享能力，并显示“暂停接入”；开源逆向项目虽功能多，但许可证和平台条款不能直接支持商业集成。

### 1.2 对“要不要换掉 TikHub”的建议

| 决策 | 建议 |
| --- | --- |
| 现在是否停用 TikHub | 否。先保持现有连接器，避免在 POC 阶段把不稳定的抓取链路放进主流程。 |
| 是否值得做免费替代验证 | 值得，但目标应是“降低低量探索成本、验证多 Provider 合同”，不是承诺零成本生产。 |
| 首个验证对象 | Apify 的 Douyin/Bilibili Actor + 本地 `douyin-downloader`，同一批账号与 TikHub 做字段和成功率对照。 |
| 哪些平台可以直接走免费官方 API | YouTube 最适合；TikTok Research API 只适合符合条件的非商业研究；其他平台官方能力大多是自有/授权账号。 |
| 哪些开源项目不应直接商用 | MediaCrawler、Spider_XHS/XHS_ALL_IN_ONE 等仓库明确写有非商业学习/研究限制，除非取得书面授权并完成依赖审计。 |

## 2. 先定义“账号数据”深度

TikHub 的替代不能只比较“能否返回一个 JSON”。本项目至少需要区分以下层级：

| 层级 | 数据结果 | 对“对标账号雷达”的价值 |
| --- | --- | --- |
| D0 | 账号昵称、头像、简介、粉丝/关注/获赞等当前快照 | 低成本发现与去重 |
| D1 | 最近作品列表、发布时间、描述、时长、封面、互动指标 | 首轮 metadata-first 研究，通常是 P0 |
| D2 | 作品详情、评论、字幕/文本、可本地化媒体 | 进入脚本/镜头/评论结构分析 |
| D3 | 历史时间序列、粉丝画像、受众地域/年龄、商业/星图指标 | 商业研究或投放决策，通常需要付费/授权 |

现有 V7 只把 D0–D1 作为首轮结果，用户选中 3–5 条后才做媒体本地化与 ASR/OCR/镜头分析。这一范围是正确的，也应作为替代方案的最低验收范围。

## 3. 官方 API：免费但能力边界很窄

### 3.1 中国平台

| 平台 | 官方能力事实 | 免费/准入判断 | 是否能替代竞品账号研究 |
| --- | --- | --- | --- |
| 抖音 | 抖音开放平台提供用户公开信息、视频管理、用户授权数据和部分榜单/行业能力。小程序“抖音账号数据”可查询授权账号近 30 天主页数据，视频数据能力覆盖近 1 天或近 30 天的指定视频；需要申请权限和用户/经营关系授权。 | 文档未把它定位为任意公开账号查询 API；核心流程是 OAuth/access token、scope 和授权关系。按次收费需以具体能力/合同为准。 | **不能**替代任意竞品账号；适合自己的账号、品牌号、员工号、合作号。 |
| 快手 | 官方开放平台提供快手登录、用户信息、关系链、内容管理、查询视频等能力；网站应用需要注册应用并用 OAuth 授权。 | 有开发者入驻、应用和权限申请，公开文档没有给出一个面向任意竞品账号的免费公共数据接口。 | **不能**替代任意竞品账号；适合自有/授权账号。 |
| B 站 | B 站开放平台列出“获取用户公开信息”、视频稿件查询和“用户授权后的用户数据、稿件数据”；要求开发者身份认证，关联 UP 主同意后开放相应权限。 | 是否收费以开放平台公布为准；开发者服务协议明确关联 UP 主、授权范围和数据处理限制。 | **不能**替代任意竞品账号；适合自有或明确关联的 UP 主。 |
| 小红书 | 官方“分享开放平台”当前页面展示一键分享、站内活动联动和快速发布，并显示“暂停接入”；没有看到可供第三方任意读取竞品账号/笔记/互动历史的官方公共 API。 | 不能把分享 SDK 当作数据分析 API。官方协议还限制跟踪、越权获取和平台数据再利用。 | **不能**。现阶段仍需付费数据服务、人工导入或研究沙箱。 |

抖音官方文档尤其值得注意：它可以提供“抖音主页数据”“近 30 天视频数据”等授权数据，但页面同时写明普通抖音号要通过授权，小程序经营关系账号则走品牌号/员工号/合作号授权。也就是说，**官方 API 的免费/合规路径解决的是账号经营和数据回流，不是公开竞品账号情报**。

### 3.2 海外平台

| 平台 | 官方能力事实 | 免费边界 | 对本项目的判断 |
| --- | --- | --- | --- |
| YouTube | YouTube Data API v3 可查询频道、播放列表、视频和评论等公开资源。启用 API 的项目默认每天 10,000 quota units；非搜索型列表读取通常只消耗少量 quota，搜索型调用成本更高。 | 需要 Google Cloud 项目/API key；10,000 units/day 是配额而非无限制，超额需合规审计和申请。 | **最值得直接接入**的免费官方方案，尤其适合国际账号研究的 D0–D2 元数据；不等于免费获得视频文件。 |
| TikTok | Display API 需要 Login Kit、TikTok API 产品审核，以及 `user.info.basic`/`video.list` scope；典型流程是用户授权后读取该用户资料和最近视频。Research API 可查询公共账号和视频，但只向符合地区、组织、非商业研究条件的申请者开放。 | Research API FAQ 当前写明每天 1,000 次请求、最多 100,000 条记录，但商业创作者/广告主不符合资格；Display API 仍是授权账号模型。 | 不能作为本商业产品的免费竞品数据源；可作为非商业研究或自有账号连接器。 |
| Instagram | Meta 官方 Instagram API 面向 Business/Creator 专业账号；Facebook Login 路径需要 Page 绑定，Instagram Login 也只面向专业账号。API 可管理自有媒体、评论和 insights，并在权限/审核满足时读取其他专业账号的基本元数据。 | 需要 Meta App、权限、部分场景的 App Review/Advanced Access；不能访问普通消费者账号。 | 可作为自有账号和有限 Business Discovery 的官方连接器，不是任意个人账号的免费抓取器。 |

#### 官方 API 的核心结论

官方接口的“免费”最有价值的地方是稳定、可审计、许可证/条款较清楚；最致命的限制是**用户授权和账号所有权**。它们不应被误写成 TikHub 的替代品，而应在领域层建成另一类 `OwnedAccountConnector`。

## 4. 开源/自建方案：软件免费，运营不免费

### 4.1 重点项目

| 项目 | 当前公开能力 | 许可证/条款信号 | 适合作为产品依赖吗 |
| --- | --- | --- | --- |
| [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) | 支持小红书、抖音、快手、B 站、微博、贴吧、知乎等；基于 Playwright/CDP 复用登录态，支持主页/搜索/评论/导出到 CSV、JSON、SQLite/MySQL。仓库页面显示约 62k stars，说明社区关注度高。 | 仓库 LICENSE 是“NON-COMMERCIAL LEARNING LICENSE 1.1”，明确限制为学习/研究，禁止大规模抓取，未经书面同意不得商业使用。 | **不直接商用**。可用于隔离的技术验证和字段探索，不能因为 GitHub 可下载就视为 MIT/Apache。 |
| [douyin-downloader](https://github.com/jiji262/douyin-downloader) | 面向抖音下载和账号内容同步，支持用户主页批量、视频/图文/合集/音乐、评论、热搜、关键词、SQLite 去重、REST API 和浏览器兜底；README 标明 MIT。 | MIT 只解决软件版权，不解决抖音平台条款、Cookie/验证码、内容权利和大规模使用风险；README 也提示平台接口变化属于正常技术风险。 | **可做本地低量实验**。它更像下载器/同步器，不是成熟的账号研究数据服务，需自行归一化字段和维护。 |
| [Spider_XHS](https://github.com/cv-cat/Spider_XHS) / [XHS_ALL_IN_ONE](https://github.com/cv-cat/XHS_ALL_IN_ONE) | 小红书 PC/创作者平台登录、用户主页、笔记、评论、搜索、蒲公英 KOL 等；项目声称已封装签名算法和全链路运营。 | 两个 README 都明确写“仅供学习交流，禁止任何商业化行为”；签名逆向、Cookie、自动发布和多账号健康巡检带来额外平台风控。仓库页面未给出可直接用于商业集成的标准开源许可证。 | **不直接商用**。只能作为接口形态和字段的研究材料；商业使用需要作者书面授权、依赖审计和平台合规评估。 |
| [bilibili-api-python](https://pypi.org/project/bilibili-api-python/) / [BiliStalkerMCP](https://github.com/222wcnm/BiliStalkerMCP) | 可读取 B 站用户、视频、动态、评论、字幕等公开页面/接口；后者提供 MCP 形式的用户资料、用户视频、动态、文章和评论工具。 | `bilibili-api-python` 在 PyPI 标注 GPLv3+，且依赖非稳定/非官方接口；MCP 项目是社区实现，需单独核对许可证和维护状态。 | **研究/内部工具候选**，不作为正式跨平台公共数据合同；要注意 GPL 隔离、接口漂移和未授权抓取。 |

### 4.2 开源方案的隐藏成本

即使软件本身为 MIT/GPL 或免费，仍至少要承担：

- Chrome/Playwright/Chromium 运行时、磁盘、带宽和任务调度；
- 登录态和 Cookie 的加密、刷新、撤销、隔离和泄露应急；
- IP/设备指纹、验证码、分页闸门、接口签名变化的维护；
- 账号封禁、数据删除请求、内容版权与个人信息处理；
- 每个平台单独的字段归一化和回归样本；
- 许可证感染/非商业限制带来的产品隔离成本。

因此“自建 = 0 元”是不完整的成本结论。更准确的说法是“省掉供应商按次费用，把成本换成工程、风控和合规运营”。

## 5. 云端免费额度和低成本服务

| 服务 | 公开免费/低价信息（以 2026-08-14 页面为准） | 覆盖与限制 | 判断 |
| --- | --- | --- | --- |
| TikHub | 官方 Getting Started 写明新账号一次性获得 `$0.05`，约 50 次请求；Pricing 页面写明按接口约 `$0.001–0.01/request`，部分 endpoint 不接受免费额度。 | 覆盖 16 个平台、1,000+ 接口，但字段、权限、临时 URL 和费用按 endpoint 变化。 | 当前最直接的“低量付费”基线；不是长期免费，但已具备统一 API、错误和成本契约。 |
| Apify | Free 计划 `$0`，每月有 `$5` 可用于 Store Actor 或自建 Actor，无需信用卡；超出免费额度后免费计划会被阻断。 | 商店 Actor 价格、计算、存储、代理和输出字段由具体 Actor 决定；存在社区维护 Actor。当前可找到 Douyin Actor（约 `$3/1,000 results`，创作者完整作品目录/关键词搜索需 Cookie）和 Bilibili Actor。 | **最值得做 POC**。免费额度足以做小样本对照，但不能把社区 Actor 当成统一生产 SLA。 |
| Bright Data Web Scraper API | 当前页面提供每月 5,000 records 的 Free Tier，Pay-as-you-go 页面显示约 `$1.5/1,000 records`；免费试用/地区和产品资格可能变化。 | 通用结构化网页/社交媒体数据，覆盖页面与产品由具体数据产品决定；不是中国平台统一账号 API。 | 适合验证通用网页抓取或海外平台；不作为抖音/小红书主替代。 |
| ScrapingBee | 提供 1,000 free API credits、无需信用卡，并负责 headless browser/代理轮换。 | 是通用网页抓取 API，不提供 TikHub 风格的账号/作品统一 schema；每种 JS/代理能力消耗不同 credits。 | 适合快速页面读取 POC，不适合作为多平台研究连接器。 |
| Data365 | 官网写明所有用户可申请 14 天免费试用；公开订阅起价约 `€300/month`（一个社交网络、50 万 credits）。 | 偏商业 social media API，需填写表单、销售支持和试用限制；长期不属于免费方案。 | 可列入供应商比价，但不符合当前“免费可用”目标。 |

### 5.1 Apify 作为 POC 的特别说明

Apify 的免费额度不是“免费无上限 API”：

1. Actor 的单价与输出计费由作者决定；
2. 运行成本还包括计算、存储、数据传输、重试和代理；
3. Douyin Actor 的公开视频/主页/评论可能免登录，但关键词搜索和完整创作者目录可能要求 Cookie；
4. 社区 Actor 没有平台官方 SLA，字段和成功率必须由我们自己做回归；
5. 不同 Actor 的 JSON 字段不同，仍需通过 `ResearchConnector` 归一化。

## 6. 方案对比与产品适配

下面的“适配度”是本项目基于覆盖、稳定性、免费性、接入成本和合规风险的定性判断，不是供应商自报评分。

| 方案 | 抖音竞品 D0–D1 | 小红书竞品 D0–D1 | 自有账号 D0–D2 | 稳定性 | 商业可用性 | 推荐位置 |
| --- | --- | --- | --- | --- | --- | --- |
| TikHub | 高 | 高/依接口 | 高/依接口 | 中高 | 需审查条款和跨境 | 生产默认/兜底 |
| 官方 OAuth/API | 低（任意竞品） | 低 | 高 | 高 | 高，但需审核/授权 | 自有账号连接器 |
| Apify 社区 Actor | 中高 | 视 Actor | 中 | 中 | 中低，需逐 Actor 审核 | 低量 POC/备用 |
| `douyin-downloader` | 中（偏下载/同步） | 无 | 中 | 中低 | 软件 MIT；平台风险仍在 | 本地低量实验 |
| MediaCrawler | 中高（多平台） | 高 | 中 | 中低 | **非商业许可证，不可直接用** | 技术研究沙箱 |
| Spider_XHS/XHS_ALL_IN_ONE | 无统一抖音 | 高 | 高 | 中低 | **README 禁止商业化** | 技术研究沙箱 |
| YouTube Data API | 高 | 不适用 | 高 | 高 | 高，需遵守 Google API 条款 | 直接接入海外平台 |

## 7. 对现有架构的影响

当前 `packages/providers/src/index.ts` 的 `ResearchConnector` 仍以 `TikHubProfile`、`TikHubVideoMetadata` 和 `providerKey: "tikhub"` 命名。做多 Provider 时，建议先做中性领域合同，而不是给每个新供应商复制一套领域模型：

```text
PlatformResearchConnector
  ├─ resolveAccount(input)
  ├─ fetchAccountSnapshot(accountRef)
  ├─ fetchPosts(accountRef, cursor, limit)
  ├─ fetchPostDetail(postRef)
  ├─ fetchComments(postRef, cursor, limit)
  ├─ fetchMediaHandle(postRef)       # 可选，不能默认下载
  └─ getCapabilities / estimateCost
```

建议的中性对象：

- `AccountRef`：平台、账号 URL/handle、平台内部 ID、解析方式；
- `AccountSnapshot`：昵称、头像、简介、粉丝/关注/获赞、capturedAt、数据新鲜度；
- `PostMetadata`：postId、描述、发布时间、时长、封面、互动指标、shareUrl；
- `EvidenceEnvelope`：provider、平台、来源 URL、抓取时间、登录模式、原始响应 hash、字段可靠性；
- `CapabilityReport`：支持的层级 D0–D3、是否需要 OAuth/Cookie、是否能下载、是否有计费、是否为 inferred 字段。

Provider 适配器的顺序建议是：

```text
owned official connector
        ↓ 失败或不适用
TikHub / paid connector
        ↓ 仅在用户允许的低量范围
Apify Actor / local public connector
        ↓
metadata-only / manual import
```

不要做“无感自动切换”。不同来源的权限和风险不同，UI 必须显示来源、是否需要登录态、预计费用、数据覆盖缺口和是否会下载媒体。

## 8. 推荐的验证计划

### 8.1 两周 POC

**第 1 阶段：合同和样本准备**

- 固定 20 个公开抖音主页链接，覆盖小/中/大账号、视频较多/较少、图文混合和可能需要登录的账号；
- 固定字段：账号解析、昵称、粉丝数、作品数、最新 10 条作品、发布时间、描述、点赞/评论/分享、封面/媒体 URL；
- 不下载视频，不抓评论全文，不做关键词批量搜索；
- 对每条结果保存 source、capturedAt、response hash 和错误状态。

**第 2 阶段：三路对照**

1. TikHub 当前 connector；
2. Apify Douyin Actor，使用 `$5` 免费额度，设置单次最大结果数和硬预算；
3. 本地 `douyin-downloader` 的用户触发批量同步/REST 模式，限制为同一批账号和低并发。

**第 3 阶段：评价指标**

| 指标 | 建议门槛 |
| --- | --- |
| 主页解析成功率 | ≥90% |
| 首页作品列表成功率 | ≥80% |
| 关键字段非空率 | ≥90%（账号名、作品 ID、发布时间、描述至少四项） |
| 与 TikHub 的 ID 对齐率 | ≥95% |
| 互动指标时间差 | 记录差异，不用单次结果宣称绝对正确 |
| 重试/验证码/登录失败率 | 单独统计，不隐藏在“空结果”里 |
| schema 漂移 | 连续 3 次运行不发生未预期字段类型变化 |
| 实际成本 | POC 阶段控制在 Apify 免费额度内；超出前必须人工确认 |

### 8.2 通过/淘汰规则

- 如果 Apify 在 20 个账号上满足门槛，且字段/错误模型可归一化：保留为低量备用 Provider；
- 如果只支持单条 URL/单条作品、不支持完整账号目录：把它定位为“作品证据补充器”，不要叫账号连接器；
- 如果本地工具需要频繁手动验证码、Cookie 进入产品或成功率低于 80%：不进入正式 UI，只保留研究脚本；
- 任何非商业许可证或平台条款未明确允许的项目：必须隔离在研究仓库，不能随应用发布；
- 只有当替代 Provider 连续 3 次刷新都达到门槛，才考虑让用户在设置页主动选择它，不能自动替换 TikHub。

## 9. 风险与边界

### 9.1 合规和权限

“公开可见”不等于“可以无限抓取、长期保存、再分发或用于画像”。抖音、B 站和小红书的官方协议都强调授权、用途限制、删除和数据安全；B 站开放平台协议还明确限制未经书面同意使用机器人、蜘蛛或爬虫获取开放平台数据。项目需要至少记录：数据来源、用途、用户动作、抓取时间、保留期限、删除入口和媒体权利状态。

### 9.2 许可证

GitHub 仓库没有自动获得商业使用权。MediaCrawler 的非商业学习许可证和 Spider_XHS 的“禁止商业化”声明是硬阻断；GPL 项目还需要判断是否通过独立进程/服务隔离，以及是否触发衍生作品义务。

### 9.3 数据新鲜度

不同来源的粉丝/播放/互动指标可能不是同一时刻的在线值。TikTok Research API FAQ 明确说明视频搜索数据使用归档数据，新视频可能延迟最多 48 小时，播放/粉丝等统计可能最多延迟 10 天。产品不能把不同 Provider 的一次快照直接当成精确排名，必须显示 capturedAt 和 freshness。

### 9.4 安全和恢复

Cookie、access token、临时媒体 URL 都要留在 main/provider 边界；不能写入渲染器、日志、fixture 或报告正文。Provider 任务要支持 401/403、429、验证码、超时、部分结果和 submission-unknown，不得因替代方案“免费”而放宽密钥和重试纪律。

### 9.5 版权和媒体下载

账号元数据和视频文件是两类权利。免费抓取到的播放 URL 不能自动进入素材库；只有用户明确选择、权限可说明、URL 在有效期内并已本地化成功，才创建本地 Artifact。默认仍保持当前 metadata-first 流程。

## 10. 最终建议

1. **不整体替换 TikHub**：现阶段它仍是最省工程成本的统一抖音研究基线；低量使用时可利用官方 `$0.05` 试用和按需计费，但不能把一次性免费额度当成产品商业模式。
2. **新增免费验证层**：优先做 YouTube 官方 connector（真正可长期免费配额）和 Apify Douyin/Bilibili POC（每月 `$5` 平台额度，Actor 级计费）。
3. **本地开源只做窄切片**：`douyin-downloader` 可用于用户主动触发的低量同步验证；MediaCrawler、Spider_XHS、XHS_ALL_IN_ONE 先不进入商业代码和发布包。
4. **把官方授权账号作为独立产品能力**：抖音/快手/B 站/TikTok/Instagram 官方 API 适合“连接我的账号、读取我的作品和数据”，不要包装成“竞品账号抓取”。
5. **小红书保持谨慎**：短期不承诺免费竞品账号监控；如果产品必须覆盖小红书，继续使用已审计的付费 Provider，或者另行开展带法律/许可证评审的供应商采购。
6. **先改中性合同，再扩 Provider**：把当前 TikHub 专属命名迁移为 `PlatformResearchConnector` + capability/evidence/cost 合同，确保以后可以把官方、Apify、本地和付费 Provider 作为可替换适配器接入。

## 11. 主要来源

### 项目内部事实

- [Provider 官方接入调研与小额联调记录](./Provider-Official-Integration-Research-v0.1.md)
- [V7：对标账号证据雷达（metadata-first）](./plan/2026-08-14-v7-account-research.md)

### 官方平台与服务文档

- [抖音开放平台概述](https://partner.open-douyin.com/docs/resource/zh-CN/developer/introduction/overview)
- [抖音用户数据能力](https://partner.open-douyin.com/docs/resource/zh-CN/mini-app/open-capacity/basic-capacities/douyin)
- [抖音获取用户公开信息](https://partner.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/get-account-open-info)
- [快手开放平台](https://open.kuaishou.com/platform/openApi)
- [B 站开放平台文档](https://open.bilibili.com/doc)
- [B 站开放平台开发者服务协议](https://open.bilibili.com/agreement/developer-service)
- [小红书分享开放平台](https://agora.xiaohongshu.com/)
- [小红书开放平台开发者协议（公开镜像）](https://xiaohongshu.apifox.cn/doc-2811022)
- [TikTok Display API](https://developers.tiktok.com/doc/display-api-get-started/)
- [TikTok Research API](https://developers.tiktok.com/products/research-api/)
- [TikTok Research API FAQ](https://developers.tiktok.com/doc/research-api-faq)
- [YouTube Data API quota](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)
- [Meta Instagram API 文档集合](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)

### 服务定价/试用

- [TikHub Getting Started](https://tikhub.io/getting-started)
- [TikHub Pricing](https://tikhub.io/pricing)
- [Apify Pricing](https://apify.com/pricing)
- [Apify Douyin Scraper Actor](https://apify.com/memo23/douyin-scraper)
- [Apify Bilibili Scraper Actor](https://apify.com/automation-lab/bilibili-scraper)
- [Bright Data Web Scraper API](https://brightdata.com/products/web-scraper)
- [ScrapingBee Pricing](https://www.scrapingbee.com/pricing/)
- [Data365 Pricing](https://data365.co/pricing)

### 开源项目

- [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) / [许可证](https://github.com/NanmiCoder/MediaCrawler/blob/main/LICENSE)
- [douyin-downloader](https://github.com/jiji262/douyin-downloader)
- [Spider_XHS](https://github.com/cv-cat/Spider_XHS)
- [XHS_ALL_IN_ONE](https://github.com/cv-cat/XHS_ALL_IN_ONE)
- [bilibili-api-python](https://pypi.org/project/bilibili-api-python/)
- [BiliStalkerMCP](https://github.com/222wcnm/BiliStalkerMCP)

> 价格、配额、平台页面和 Actor 能力都可能变化。本文的数字和判断应视为 2026-08-14 的调研快照；在真实接入、采购或对外承诺前，需要重新核对官方页面、服务条款、许可证、数据处理协议和小样本 smoke 结果。

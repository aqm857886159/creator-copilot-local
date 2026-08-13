# 数据库选型 ADR v0.1

日期：2026-08-14  
状态：已决定；实施时允许以同一 Port 替换，但不改变领域合同

## 决策

首版桌面端采用 **SQLite 作为本地内容事实库**，不是因为它“够用就行”，而是因为产品的首要约束是本地优先、单用户/低写并发、离线可用、可迁移和跨平台打包。

数据库只保存结构化事实和索引：账号、选题、脚本、分镜、素材元数据、ASR/OCR/镜头证据、剪辑提案、时间线、发布和复盘。原始视频、音频、图片、代理文件、模型文件和渲染产物留在受控文件系统，数据库只保存路径、hash、技术探测结果和引用关系。

## 为什么 SQLite 与本项目匹配

### 1. 本地优先需要“应用内数据库”，不是“数据库服务器”

桌面端必须满足：安装后即用、无 Docker/端口/账号初始化、断网可工作、用户可以复制/备份/迁移项目。SQLite 是进程内、serverless、zero-configuration、事务型 SQL 引擎，数据库可以作为项目文件的一部分交付。[SQLite 官方简介](https://sqlite.org/about.html)、[SQLite serverless 说明](https://www.sqlite.org/serverless.html)

PostgreSQL 本身很强，但它是 client/server 架构：需要常驻服务、连接管理、初始化、迁移、权限和备份运维。它适合团队共享或云端中心库，不适合作为每个用户桌面端的强制安装前提。[PostgreSQL 架构](https://www.postgresql.org/docs/18/connect-estab.html)

### 2. 我们的写入模式不是数据库竞赛里的高并发写入

UI、Agent、ASR/OCR worker 和渲染 worker 不直接争抢写库。所有领域变更通过 main process 的 Command Registry 和事务写入；媒体 worker 只生成派生文件和结果，最后以 Job receipt 回写。

SQLite 的约束是“一次一个写者”，但 WAL 模式允许读写并行；只要写事务短、避免把 FFmpeg/模型执行放在事务里，这正符合我们的工作方式。[SQLite WAL](https://www2.sqlite.org/wal.html)

这不是隐藏限制，而是设计门：

- 所有写入必须经过一个可观测的写入队列；
- 事务只做状态、索引和引用变更；
- 大文件处理、网络调用、模型调用不得持有事务；
- `busy_timeout`、幂等键、revision 冲突和失败重试必须有合同测试。

### 3. 素材库首先需要检索和事实一致性，不是把向量数据库当主库

素材库的第一层查询是标签、文本、ASR、OCR、账号、时间、镜头类型和项目关系。SQLite 自带 FTS5，可直接提供全文搜索、前缀、NEAR、布尔组合和相关性排序。[SQLite FTS5](https://www.sqlite.org/fts5.html)

向量检索作为可替换的 `VectorIndex`，不改变 SQLite 事实模型：首版可以是本地向量索引适配器，embedding 失败时仍能用 FTS5 和结构化过滤。不能因为“AI 素材库”就把数据库事实交给一个向量服务。

### 4. 项目文件和备份是产品体验的一部分

一个 SQLite 文件便于：项目复制、备份、诊断、导出、版本迁移和离线恢复。数据库本身不存媒体大文件，所以不会把“单文件可迁移”误解为“把几十 GB 视频塞进数据库”。备份时必须同时正确处理 `-wal`/`-shm`，或通过 SQLite backup/checkpoint 生成一致快照。

## 为什么不是其他数据库

| 方案 | 它更擅长什么 | 当前不选作主事实库的原因 | 保留位置 |
|---|---|---|---|
| PostgreSQL | 多用户、中心化、并发写入、权限和云端运维 | 强制桌面端运行 server，离线和项目迁移变复杂；单用户本地场景付出过高 | 未来同步服务/团队版的云端事实库 |
| DuckDB | 嵌入式 OLAP、批量分析、Parquet、指标聚合 | 官方并发模型主要优化单进程分析；大量小事务和多进程写入不是主目标 | 账号数据报表、批量分析和导出查询的可选 sidecar |
| IndexedDB | 浏览器内存储、Web API 方便 | 不是稳定的跨进程桌面事实层；备份、迁移、复杂 SQL/全文索引和媒体工作流边界不如 SQLite 清晰 | renderer 查询缓存，不做事实源 |
| Realm/对象数据库 | 移动端对象同步、对象模型 | 引入另一套对象/迁移/同步语义，不能直接复用我们已有 SQL/FTS/Drizzle 合同 | 暂不引入 |
| libSQL/Turso | SQLite 兼容和远程同步方向 | 远程同步/托管不是首版本地事实的必要条件，还要增加服务与兼容矩阵 | 未来可评估同步 adapter，不改 Domain Port |
| 向量数据库 | embedding 相似度、召回 | 不能表达完整领域事务、revision、发布状态和证据关系 | `VectorIndex` 可插拔实现 |

DuckDB 的官方文档明确：读写模式中的多写者主要限于同一进程，跨进程写入需要额外的远程协议或协调；它更适合分析查询，而不是我们的领域小事务。[DuckDB 并发模型](https://duckdb.org/docs/current/connect/concurrency)、[DuckDB 定位](https://duckdb.org/why_duckdb)

## 什么时候必须换成 PostgreSQL

以下条件出现时，SQLite 不再作为唯一事实库：

1. 多台设备或多个用户需要同时写同一个远程项目；
2. 团队协作、角色权限、审计和中心化同步成为核心需求；
3. 单个项目的结构化数据接近我们设定的容量/备份门，或出现持续高写入队列；
4. 需要服务端跨用户聚合、实时订阅和统一数据治理。

届时采用：

```text
本地 SQLite（离线工作副本）
  ↕ 同步协议 / outbox / conflict resolution
云端 PostgreSQL（团队与跨设备事实库）
```

不能把“未来可能上云”当成今天让每个桌面用户安装 PostgreSQL 的理由。真正需要提前做的是保持 `DomainRepository`、事件、revision、outbox 和迁移合同与数据库实现解耦。

## 工程约束

- SQLite 只在 Electron main/utility process 使用，renderer 不直接打开数据库；
- 启用 WAL、foreign keys、busy timeout，并记录 checkpoint/锁等待指标；
- 单一写入入口；worker 不直接写领域表；
- 原始媒体不进 BLOB，数据库保存 `assetId/path/hash/metadata`；
- FTS5 是首版全文搜索基线；向量索引和 DuckDB 都必须位于 adapter 后；
- 数据库备份、恢复、迁移、损坏检测和项目复制必须有真实 fixture；
- 数据库文件和媒体目录必须支持版本化 manifest，避免只复制 `.db` 而漏掉派生文件；
- 领域层只依赖 `DomainRepository`/`SearchPort`，未来切换 PostgreSQL 不得改 Agent、UI 和 RenderIR。

## 最终判断

SQLite 不是“先凑合，未来再换”的临时方案，而是首版本地产品最符合约束的主库。高大上的数据库解决的是不同问题：PostgreSQL 解决中心化并发协作，DuckDB 解决本地分析，向量数据库解决相似度召回。我们的首要问题是让用户在自己的电脑上可靠地保存、搜索、审阅、撤销和迁移创作项目；在这个问题上，SQLite 的简单性本身就是高级能力。

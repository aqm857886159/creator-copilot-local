# V8 交换格式与发布复盘：施工记录

日期：2026-08-14  
状态：交换格式基线与手动发布包已落地；指标录入、复盘建议持久化仍待实现

## 目标

AI 粗剪确认后，用户应能得到一份本地交付包，并在需要外部精修时把同一条已确认时间线带到其他工具。交换格式只描述已经确认的 `RenderIR`，不重新调用模型，也不取代本地项目事实。

当前用户可见流程：

```text
AI 剪辑提案 → 人工采用/拒绝 → 确认并导出 MP4/SRT/manifest
                              ├─ 导出 FCPXML + loss report
                              └─ 导出 OTIO JSON + loss report
```

## 已实现

### 1. FCPXML 基线适配器

`packages/exchange/src/index.ts` 的 `exportFcpXml` 生成 FCPXML 1.11：

- 输出 9:16 项目 format、素材引用、视频 spine、源片段和时间线时间码；
- 素材只允许引用工作区内的已验证相对路径；
- 通过 `file://` URL 指向本地源素材，便于 Final Cut Pro 等工具重新链接；
- 暂不承诺字幕花字、复杂 transform、opacity/volume 等参数无损映射；
- 对未映射能力返回结构化 `ExchangeCapabilityReport`。

### 2. OTIO 基线适配器

`exportOtio` 生成 OTIO 1.x JSON：

- Timeline → Stack → Video/Audio Track → Clip；
- 每个 Clip 保存 source range、外部媒体 URL、素材 ID 和 content hash；
- 字幕仍由同目录 SRT 提供，并在 loss report 中明确提示；
- 不把 OTIO JSON 当作剪映草稿，也不声称能覆盖剪映私有预设、花字和特效。

### 3. 桌面端导出与资产追踪

`desktop:export-exchange` 只允许对成功的 `RenderRun` 导出，重新校验：

- FrozenEditSpec 存在且属于当前项目；
- 每个素材存在、路径经过 realpath containment 检查；
- 素材重新 probe 后编译同一 RenderIR；
- 输出文件与 loss report 原子写入 `exports/`，并登记为 artifact，保留父素材关系。

UI 在 MP4 导出成功后提供 FCPXML、OTIO 两个“外部精修”入口，并可打开输出和损失报告。

## 明确不做的承诺

- 不把 FCPXML、OTIO 或剪映草稿作为账号、脚本、素材库的主数据库；
- 不声称能无损导入/导出剪映（CapCut）私有草稿、预设、花字和模板；
- 不在交换导出阶段重新让 AI 选镜头或改变用户已经确认的时间线；
- 不用“格式导出成功”替代“目标软件导入成功”。需要真实目标软件导入回归后，才能提高 CapabilityReport 的支持等级。

## 验收与失败路径

已验证：

- 同一 RenderIR 可生成 FCPXML 与 OTIO；
- 字幕存在时两种适配器都会生成 warning loss；
- 输出引用越过工作区时拒绝；
- 交换适配器单元测试、typecheck、Vite build 通过。

待补：

- Final Cut Pro/OTIO Python 库的真实 reopen/import smoke；
- Windows 路径和 UNC 路径 fixture；
- 复杂音频、转场、crop、花字、VFR 素材的 capability matrix；
- 剪映导出适配器：必须先取得可重复的草稿 fixture，再单独实现和评审。

## 下一切片：手动发布包与复盘

V8-02 先做本地、不依赖平台登录的发布包：

```text
视频 + SRT + 封面 + 标题候选 + 话题候选 + 来源/版权说明
→ export/publish-package/manifest.json
→ 用户手动上传抖音
→ 用户手动录入播放、完播、点赞、评论、分享、收藏等指标
→ MetricSnapshot
→ AI 只能提出 ReviewMemory，用户确认后才写入创作记忆
```

平台发布 connector、自动发布、`submission_unknown` 恢复和多平台差异化适配后置，不阻塞本地创作闭环。

## 本次新增：手动发布包基线

`packages/publishing/src/index.ts` 和 `desktop:create-publish-package` 已实现：

- 从成功的 `RenderRun` 读取 MP4、SRT 和 render manifest；
- 将文件复制到工作区内的 `publish/<packageId>/`，每个文件重新 hash 并记录 byte size；
- 生成 `publish-package.manifest.json`，包含平台、标题、话题、版权提醒、源素材 artifact ID 和警告；
- UI 在 AI 剪辑导出成功后提供“生成抖音发布包”，标题由用户确认，不自动发布；
- 发布包源文件必须经过 realpath containment 检查，不能从工作区外偷渡文件。

这一步只证明“从剪辑结果到可手动上传的本地交付物”可运行，不代表抖音发布 API 已接通。

下一步会将 `Publication`、`MetricSnapshot`、`ReviewMemoryProposal` 写入 catalog：指标只能由用户手动录入或明确授权的 connector 写入；记忆建议必须带指标证据并经过用户确认，不能自动覆盖创作者表达偏好。

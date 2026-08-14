# V4b：A-roll 主干与 B-roll 覆盖式 AI 剪辑

日期：2026-08-14
状态：已实现；合同测试、真实 FFmpeg 双层合成、旧单轨兼容和 macOS arm64 打包 UI 旅程已通过
范围：深度真人口播的双层画面模型、可审阅提案、冻结合同和 FFmpeg 合成；不包含转场模板、花字预设、画中画、关键帧和剪映私有草稿

## 为什么必须调整

现有首版把每个分镜选中的 Take 顺序拼接成一条视频轨。它能证明 `EditProposal → FrozenEditSpec → RenderIR → MP4` 可运行，但不能解决深度口播最核心的问题：真人的声音和表达需要连续存在，而补充证据、动作、截图和细节画面应该在说到对应内容时覆盖画面，而不是把 A-roll 音频一起替换掉。

本增量把用户结果改为：

```text
每段脚本的真人 A-roll（主干视频 + 主音频）
                    ↓ 保持连续
对应段落的 B-roll / 录屏 / 静帧（覆盖主画面、默认静音）
                    ↓
字幕继续跟随脚本和 A-roll 时间线
```

产品名称仍然是“AI 粗剪 / AI 剪辑”。“确定性”只描述用户确认后的执行约束，不是对外功能名称。

## 合同

- `SourceClip` / `ProposalOperation` 增加可选 `placement: primary | overlay`。旧 v1 提案没有该字段时继续按原来的单轨顺序模式冻结和渲染。
- 新分镜工作流对每个脚本段落至少生成一条 `talking_head` 主干拍摄任务；当段落需要画面支持时，再生成一条 B-roll/录屏等补充任务。二者引用同一个 script block，但用途和拍摄任务独立。
- layered proposal 中，`primary` 操作必须从 0 到成片结束连续覆盖；`overlay` 操作允许只覆盖局部时间，但同一 overlay 轨内不得重叠或越界。
- 拒绝 overlay 不影响主干可导出；拒绝 primary 会造成主干时间缺口，冻结必须失败并向用户解释。
- B-roll 默认只替换画面，不接管主音频。正式渲染的音频只来自 primary 主干；以后需要环境声混音时使用显式 audio track，不在本次偷偷混入。
- 模型只能从用户已选 Take 和本地事实中选择 source asset、片段和理由；主进程仍负责时间码、素材锁、轨道连续性和 hash 校验。

## 兼容与迁移

- 不改数据库表，不批量重写旧项目；字段是 JSON 合同的向后兼容可选扩展。
- 旧 storyboard 如果没有“每段一个 talking_head 主干”，继续走 legacy sequential proposal，避免现有项目突然无法打开或导出。
- 新 storyboard 只有在每个脚本段落都有 talking-head 主干时才启用 layered proposal；部分迁移的半成品不会被误判为双轨。
- FCPXML 基线适配器本次只把 primary 作为 spine，并对 overlay 输出明确 `LossReport`；OTIO 保留多条视频轨。

## 验收门

1. 单元测试：旧单轨提案结果不变；layered 提案冻结为 primary + overlay + subtitle 三轨；主干缺口、overlay 越界和 overlay 自相重叠会被拒绝。
2. 真实 FFmpeg fixture：蓝色 A-roll 连续 4 秒并提供音频；红色 B-roll 只在中间 1 秒覆盖。抽样输出帧必须是“蓝 → 红 → 蓝”，成片仍只有主干音频。
3. 创作 E2E：每段脚本产生 A-roll 任务，需要画面支持的段落另有补充任务；全部导入/选择后，本地 AI 提案至少包含一个 `primary` 和一个 `overlay` 操作。
4. packaged UI smoke：用户能看见“口播主干 / 画面覆盖”以及覆盖发生的成片时间段，逐项采用/拒绝后可导出 MP4、SRT 和 manifest。
5. 同一 FrozenEditSpec 重试时不重新调用模型、不改变 overlay 时间码或素材。

额外执行门：每个视频片段的源素材时长必须与其时间线时长一致。当前版本没有隐式变速；任何不一致都在冻结、编译和正式渲染三层被拒绝。输出后再用 ffprobe 对账成片时长，避免 manifest 与真实视频不一致。

## 失败与回滚

- 只有 B-roll 缺失：显示非阻塞补拍缺口，仍允许用 A-roll 导出。
- A-roll 缺失或事实不完整：`needs_material`，不生成伪主干。
- overlay FFmpeg 合成失败：Job/RenderRun 进入现有失败恢复链；原 FrozenEditSpec 保留，可重试或导出交换格式，不回退为未经用户确认的单轨方案。
- 若 packaged smoke 未通过，本增量不提交；旧 sequential renderer 保留在同一实现的兼容分支中。

## 明确不做

- 不通过降低 A-roll 音量来掩盖 B-roll 音轨；
- 不自动调用图库、AIGC 或 TikHub 下载画面；
- 不在渲染时重新运行 LLM/VLM；
- 不把剪映、花字、转场、音效和模板同时塞进本增量。

## 验证结果

- `npm run typecheck`：通过；
- `npm test -- --run`：12 个 test files、77 个 tests 通过；
- `npm run test:render:layered`：4000ms、120 帧，画面抽样为蓝 → 红 → 蓝，输出音频约 439.5Hz（A-roll fixture 为 440Hz，B-roll 为 880Hz），最终只有一条音轨；
- `npm run test:render:smoke`、`npm run test:render:recovery`、`npm run test:creation:edit:e2e`：旧单轨兼容、同规格恢复重渲染和完整创作链通过；
- `npm run test:desktop:ui`：真实 macOS arm64 打包应用完成脚本 → 5 个拍摄任务 → 5 条 AI 剪辑提案 → 双层导出 → SQLite 恢复，并按每个脚本段落核对主干/补充镜头；
- 独立对抗评审未发现剩余 P0/P1。剩余 P2 是把 React 中两处分镜草稿派生逻辑继续下沉到 creation domain，不阻塞本次可见用户闭环。

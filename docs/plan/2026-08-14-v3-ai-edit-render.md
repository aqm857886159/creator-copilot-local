# V3 AI 剪辑：提案到可交付视频

日期：2026-08-14  
状态：参考执行内核、桌面 AI 粗剪 UI、本地 render Job/Artifact 回写和 Provider 提案 CommandReceipt 已完成；freeze 命令边界仍待补齐
对应路线图：`docs/Implementation-Plan-v0.2.md` 的 V4（产品名称为“AI 粗剪 / AI 剪辑”）

## 1. 为什么叫 AI 剪辑

用户看到的功能是 AI 剪辑：系统理解脚本、分镜和素材，给出镜头选择、时间码、字幕和缺口建议，用户可以逐条替换、拒绝、确认和撤销。

“确定性”不是另一种剪辑产品，而是确认之后的执行规则：同一份已经确认的剪辑意图必须得到同一份 RenderIR，不允许渲染时再次调用模型偷偷换素材。这样才能支持预览和正式导出一致、失败后重试、版本比较、素材 hash 锁定以及导出到外部剪辑器。

## 2. 本次切片的真实用户结果

```text
已有脚本 + 分镜 + 两段本地视频
  → EditProposal（AI 将来生成；当前用 fixture 代替）
  → 用户确认后 FrozenEditSpec
  → RenderIR
  → MP4 + SRT + manifest
```

本次先证明“提案已经确认后，产品能够稳定交付一个可播放文件”，不把 AI provider、TikHub、ASR/OCR 或剪映私有草稿格式混进渲染热路径。

## 3. 合同与执行边界

### 输入

- `EditProposal`：项目、脚本/分镜 revision、候选操作、时间码、素材 ID、理由、证据 ID、置信度、字幕和 `OutputProfile`；
- `assetLocks`：每个被采用素材的内容 hash；
- `RenderAsset`：workspace-relative path、绝对路径（仅由 main/worker 解析）、时长、音视频流事实和 hash。

### 命令与产物

| 阶段 | 命令/函数 | 产物 |
|---|---|---|
| 提案确认 | `freezeEditProposal` | `FrozenEditSpec`、`authoredSpecHash` |
| 编译 | `compileFrozenEditSpec` | `RenderIR`、`resolvedSpecHash` |
| 执行 | `renderMp4` | 原子写入的 MP4 |
| 交付 | `exportRenderPackage` | MP4、SRT（若 profile 要求）、manifest |

### 不可越界的规则

1. 冻结前必须拒绝重叠时间码；当前 reference renderer 要求视频轨道从 0 连续覆盖到项目结束，缺口必须回到 AI 提案/拍摄任务处理，不能静默输出短片。
2. 编译时重新校验素材 hash 和源片段时长；素材变化会阻止渲染。
3. 输出路径必须位于 workspace 内；素材路径也必须位于 workspace 内，不能把外部绝对路径直接带入导出任务。
4. FFmpeg 只执行 RenderIR，不负责重新选择素材、改写字幕或调用模型。
5. 默认 profile 是 1080×1920、30fps、MP4/H.264/AAC、48kHz、SRT；`OutputProfile` 对分辨率、帧率、容器、编码器和字幕方式开放，但 reference renderer 当前只执行 MP4/H.264/AAC，其他组合必须显示 capability mismatch，而不是假装支持。

## 4. 输入 fixture 与验证命令

`scripts/render-smoke.mjs` 会在 `.data/v3-render-fixture` 中生成两段带音频的竖屏测试视频，然后执行：

```bash
npm run test:render:smoke
```

通过标准：

- FFmpeg 输出可被 ffprobe 重新打开；
- 输出尺寸为 1080×1920，时长为 3500ms，包含 H.264 视频和 AAC 音频；
- SRT 时间码与两个镜头一致；
- manifest 记录输入素材 hash、`resolvedSpecHash`、输出 hash、大小和 renderer 版本；
- 同一 FrozenEditSpec 重复编译得到相同 RenderIR；
- 改变源素材 hash、产生重叠或时间缺口都会拒绝执行；
- 临时文件失败后被清理，成功产物不会被半成品覆盖。

## 5. 已知边界与下一小步

当前实现是可运行的 reference execution kernel，还不是完整 UI 功能：

- 已能从本地素材库生成可审阅 `EditProposal`，并通过 `AgentRuntimePort` 选择本地 fallback 或 APIMart AI SDK；提案请求已持久化 pending/failed/submission_unknown，freeze 仍需进入同一 CommandReceipt 边界；
- 当前 reference renderer 以连续单视频轨为基线，B-roll 先作为时间线上的可替换片段；多层 overlay、花字、ASS 烧录、转场和音频 ducking 需要在 RenderIR 合同中单独增加 golden fixture；
- 当前导出交付是 MP4 + SRT + manifest；FCPXML、OTIO、剪映草稿必须读取同一 RenderIR，再输出 `CapabilityReport/LossReport`，不能反过来当事实源；
- 当前没有让模型决定最终写盘路径、FFmpeg 参数或任意命令的权限。

下一小步按用户可见结果推进：在 `AI 粗剪` 页面展示一份基于真实项目 Script/Storyboard/Take 的提案，支持逐条接受、拒绝、替换；确认后调用本 reference kernel 导出并显示 MP4/SRT/manifest。完成后再接 provider 和本地 ASR/OCR。

## 6. 回滚与故障路径

- 提案被拒绝：不写入 FrozenEditSpec，不改原脚本和素材；用户仍可手动选择镜头。
- 素材 hash 变化：保留旧 proposal，提示重新导入/重新锁定，不覆盖上一次成功导出。
- FFmpeg 崩溃、取消、磁盘不足：删除临时文件，保留上一次 manifest 和 MP4，显示失败阶段并允许改 profile 重试。
- 输出格式不在 capability：不启动付费 provider，也不生成伪成功文件；提供 MP4/SRT 保底或导出 LossReport。

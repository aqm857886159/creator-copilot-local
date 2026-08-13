# V6 本地分析事实与素材检索

日期：2026-08-14  
状态：分析合同、whisper.cpp adapter、可选 faster-whisper Python sidecar、FFmpeg scene baseline、Apple Vision OCR adapter、SQLite FTS5、素材库显式分析动作、本地分析 Job、打包 utility worker 回写和质量评测合同 smoke 已完成；已补用户显式路径的真实 fixture 观察入口，产品质量门仍待人工 Gold

## 1. 选型决策

当前机器已存在 `/opt/homebrew/bin/whisper-cli`，说明 whisper.cpp 是可用的本地执行入口；但没有发现已安装的模型权重，也没有把未经验证的权重下载到仓库。因此本阶段把“事实合同”和“可替换执行器”先落地：

- ASR baseline：`WhisperCppTranscriber`，模型路径显式配置，默认语言 `zh`；
- 可选 ASR sidecar：`FasterWhisperSidecarTranscriber`，复用内部 e-cut 已验证的 Python runtime 方向，但必须显式提供 Python、sidecar 和模型路径，不随桌面包偷偷下载或假装内置；
- 镜头 baseline：`FfmpegSceneDetector`，读取 `showinfo` 时间点并生成有界的 `ShotFact/AnalysisFact`；它是粗切事实，不等于 TransNetV2 语义镜头理解；
- OCR baseline：`AppleVisionOcr`，FFmpeg 抽帧后调用打包进 `electron/sidecars/apple-vision-ocr.swift` 的 Swift sidecar；非 macOS 或脚本不可用时保留明确缺口，跨平台 OCR 仍可替换为 RapidOCR/PaddleOCR；
- 检索：SQLite FTS5 + 结构化 workspace/artifact 过滤，向量索引后置。

这样素材导入、事实回流和搜索合同可以先被产品验证，不会因为 1.7B/7B 模型包、Python 环境或跨平台原生库矩阵阻塞主链路。

## 2. 已实现对象

`packages/analysis/src/index.ts`：

- `TranscriptSegment`：有界的开始/结束时间、文本、语言和置信度；
- `OcrCue`：时间码、文本、归一化 bbox 和置信度；
- `ShotFact`：切点、转场类型、检测器和置信度；
- `AnalysisFact`：workspace/artifact、事实种类、时间码、标签、provider/model、内容 hash 和创建时间；
- `parseWhisperJson`：兼容 whisper.cpp 常见 `transcription / segments / offsets / timestamps` 变体；
- `WhisperCppTranscriber`：通过 runner 执行 `whisper-cli`，解析 stdout 或 JSON 文件，失败后清理临时目录；
- `transcriptFacts`：将 ASR 片段转成可持久化事实。

SQLite schema v5 增加：

- `media_analysis_facts`：事实唯一 ID、时间码和来源；
- `media_analysis_fts`：FTS5 文本/标签索引；
- `saveAnalysisFacts / getAnalysisFact / searchAnalysisFacts`：workspace 隔离、FTS 查询和 LIKE 降级。

素材库页面现在可：

```text
选择工作区 → 导入视频 → 原素材/代理/缩略图进入 catalog → 文件名/类型/分析事实搜索；重启后仍能看到每个原素材的分析 Job 状态、尝试次数和可继续动作
```

原始视频行上的“分析素材”动作会在 main 中重新校验 workspace-relative 路径和内容 hash，创建或复用 `media.analysis` Job，执行镜头检测/ASR/OCR worker，并把 `AnalysisFact` 写入同一工作区的 FTS5 索引。已有 succeeded Job 只读复用事实；failed、timed_out 和 needs_attention 通过 lease-safe 状态迁移后才能重试。

没有分析事实时显示明确空状态，不显示虚假标签。

## 3. 测试与证据

```bash
npm run typecheck
npm test
npm run build
npm run start:desktop       # packaged/dist 启动 smoke，手动终止
```

当前测试覆盖：

- whisper.cpp timestamp 字符串、秒和毫秒变体；
- transcript → AnalysisFact；
- ffmpeg `showinfo` 时间点 → bounded `ShotFact` → searchable `AnalysisFact`；
- macOS Vision OCR cue → searchable `AnalysisFact`，不改写 OCR 原文；
- runner 可替换、临时目录清理；
- schema v5 迁移；
- FTS5 写入、查询、kind 过滤、重启后查询；
- 导入产物进入 catalog，素材库可读取。
- 素材库按原始 artifact 创建/复用分析 Job，并支持按 artifactId 限定事实检索。
- `search-assets` 同时返回工作区内与可见素材关联的 `media.analysis` Job；素材列表明确区分尚未分析、待继续、分析中、已完成和失败，避免应用重启后把排队任务显示成无状态按钮。
- 正在运行的本地分析可从素材库主动取消；main 只取消自己持有的 utility worker，Job 进入 `cancelled` 并清理 lease，不会把被杀掉的旧 worker 当成成功。

本机真实 smoke（2026-08-14）：

- `/opt/homebrew/bin/ffmpeg` 抽取 1 秒视频帧；
- `swift electron/sidecars/apple-vision-ocr.swift` 返回测试画面文字、置信度和 bbox；
- 这只证明 macOS runtime/脚本边界可运行，不代表中文口播字幕的识别率、花字去重或跨平台可用性已验收。
- `scripts/analysis-quality-local-smoke.mjs` 已把 e-cut 内部获授权的 `source.mp4 + aligned.json` 接入本项目质量合同；默认 observational，不把内部对齐标注冒充盲法 Gold，也不把本次结果写成产品准确率。
- OCR 事实在写入素材库前会按标准化文本和相邻时间窗合并持续花字；否则每秒抽帧会制造重复标签，破坏搜索和账号拆解统计。

## 4. 仍未声称完成的能力

- 本机已有 faster-whisper small 缓存并通过离线 sidecar smoke，但没有真值字幕和质量报告前，不声称中文 ASR 已达标；
- Vision OCR adapter 可运行不等于中文 OCR 质量已验收；需要真实画面 fixture、准确率、重复文本合并和内存峰值评测；
- FFmpeg scene baseline 只代表粗切时间事实，不声称已经完成语义镜头拆解或视觉理解；
- FTS5 不是语义向量检索，素材量超过约 300 个镜头后再评估向量 adapter；
- FTS 查询命中失败时的 LIKE 降级只为可用性保底，不替代中文分词质量评测。

## 5. 下一步执行

1. 选定并记录一个中文 whisper.cpp 模型权重（大小、许可证、hash、内存峰值、CER/时间码 fixture）；
2. 为 Apple Vision 增加真实中文字幕/花字 fixture，评估识别率、时间覆盖和抽帧成本；Windows/Linux 再接 RapidOCR/PaddleOCR adapter，保持同一 `OcrCue/AnalysisFact` 合同；
3. 在粗切事实之上再评估 PySceneDetect/TransNetV2 精修，输出同一 `ShotFact`；
4. 将分析 Job 的失败、磁盘满、worker 崩溃和取消路径补成桌面 E2E；单条失败进入 `needs_attention`，不阻塞其他素材；
5. 已将本地时间码事实增强到 AI 剪辑提案和素材匹配证据；下一步评估跨素材语义重排和视觉模型，而不是绕过事实索引直接让模型选文件。
6. 真实 macOS arm64 UI smoke 已覆盖“导入 → apps/desktop utility worker 镜头分析 → SQLite 事实回写 → AI 剪辑导出”；质量评测记录见 [Local-Analysis-Quality-Evaluation-v0.1.md](../Local-Analysis-Quality-Evaluation-v0.1.md)；`npm run test:analysis:quality` 只验证评测器合同，下一道门是获授权中文口播 fixture、CER/WER、OCR precision/recall 和跨平台 Python/ONNX 打包。

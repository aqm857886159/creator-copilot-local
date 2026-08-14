# 本地 ASR / OCR 官方接入调研 v0.1

> 调研日期：2026-08-14
> 目标：为本地优先的中文口播素材分析确定首批可替换 adapter。本文只记录官方文档事实、当前工程决策和仍需实测的假设；不把本地校准样本当成正式质量验收。

## 结论先行

首个可交付组合是：

1. 镜头：FFmpeg `showinfo`/scene filter，已有本地 adapter。
2. ASR baseline：优先 faster-whisper sidecar（可用本地模型目录、CPU `int8`），保留 whisper.cpp adapter 作为更轻量的离线替代。
3. macOS OCR baseline：Apple Vision `VNRecognizeTextRequest`，通过 Swift sidecar 调用；跨平台 OCR 暂不在本轮伪装成已支持。
4. 所有路径、模型和运行时由用户在桌面端设置；没有模型时仍可导入、代理、镜头检测和全文检索，不阻塞素材库。

## 官方事实

### whisper.cpp

- 官方 CLI 使用 `-m/--model` 指定模型，`-oj/--output-json` 输出 JSON，`-l/--language` 指定语言；示例以 WAV 输入为主，因此媒体 worker 负责先把视频音轨转换为可接受的音频输入。
- 项目定位是本地/离线推理，并提供 Apple Silicon Metal/Core ML 等构建路径；它适合做无需 Python 的桌面 adapter，但模型权重和二进制仍要由用户或发行包明确提供。

官方来源：

- [whisper.cpp CLI README](https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/README.md)
- [whisper.cpp README](https://github.com/ggerganov/whisper.cpp/blob/master/README.md)

### faster-whisper

- 官方 Python API 通过 `WhisperModel` 加载模型；模型参数可以是本地模型目录，也可以是模型名称。
- 官方示例给出 CPU `int8` 运行方式；本项目因此把 `pythonPath`、`modelPath`、`device`、`computeType` 作为显式设置，而不是在用户不知情时下载模型。
- Python sidecar 的 stdout 只返回归一化 JSON；Electron 主进程不把 Python 对象直接暴露给 renderer。

官方来源：[faster-whisper GitHub](https://github.com/SYSTRAN/faster-whisper)

### Apple Vision OCR

- Apple 官方的 `VNRecognizeTextRequest` 支持文本识别、fast/accurate 识别级别和候选置信度；识别结果包含归一化 bounding box。
- 官方文档列出简体中文 `zh-Hans`、繁体中文 `zh-Hant` 等语言；本项目 sidecar 默认由系统能力决定，不把 Vision 当作 Windows/Linux OCR 方案。
- OCR 通过视频抽帧实现，抽帧间隔是可配置参数；重复花字会在领域层合并，避免素材库被同一条字幕污染。

官方来源：[Recognizing text in images — Apple Developer Documentation](https://developer.apple.com/documentation/vision/recognizing-text-in-images)

## 工程边界

- `packages/analysis` 只输出 `AnalysisFact`（transcript/ocr/shot）和 adapter contract；不持有密钥、不写 SQLite。
- Electron main 进程负责读取经过 schema 校验的本地设置、验证路径、启动 utility process；renderer 可以看到用户主动选择的本地路径（用于复核），但不会拿到 fs/process API 或任何密钥。
- 设置页中的“就绪”只表示所选路径存在且类型正确，不等同于模型可加载、Python 可 import、二进制可执行或中文质量已验证；首次分析仍会做运行时校验并把失败降级为可观察的 partial 结果。
- faster-whisper worker 强制设置 `HF_HUB_OFFLINE=1`，模型目录缺失时不会由桌面端隐式访问 Hugging Face；若未来支持远程模型，必须另设显式 Provider 和权限边界。
- 真实模型下载、跨平台 OCR、VLM 语义标注和大规模质量 Gold corpus 后置；本轮不因“设置页显示 ready”而声称质量通过。
- 任何真实联调均使用单个用户明确选择的本地视频，不批量抓取、不调用 TikHub/APIMart，不产生云端费用。

## 待验证假设

1. 中文口播的 segment 边界和时间戳需要独立校准；文本 CER 为零不代表切段和时间码可直接用于字幕。
2. Apple Vision 对视频花字的召回受抽帧间隔、字号和运动影响，默认 1 秒仅是开发参数。
3. whisper.cpp 与 faster-whisper 的模型/量化/许可证组合必须在发行包清单中单独记录，不能只依赖 npm lockfile。

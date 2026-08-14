# 本地 ASR / OCR 质量与运行时评测 v0.1

日期：2026-08-14  
状态：运行时边界已验证；尚未达到产品质量门，不能把本机结果当作中文口播准确率承诺

## 1. 这次评测回答什么

当前项目已有 `whisper.cpp`、FFmpeg scene 和 Apple Vision OCR 的合同，但开发机没有 whisper.cpp 权重。调研内部 `e-cut` 时发现其 Python 环境已经安装并缓存了：

- Faster-Whisper small（离线模型快照，模型来源/许可证仍需随发行包单独核验）；
- RapidOCR ONNX（PP-OCR 系列模型文件已在该环境中存在）；
- e-cut 的实现把 ASR、OCR 分成独立 worker，并强调每条时间码保持素材本地坐标。

我们没有复制 e-cut 的代码、模型或素材，只复用了它已经验证过的运行时分层思路，并在本项目新增了显式的 `FasterWhisperSidecarTranscriber` adapter。

## 2. 已运行的本机 smoke

### ASR：Faster-Whisper small

输入是 e-cut 内部测试音频的脱敏/内部 fixture，不进入本仓库。使用 `HF_HUB_OFFLINE=1`、CPU、int8、中文语言和 word timestamp 模式，通过本项目的 `apps/desktop/sidecars/faster-whisper-sidecar.py` 运行。

观察结果：模型返回 8 段中文转写，时间码均为有界的秒值，示例：

```text
3.66–5.30  一天天坚持
8.44–9.64  一点点积累
18.71–19.93  所有蓄过的力
20.55–22.27  会变成此刻的光
28.54–29.34  伊利
```

这证明了：本地 Python runtime、模型加载、中文转写和时间码转换可以工作；它没有证明 CER/WER、长视频吞吐、口音、背景音乐和内存峰值已经达标。样本中也出现了疑似专名误识别，必须在有真值字幕的 fixture 上评测。

以后可用以下命令重复运行同一类 smoke；默认跳过，只有显式提供本地 Python、模型和输入文件才会执行，不会联网下载模型：

```bash
npm run test:analysis:sidecar
ANALYSIS_SIDECAR_LIVE=1 \
FASTER_WHISPER_PYTHON=/path/to/python \
FASTER_WHISPER_MODEL=/path/to/model \
ANALYSIS_SIDECAR_INPUT=/path/to/input.wav \
HF_HUB_OFFLINE=1 npm run test:analysis:sidecar
```

### OCR：RapidOCR 与 Apple Vision 的方向判断

同一张 e-cut 内部界面截图上：

- RapidOCR ONNX 返回 25 个文字框，单次调用可拆成文字、置信度和坐标；
- Apple Vision 返回 5 个结果，其中部分文本置信度较低且存在明显错字。

这不是严格的 benchmark（截图不是花字真值集，两个 runtime 的预处理也不同），但足以支持当前工程判断：桌面跨平台 OCR 应优先做 RapidOCR/PaddleOCR sidecar；Apple Vision 保留为 macOS 零安装 adapter，不能作为所有平台的唯一基线。

## 3. 代码边界

`FasterWhisperSidecarTranscriber` 只有在调用方同时提供 Python executable、sidecar 脚本和模型路径时才启用。默认仍保持“未配置本地 ASR 模型”，避免把开发机缓存误包装成产品内置能力。

sidecar 只输出 JSON transcript，不写 SQLite、不写任意路径、不执行素材文本中的指令；main/utility worker 负责 Job、取消、lease、事实校验和落库。

项目现在有一个不依赖模型的质量合同 smoke：`packages/analysis/fixtures/quality-smoke.json` 保存人工真值/假设输出，评测器计算文本 CER、时间码平均误差、分段召回、OCR precision/recall 和 bbox IoU。报告同时返回 6 个机器可读 gate result 和失败诊断，便于 CI/桌面端明确指出哪一项没有达标。用 `npm run test:analysis:quality` 可验证评测器和 schema；这个 fixture 只证明评测逻辑，不代表任何模型准确率。

## 4. 已补的本地真实 fixture 观察入口

项目现在提供一个不携带媒体和标注的本地观察脚本：它读取用户显式指定的 e-cut/自有视频、`aligned.json` 和本地 Faster-Whisper 模型，按同一套合同计算 CER、分段召回和时间码误差；macOS 上可选同时跑 Apple Vision OCR。默认只报告，不把宽松默认阈值冒充产品质量门：

```bash
ANALYSIS_QUALITY_LIVE=1 \
ANALYSIS_QUALITY_INPUT=/path/to/source.mp4 \
ANALYSIS_QUALITY_REFERENCE=/path/to/aligned.json \
FASTER_WHISPER_PYTHON=/path/to/python \
FASTER_WHISPER_MODEL=/path/to/local/model \
ANALYSIS_QUALITY_RUN_OCR=1 \
HF_HUB_OFFLINE=1 npm run test:analysis:quality:local
```

脚本为 `scripts/analysis-quality-local-smoke.mjs`，不会打印媒体内容、账号、原始识别文本或模型绝对路径，也不会联网下载。2026-08-14 的两次观察结果为：e-cut 运动口播 fixture 的 Faster-Whisper 返回 8 段、参考 10 段，CER `7.14%`、分段召回 `50%`、时间码 MAE `440ms`（最大漂移 `1460ms`）；e-cut 花字 fixture 的 Apple Vision 原始 50 条经合并为 10 条，与 10 条参考花字 precision/recall 均为 `1.0`。前者说明本地 ASR 可用但仍有漏段/专名风险，后者证明“持续花字合并”是必要的事实层能力；`aligned/storyboard.json` 是内部分析对齐标注而非盲法人工 Gold，所以这些结果只作为选型和失败样本记录，不能写成中文准确率承诺。真正的质量门仍需 5–10 条自有/获授权且人工复核的口播 Gold。

## 5. 下一道质量门

1. 建立 5–10 条自有/获授权的 9:16 中文口播 fixture，保存人工校对字幕、分镜切点和屏幕文字真值；
2. ASR 记录 CER/WER、首字延迟、实时倍率、内存峰值和时间码漂移；
3. OCR 记录文本 precision/recall、重复花字合并率、bbox IoU、抽帧成本和低置信度漏报；
4. 对 Faster-Whisper、whisper.cpp、Qwen3-ASR/FireRedASR2（若模型权利和运行时可接受）做同一合同的 adapter 对比；
5. 明确模型权重、字体、Python/ONNX runtime 的许可证、hash、下载方式和 Windows x64 打包策略；
6. 质量门通过前，UI 只显示“事实来源与覆盖状态”，不显示未经验证的“准确率”或“智能拆解完成”。

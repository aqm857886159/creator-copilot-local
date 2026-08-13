# V6 本地分析事实与素材检索

日期：2026-08-14  
状态：分析合同、whisper.cpp adapter、SQLite FTS5 和素材库页面已完成；真实中文模型权重与 OCR/镜头后端待单独安装验收

## 1. 选型决策

当前机器已存在 `/opt/homebrew/bin/whisper-cli`，说明 whisper.cpp 是可用的本地执行入口；但没有发现已安装的模型权重，也没有把未经验证的权重下载到仓库。因此本阶段把“事实合同”和“可替换执行器”先落地：

- ASR baseline：`WhisperCppTranscriber`，模型路径显式配置，默认语言 `zh`；
- OCR：暂不伪造已安装状态，下一步接 RapidOCR/PaddleOCR adapter；
- 镜头检测：暂不把 PySceneDetect/TransNetV2 当成已完成，下一步接 worker；
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
选择工作区 → 导入视频 → 原素材/代理/缩略图进入 catalog → 文件名/类型/分析事实搜索
```

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
- runner 可替换、临时目录清理；
- schema v5 迁移；
- FTS5 写入、查询、kind 过滤、重启后查询；
- 导入产物进入 catalog，素材库可读取。

## 4. 仍未声称完成的能力

- 没有模型权重时，不声称本机已完成中文 ASR；
- 没有 OCR worker 时，不声称 OCR 已完成；
- 没有镜头检测 worker 时，不声称镜头拆解已完成；
- FTS5 不是语义向量检索，素材量超过约 300 个镜头后再评估向量 adapter；
- FTS 查询命中失败时的 LIKE 降级只为可用性保底，不替代中文分词质量评测。

## 5. 下一步执行

1. 选定并记录一个中文 whisper.cpp 模型权重（大小、许可证、hash、内存峰值、CER/时间码 fixture）；
2. 接 RapidOCR/PaddleOCR 的本地 subprocess adapter，输出同一 `OcrCue/AnalysisFact`；
3. 接 PySceneDetect 粗切 + TransNetV2 精修，输出 `ShotFact`；
4. 导入 Job 统一调度 ASR/OCR/shot，单条失败进入 `needs_attention`，不阻塞其他素材；
5. 用真实时间码事实增强 AI 剪辑提案和素材匹配证据。

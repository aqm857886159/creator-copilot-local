const { parentPort } = process;
const { existsSync } = require("node:fs");
const path = require("node:path");

let runtimePromise;

async function getRuntime() {
  if (!runtimePromise) {
    const candidateRoots = [
      path.join(__dirname, "..", "..", "dist-electron", "packages"),
      path.join(process.resourcesPath ?? "", "app.asar", "dist-electron", "packages"),
    ];
    const runtimeRoot = candidateRoots.find((candidate) => existsSync(candidate));
    if (!runtimeRoot) throw new Error("analysis worker 找不到 dist-electron runtime");
    runtimePromise = Promise.all([
      import(require("node:url").pathToFileURL(path.join(runtimeRoot, "media", "src", "index.js")).href),
      import(require("node:url").pathToFileURL(path.join(runtimeRoot, "analysis", "src", "index.js")).href),
    ]).then(([media, analysis]) => ({ media, analysis }));
  }
  return runtimePromise;
}

if (!parentPort) throw new Error("analysis worker 缺少 parentPort");

parentPort.on("message", async (event) => {
  // Electron's parentPort emits a MessageEvent-like object (`{ data, ports }`),
  // while older local tests passed the payload directly. Normalize both so the
  // worker protocol remains compatible during the desktop entry migration.
  const message = event && typeof event === "object" && "data" in event ? event.data : event;
  const requestId = message && typeof message.requestId === "string" ? message.requestId : "unknown";
  try {
    const payload = message?.payload;
    if (!payload || typeof payload.sourcePath !== "string" || !Number.isInteger(payload.durationMs) || payload.durationMs <= 0) throw new Error("analysis worker 输入无效");
    const runtime = await getRuntime();
    const shots = await new runtime.analysis.FfmpegSceneDetector().detect(payload.sourcePath, payload.durationMs);
    const createdAt = typeof payload.createdAt === "string" ? payload.createdAt : new Date().toISOString();
    const facts = runtime.analysis.shotFacts({ workspaceId: payload.workspaceId, artifactId: payload.artifactId, shots, providerKey: "ffmpeg-scene", modelKey: "showinfo", contentHash: payload.contentHash, createdAt });
    let asrStatus = "未配置本地 ASR 模型";
    let asrReady = false;
    if (typeof payload.whisperModelPath === "string" && payload.whisperModelPath) {
      const segments = await new runtime.analysis.WhisperCppTranscriber({ modelPath: payload.whisperModelPath, binaryPath: payload.whisperBinaryPath, language: "zh" }).transcribe(payload.sourcePath);
      facts.push(...runtime.analysis.transcriptFacts({ workspaceId: payload.workspaceId, artifactId: payload.artifactId, segments, providerKey: "whisper.cpp", modelKey: path.basename(payload.whisperModelPath), contentHash: payload.contentHash, createdAt }));
      asrStatus = `ASR 已完成（${segments.length} 段）`;
      asrReady = true;
    } else if (typeof payload.fasterWhisperModelPath === "string" && payload.fasterWhisperModelPath && typeof payload.fasterWhisperPythonPath === "string" && payload.fasterWhisperPythonPath && typeof payload.fasterWhisperScriptPath === "string" && payload.fasterWhisperScriptPath) {
      const segments = await new runtime.analysis.FasterWhisperSidecarTranscriber({ modelPath: payload.fasterWhisperModelPath, scriptPath: payload.fasterWhisperScriptPath, pythonPath: payload.fasterWhisperPythonPath, language: "zh", device: payload.fasterWhisperDevice, computeType: payload.fasterWhisperComputeType }).transcribe(payload.sourcePath);
      facts.push(...runtime.analysis.transcriptFacts({ workspaceId: payload.workspaceId, artifactId: payload.artifactId, segments, providerKey: "faster-whisper", modelKey: path.basename(payload.fasterWhisperModelPath), contentHash: payload.contentHash, createdAt }));
      asrStatus = `ASR 已完成（${segments.length} 段）`;
      asrReady = true;
    }
    let ocrStatus = "未配置 Apple Vision OCR";
    let ocrReady = false;
    if (process.platform === "darwin" && typeof payload.visionScriptPath === "string" && payload.visionScriptPath) {
      try {
        const cues = await new runtime.analysis.AppleVisionOcr({ scriptPath: payload.visionScriptPath, binaryPath: payload.visionBinaryPath, sampleIntervalMs: payload.visionSampleIntervalMs }).recognize(payload.sourcePath, payload.durationMs);
        const mergedCues = runtime.analysis.mergeOcrCues(cues, Math.max(1_500, Number(payload.visionSampleIntervalMs ?? 1_000) + 500));
        facts.push(...runtime.analysis.ocrFacts({ workspaceId: payload.workspaceId, artifactId: payload.artifactId, cues: mergedCues, providerKey: "apple-vision", modelKey: "VNRecognizeTextRequest", contentHash: payload.contentHash, createdAt }));
        ocrStatus = `OCR 已完成（${mergedCues.length} 条，已合并重复花字）`;
        ocrReady = true;
      } catch (error) {
        ocrStatus = `OCR 失败：${error instanceof Error ? error.message : "未知错误"}`;
      }
    }
    parentPort.postMessage({ requestId, ok: true, result: { facts, shotCount: shots.length, asrStatus, ocrStatus, asrReady, ocrReady, summary: `镜头粗切 ${shots.length} 段；${asrStatus}；${ocrStatus}。` } });
  } catch (error) {
    parentPort.postMessage({ requestId, ok: false, error: error instanceof Error ? error.message : "媒体分析 worker 失败" });
  }
});

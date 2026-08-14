import { z } from "zod";

const optionalPath = z.string().min(1).max(4_096).refine((value) => value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\"), "本地分析路径必须是绝对路径").optional();

export const LocalAnalysisEngineSchema = z.enum(["disabled", "whisper.cpp", "faster-whisper", "apple-vision"]);
export type LocalAnalysisEngine = z.infer<typeof LocalAnalysisEngineSchema>;

export const LocalAnalysisSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  asr: z.object({
    engine: z.enum(["disabled", "whisper.cpp", "faster-whisper"]),
    modelPath: optionalPath,
    binaryPath: optionalPath,
    pythonPath: optionalPath,
    scriptPath: optionalPath,
    language: z.string().min(1).max(20),
    device: z.enum(["auto", "cpu", "cuda"]),
    computeType: z.string().min(1).max(40),
  }).strict(),
  ocr: z.object({
    engine: z.enum(["disabled", "apple-vision"]),
    scriptPath: optionalPath,
    binaryPath: optionalPath,
    sampleIntervalMs: z.number().int().min(250).max(30_000),
  }).strict(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type LocalAnalysisSettings = z.infer<typeof LocalAnalysisSettingsSchema>;

export const DEFAULT_LOCAL_ANALYSIS_SETTINGS: LocalAnalysisSettings = {
  schemaVersion: 1,
  asr: {
    engine: "disabled",
    language: "zh",
    device: "cpu",
    computeType: "int8",
  },
  ocr: {
    engine: "disabled",
    sampleIntervalMs: 1_000,
  },
  updatedAt: "1970-01-01T00:00:00.000Z",
};

export const LocalAnalysisSettingsPatchSchema = LocalAnalysisSettingsSchema.partial({
  asr: true,
  ocr: true,
  updatedAt: true,
});

export function parseLocalAnalysisSettings(input: unknown) {
  return LocalAnalysisSettingsSchema.parse(input);
}

export function mergeLocalAnalysisSettings(base: LocalAnalysisSettings, patch: unknown, updatedAt = new Date().toISOString()) {
  const candidate = patch && typeof patch === "object" ? patch as Record<string, unknown> : {};
  const next = {
    ...base,
    ...candidate,
    asr: { ...base.asr, ...(candidate.asr && typeof candidate.asr === "object" ? candidate.asr : {}) },
    ocr: { ...base.ocr, ...(candidate.ocr && typeof candidate.ocr === "object" ? candidate.ocr : {}) },
    updatedAt,
  };
  return LocalAnalysisSettingsSchema.parse(next);
}

export function workerAnalysisSettings(input: LocalAnalysisSettings) {
  return {
    whisperModelPath: input.asr.engine === "whisper.cpp" ? input.asr.modelPath : undefined,
    whisperBinaryPath: input.asr.engine === "whisper.cpp" ? input.asr.binaryPath : undefined,
    fasterWhisperModelPath: input.asr.engine === "faster-whisper" ? input.asr.modelPath : undefined,
    fasterWhisperPythonPath: input.asr.engine === "faster-whisper" ? input.asr.pythonPath : undefined,
    fasterWhisperScriptPath: input.asr.engine === "faster-whisper" ? input.asr.scriptPath : undefined,
    fasterWhisperDevice: input.asr.engine === "faster-whisper" ? input.asr.device : undefined,
    fasterWhisperComputeType: input.asr.engine === "faster-whisper" ? input.asr.computeType : undefined,
    language: input.asr.language,
    visionScriptPath: input.ocr.engine === "apple-vision" ? input.ocr.scriptPath : undefined,
    visionBinaryPath: input.ocr.engine === "apple-vision" ? input.ocr.binaryPath : undefined,
    visionSampleIntervalMs: input.ocr.sampleIntervalMs,
  };
}

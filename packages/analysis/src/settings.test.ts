import { describe, expect, it } from "vitest";
import { DEFAULT_LOCAL_ANALYSIS_SETTINGS, LocalAnalysisSettingsSchema, mergeLocalAnalysisSettings, workerAnalysisSettings } from "./settings";

describe("local analysis settings contract", () => {
  it("round trips the strict default and rejects unknown fields", () => {
    expect(LocalAnalysisSettingsSchema.parse(DEFAULT_LOCAL_ANALYSIS_SETTINGS)).toEqual(DEFAULT_LOCAL_ANALYSIS_SETTINGS);
    expect(LocalAnalysisSettingsSchema.safeParse({ ...DEFAULT_LOCAL_ANALYSIS_SETTINGS, unexpected: true }).success).toBe(false);
    expect(LocalAnalysisSettingsSchema.safeParse({ ...DEFAULT_LOCAL_ANALYSIS_SETTINGS, ocr: { ...DEFAULT_LOCAL_ANALYSIS_SETTINGS.ocr, sampleIntervalMs: 100 } }).success).toBe(false);
    expect(LocalAnalysisSettingsSchema.safeParse({ ...DEFAULT_LOCAL_ANALYSIS_SETTINGS, asr: { ...DEFAULT_LOCAL_ANALYSIS_SETTINGS.asr, engine: "whisper.cpp", modelPath: "models/ggml-small.bin" } }).success).toBe(false);
  });

  it("merges nested settings without allowing partial invalid values to pass", () => {
    const next = mergeLocalAnalysisSettings(DEFAULT_LOCAL_ANALYSIS_SETTINGS, { asr: { engine: "faster-whisper", modelPath: "/models/small", pythonPath: "/venv/bin/python", scriptPath: "/sidecar.py" } }, "2026-08-14T00:00:00.000Z");
    expect(next.asr).toMatchObject({ engine: "faster-whisper", modelPath: "/models/small", pythonPath: "/venv/bin/python", scriptPath: "/sidecar.py", language: "zh", device: "cpu", computeType: "int8" });
    expect(() => mergeLocalAnalysisSettings(DEFAULT_LOCAL_ANALYSIS_SETTINGS, { ocr: { sampleIntervalMs: 100 } })).toThrow();
  });

  it("only enables the selected engine in the worker payload", () => {
    const faster = mergeLocalAnalysisSettings(DEFAULT_LOCAL_ANALYSIS_SETTINGS, { asr: { engine: "faster-whisper", modelPath: "/models/small", pythonPath: "/venv/bin/python", scriptPath: "/sidecar.py" }, ocr: { engine: "apple-vision", scriptPath: "/vision.swift" } });
    expect(workerAnalysisSettings(faster)).toMatchObject({ fasterWhisperModelPath: "/models/small", fasterWhisperPythonPath: "/venv/bin/python", visionScriptPath: "/vision.swift" });
    expect(workerAnalysisSettings(faster).whisperModelPath).toBeUndefined();
  });
});

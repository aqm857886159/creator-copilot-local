import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { AppleVisionOcr, evaluateOcrQuality, evaluateTranscriptQuality, FasterWhisperSidecarTranscriber, FfmpegSceneDetector, ocrFacts, parseSceneTimestamps, parseWhisperJson, searchQueryForFts, shotFacts, transcriptFacts, WhisperCppTranscriber } from "./index";

describe("local analysis facts", () => {
  it("normalizes whisper.cpp timestamp variants into bounded transcript segments", () => {
    const segments = parseWhisperJson({ transcription: [{ timestamps: { from: "00:00:00.120", to: "00:00:01.500" }, text: "先把观点讲清楚。" }, { offsets: { from: 1500, to: 2500 }, text: "再让画面补证据。" }] });
    expect(segments).toMatchObject([{ startMs: 120, endMs: 1500 }, { startMs: 1500, endMs: 2500 }]);
    expect(transcriptFacts({ workspaceId: "workspace-1", artifactId: "asset-1", segments, providerKey: "whisper.cpp", modelKey: "ggml-small", contentHash: "sha256:asset", createdAt: "2026-08-14T00:00:00.000Z" })[0]).toMatchObject({ kind: "transcript", text: "先把观点讲清楚。" });
  });

  it("keeps FTS query construction deterministic", () => {
    expect(searchQueryForFts("  观点  画面 ")).toBe('"观点"* AND "画面"*');
  });

  it("measures transcript text and timestamp quality against a reference", () => {
    const reference = [{ startMs: 0, endMs: 1000, text: "先把观点讲清楚。" }, { startMs: 1000, endMs: 2000, text: "再让画面提供证据。" }];
    const hypothesis = [{ startMs: 0, endMs: 1000, text: "先把观点讲清楚" }, { startMs: 1000, endMs: 2050, text: "再让画面提供证据" }];
    expect(evaluateTranscriptQuality(reference, hypothesis)).toMatchObject({ cer: 0, segmentRecall: 1, timestampMaeMs: 12.5 });
    expect(evaluateTranscriptQuality(reference, [{ ...hypothesis[0], text: "先把观点讲明白" }, hypothesis[1]]).cer).toBeGreaterThan(0);
  });

  it("matches OCR text only once and reports bbox overlap", () => {
    const cue = { startMs: 0, endMs: 1000, text: "重点：先讲结论", bbox: { x: 0.1, y: 0.2, width: 0.4, height: 0.1 } };
    expect(evaluateOcrQuality([cue], [{ ...cue, text: "重点 先讲结论" }])).toMatchObject({ precision: 1, recall: 1, bboxIoUMean: 1 });
    expect(evaluateOcrQuality([cue], [{ ...cue, text: "另一个词" }])).toMatchObject({ precision: 0, recall: 0 });
  });

  it("invokes whisper.cpp through a replaceable runner and cleans temporary output", async () => {
    const calls: Array<{ binary: string; args: string[] }> = [];
    const transcriber = new WhisperCppTranscriber({ modelPath: "/models/ggml-small.bin", runner: async (binary, args) => { calls.push({ binary, args }); return { stdout: JSON.stringify({ segments: [{ start: 0, end: 1.2, text: "测试转写" }] }), stderr: "" }; } });
    await expect(transcriber.transcribe("/tmp/input.wav")).resolves.toMatchObject([{ text: "测试转写", startMs: 0, endMs: 1200 }]);
    expect(calls[0]).toMatchObject({ binary: "whisper-cli", args: expect.arrayContaining(["-m", "/models/ggml-small.bin", "-oj", "-np", "-l", "zh"]) });
  });

  it("keeps faster-whisper behind an explicit Python sidecar contract", async () => {
    const calls: Array<{ binary: string; args: string[] }> = [];
    const transcriber = new FasterWhisperSidecarTranscriber({ modelPath: "/models/faster-whisper-small", scriptPath: "/sidecars/faster-whisper-sidecar.py", pythonPath: "/venv/bin/python", runner: async (binary, args) => { calls.push({ binary, args }); return { stdout: JSON.stringify({ language: "zh", segments: [{ start: 3.66, end: 5.3, text: "一天天坚持", language: "zh" }] }), stderr: "" }; } });
    await expect(transcriber.transcribe("/workspace/source.mp4")).resolves.toMatchObject([{ text: "一天天坚持", startMs: 3660, endMs: 5300 }]);
    expect(calls[0]).toMatchObject({ binary: "/venv/bin/python", args: expect.arrayContaining(["--model", "/models/faster-whisper-small", "--language", "zh", "--compute-type", "int8"]) });
  });

  it("turns ffmpeg showinfo scene points into bounded shot facts", async () => {
    expect(parseSceneTimestamps("[showinfo] pts_time:0.50\n[showinfo] pts_time:0.52\n[showinfo] pts_time:2.0", 3000)).toEqual([500, 2000]);
    const calls: Array<{ binary: string; args: string[] }> = [];
    const detector = new FfmpegSceneDetector({ runner: async (binary, args) => { calls.push({ binary, args }); return { stdout: "", stderr: "[showinfo] pts_time:0.50\n[showinfo] pts_time:2.0" }; } });
    const shots = await detector.detect("/tmp/video.mp4", 3000);
    expect(shots).toMatchObject([{ startMs: 0, endMs: 500, transition: "unknown" }, { startMs: 500, endMs: 2000, transition: "cut" }, { startMs: 2000, endMs: 3000, transition: "cut" }]);
    expect(calls[0].args).toContain("-f");
    const facts = shotFacts({ workspaceId: "workspace-1", artifactId: "artifact-1", shots, providerKey: "ffmpeg-scene", contentHash: "sha256:video", createdAt: "2026-08-14T00:00:00.000Z" });
    expect(facts).toHaveLength(3);
    expect(facts[1]).toMatchObject({ kind: "shot", labels: ["cut", "ffmpeg-scene"] });
  });

  it("normalizes Apple Vision OCR output into time-bounded cues and facts", async () => {
    const ocr = new AppleVisionOcr({ scriptPath: "/tmp/apple-vision-ocr.swift", sampleIntervalMs: 1000, runner: async (binary, args) => {
      if (binary === "ffmpeg") {
        const outputPattern = args.at(-1)!;
        await writeFile(outputPattern.replace("%05d", "00001"), "fixture");
        return { stdout: "", stderr: "" };
      }
      return { stdout: JSON.stringify([{ path: args.at(-1), text: "画面文字", confidence: 0.91, bbox: { x: 0.1, y: 0.2, width: 0.4, height: 0.1 } }]), stderr: "" };
    } });
    const cues = await ocr.recognize("/tmp/video.mp4", 2500);
    expect(cues).toMatchObject([{ startMs: 0, endMs: 1000, text: "画面文字", confidence: 0.91 }]);
    expect(ocrFacts({ workspaceId: "workspace-1", artifactId: "artifact-1", cues, providerKey: "apple-vision", modelKey: "VNRecognizeTextRequest", contentHash: "sha256:video", createdAt: "2026-08-14T00:00:00.000Z" })[0]).toMatchObject({ kind: "ocr", text: "画面文字" });
  });
});

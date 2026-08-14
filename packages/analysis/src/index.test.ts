import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { AppleVisionOcr, evaluateAnalysisQualityFixture, evaluateOcrQuality, evaluateTranscriptQuality, FasterWhisperSidecarTranscriber, FfmpegSceneDetector, mergeOcrCues, ocrFacts, parseSceneTimestamps, parseWhisperJson, rankAssetCandidates, searchQueryForFts, shotFacts, transcriptFacts, WhisperCppTranscriber } from "./index";

describe("local analysis facts", () => {
  it("normalizes whisper.cpp timestamp variants into bounded transcript segments", () => {
    const segments = parseWhisperJson({ transcription: [{ timestamps: { from: "00:00:00.120", to: "00:00:01.500" }, text: "先把观点讲清楚。" }, { offsets: { from: 1500, to: 2500 }, text: "再让画面补证据。" }] });
    expect(segments).toMatchObject([{ startMs: 120, endMs: 1500 }, { startMs: 1500, endMs: 2500 }]);
    expect(transcriptFacts({ workspaceId: "workspace-1", artifactId: "asset-1", segments, providerKey: "whisper.cpp", modelKey: "ggml-small", contentHash: "sha256:asset", createdAt: "2026-08-14T00:00:00.000Z" })[0]).toMatchObject({ kind: "transcript", text: "先把观点讲清楚。" });
  });

  it("keeps FTS query construction deterministic", () => {
    expect(searchQueryForFts("  观点  画面 ")).toBe('"观点"* AND "画面"*');
  });

  it("ranks local asset candidates by Chinese fact matches and preserves evidence timecodes", () => {
    const result = rankAssetCandidates({
      queries: [{ shotId: "shot-proof", instruction: "拍一段手机屏幕里的真实数据", scriptText: "数据比感觉更能证明观点", mode: "screen_recording", framing: "screen", targetMs: 2_000 }],
      assets: [
        { assetId: "asset-screen", relativePath: "originals/screen.mp4", contentHash: "sha256:screen", durationMs: 4_000, facts: [{ id: "fact-screen", kind: "ocr", startMs: 300, endMs: 1_800, text: "真实数据趋势", labels: ["ocr", "屏幕"] }] },
        { assetId: "asset-room", relativePath: "originals/room.mp4", contentHash: "sha256:room", durationMs: 4_000, facts: [{ id: "fact-room", kind: "shot", startMs: 0, endMs: 4_000, text: "人物中景", labels: ["cut"] }] },
      ],
    });
    expect(result[0].candidates[0]).toMatchObject({ assetId: "asset-screen", confidence: "medium", evidenceIds: ["fact-screen"], sourceSegment: { startMs: 300, endMs: 1_800 } });
    expect(result[0].candidates[0].reason).toContain("本地事实");
  });

  it("keeps candidate ranking deterministic and does not return unanalysed assets", () => {
    const input = { queries: [{ shotId: "shot-1", instruction: "真实物件", mode: "broll" as const }], assets: [{ assetId: "asset-a", relativePath: "a.mp4", contentHash: "sha256:a", facts: [{ id: "fact-a", kind: "ocr" as const, startMs: 0, endMs: 500, text: "真实物件", labels: [] }] }, { assetId: "asset-empty", relativePath: "empty.mp4", contentHash: "sha256:empty", facts: [] }] };
    const first = rankAssetCandidates(input);
    const second = rankAssetCandidates(input);
    expect(first).toEqual(second);
    expect(first[0].candidates.map((candidate) => candidate.assetId)).toEqual(["asset-a"]);
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

  it("returns machine-readable quality gate failures instead of only a boolean", () => {
    const report = evaluateAnalysisQualityFixture({
      schemaVersion: 1,
      name: "failed-quality-fixture",
      transcript: { reference: [{ startMs: 0, endMs: 1000, text: "观点" }], hypothesis: [], gates: { cerMax: 0, segmentRecallMin: 1, timestampMaeMaxMs: 100 } },
      ocr: { reference: [{ startMs: 0, endMs: 1000, text: "标题", bbox: { x: 0, y: 0, width: 0.2, height: 0.2 } }], hypothesis: [], gates: { precisionMin: 1, recallMin: 1, bboxIoUMin: 1 } },
    });
    expect(report.passed).toBe(false);
    expect(report.gateResults).toHaveLength(6);
    expect(report.failures.map((failure) => failure.id)).toEqual(expect.arrayContaining(["transcript.cer", "transcript.segmentRecall", "ocr.recall"]));
    expect(report.failures[0]).toHaveProperty("message");
  });

  it("passes the bundled synthetic Chinese contract fixture and exposes all gates", () => {
    const report = evaluateAnalysisQualityFixture({
      schemaVersion: 1,
      name: "synthetic-zh-quality",
      transcript: { reference: [{ startMs: 0, endMs: 1000, text: "先讲结论。" }], hypothesis: [{ startMs: 0, endMs: 1000, text: "先讲结论" }], gates: { cerMax: 0, segmentRecallMin: 1, timestampMaeMaxMs: 0 } },
      ocr: { reference: [{ startMs: 0, endMs: 1000, text: "重点：结论", bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }], hypothesis: [{ startMs: 0, endMs: 1000, text: "重点 结论", bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }], gates: { precisionMin: 1, recallMin: 1, bboxIoUMin: 1 } },
    });
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.gateResults.every((gate) => gate.passed)).toBe(true);
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

  it("merges persistent OCR overlays without merging separated repeats", () => {
    const cues = [
      { schemaVersion: 1 as const, id: "ocr-1", startMs: 0, endMs: 1000, text: "SHOT 1", confidence: 0.6 },
      { schemaVersion: 1 as const, id: "ocr-2", startMs: 0, endMs: 1000, text: "标题", confidence: 0.7 },
      { schemaVersion: 1 as const, id: "ocr-3", startMs: 1000, endMs: 2000, text: "SHOT 1", confidence: 0.9 },
      { schemaVersion: 1 as const, id: "ocr-4", startMs: 1000, endMs: 2000, text: "标题", confidence: 0.8 },
      { schemaVersion: 1 as const, id: "ocr-5", startMs: 5000, endMs: 6000, text: "SHOT 1", confidence: 0.8 },
    ];
    expect(mergeOcrCues(cues)).toMatchObject([{ id: "ocr-1", startMs: 0, endMs: 2000, confidence: 0.9 }, { id: "ocr-2", startMs: 0, endMs: 2000, confidence: 0.8 }, { id: "ocr-5", startMs: 5000, endMs: 6000 }]);
  });
});

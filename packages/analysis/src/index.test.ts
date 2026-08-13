import { describe, expect, it } from "vitest";
import { FfmpegSceneDetector, parseSceneTimestamps, parseWhisperJson, searchQueryForFts, shotFacts, transcriptFacts, WhisperCppTranscriber } from "./index";

describe("local analysis facts", () => {
  it("normalizes whisper.cpp timestamp variants into bounded transcript segments", () => {
    const segments = parseWhisperJson({ transcription: [{ timestamps: { from: "00:00:00.120", to: "00:00:01.500" }, text: "先把观点讲清楚。" }, { offsets: { from: 1500, to: 2500 }, text: "再让画面补证据。" }] });
    expect(segments).toMatchObject([{ startMs: 120, endMs: 1500 }, { startMs: 1500, endMs: 2500 }]);
    expect(transcriptFacts({ workspaceId: "workspace-1", artifactId: "asset-1", segments, providerKey: "whisper.cpp", modelKey: "ggml-small", contentHash: "sha256:asset", createdAt: "2026-08-14T00:00:00.000Z" })[0]).toMatchObject({ kind: "transcript", text: "先把观点讲清楚。" });
  });

  it("keeps FTS query construction deterministic", () => {
    expect(searchQueryForFts("  观点  画面 ")).toBe('"观点"* AND "画面"*');
  });

  it("invokes whisper.cpp through a replaceable runner and cleans temporary output", async () => {
    const calls: Array<{ binary: string; args: string[] }> = [];
    const transcriber = new WhisperCppTranscriber({ modelPath: "/models/ggml-small.bin", runner: async (binary, args) => { calls.push({ binary, args }); return { stdout: JSON.stringify({ segments: [{ start: 0, end: 1.2, text: "测试转写" }] }), stderr: "" }; } });
    await expect(transcriber.transcribe("/tmp/input.wav")).resolves.toMatchObject([{ text: "测试转写", startMs: 0, endMs: 1200 }]);
    expect(calls[0]).toMatchObject({ binary: "whisper-cli", args: expect.arrayContaining(["-m", "/models/ggml-small.bin", "-oj", "-np", "-l", "zh"]) });
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
});

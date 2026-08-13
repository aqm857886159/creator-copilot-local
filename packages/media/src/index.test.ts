import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { downloadRemoteFile, mimeTypeForPath, parseFfprobeJson, mediaSourceName } from "./index";

describe("media facts", () => {
  it("normalizes ffprobe streams without losing rotation or rates", () => {
    const probe = parseFfprobeJson({
      streams: [
        { index: 0, codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30000/1001", tags: { rotate: "90" } },
        { index: 1, codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
      ],
      format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.345", size: "987654", bit_rate: "640000" },
    });
    expect(probe.durationMs).toBe(12345);
    expect(probe.streams[0]).toMatchObject({ kind: "video", frameRate: 30000 / 1001, rotation: 90 });
    expect(probe.streams[1]).toMatchObject({ kind: "audio", sampleRate: 48000, channels: 2 });
  });

  it("routes only supported video extensions in the V2a baseline", () => {
    expect(mimeTypeForPath("take.MP4")).toBe("video/mp4");
    expect(mimeTypeForPath("take.mov")).toBe("video/quicktime");
    expect(mimeTypeForPath("take.txt")).toBe("application/octet-stream");
    expect(mediaSourceName("/tmp/a/take.MP4")).toBe("take.MP4");
  });

  it("downloads bounded HTTPS media atomically and removes partial files", async () => {
    const root = await mkdtemp(join(tmpdir(), "creator-copilot-media-test-"));
    const destination = join(root, "video.mp4");
    try {
      await expect(downloadRemoteFile({ url: "https://cdn.example/video.mp4", destinationPath: destination, fetcher: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }) })).resolves.toMatchObject({ byteSize: 3, contentType: "video/mp4" });
      await expect(readFile(destination)).resolves.toEqual(Buffer.from([1, 2, 3]));
      const tooLarge = join(root, "too-large.mp4");
      await expect(downloadRemoteFile({ url: "https://cdn.example/video.mp4", destinationPath: tooLarge, maxBytes: 2, fetcher: async () => new Response(new Uint8Array([1, 2, 3])) })).rejects.toThrow("大小上限");
      await expect(readFile(tooLarge)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(downloadRemoteFile({ url: "http://cdn.example/video.mp4", destinationPath: join(root, "unsafe.mp4"), fetcher: async () => new Response(new Uint8Array([1])) })).rejects.toThrow("HTTPS");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

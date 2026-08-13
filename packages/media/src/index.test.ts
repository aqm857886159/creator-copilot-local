import { describe, expect, it } from "vitest";
import { mimeTypeForPath, parseFfprobeJson, mediaSourceName } from "./index";

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
});

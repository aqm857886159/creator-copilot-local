import { describe, expect, it } from "vitest";
import { DEFAULT_VERTICAL_PROFILE, EditProposalSchema, compileFrozenEditSpec, freezeEditProposal, renderSrt } from "./index";

const now = "2026-08-14T00:00:00.000Z";
const proposal = EditProposalSchema.parse({
  schemaVersion: 1,
  id: "proposal-1",
  projectId: "project-1",
  basedOn: { scriptRevision: 1, storyboardRevision: 1 },
  durationMs: 3500,
  operations: [
    { id: "clip-a", sourceAssetId: "asset-a", sourceSegment: { startMs: 0, endMs: 2000 }, timeline: { startMs: 0, endMs: 2000 }, role: "a_roll", reason: "连续口播作为主线", evidenceIds: ["evidence-1"], confidence: 0.98, status: "accepted" },
    { id: "clip-b", sourceAssetId: "asset-b", sourceSegment: { startMs: 0, endMs: 1500 }, timeline: { startMs: 2000, endMs: 3500 }, role: "b_roll", reason: "补充桌面证据", evidenceIds: ["evidence-2"], confidence: 0.91, status: "accepted" },
  ],
  subtitles: [
    { id: "subtitle-1", timeline: { startMs: 0, endMs: 2000 }, text: "先把观点讲清楚。" },
    { id: "subtitle-2", timeline: { startMs: 2000, endMs: 3500 }, text: "再让画面提供证据。" },
  ],
  outputProfile: DEFAULT_VERTICAL_PROFILE,
  rationale: [{ operationId: "clip-b", reason: "对应分镜中的证明镜头", confidence: 0.91 }],
  status: "adopted",
  createdAt: now,
  updatedAt: now,
});

describe("AI edit proposal and deterministic render contracts", () => {
  it("freezes and compiles a 9:16 A-roll plus B-roll proposal", () => {
    const spec = freezeEditProposal({ proposal, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] });
    const first = compileFrozenEditSpec({ spec, assets: {
      "asset-a": { assetId: "asset-a", relativePath: "originals/a.mp4", absolutePath: "/tmp/a.mp4", contentHash: "sha256:a", durationMs: 2000, hasAudio: true },
      "asset-b": { assetId: "asset-b", relativePath: "originals/b.mp4", absolutePath: "/tmp/b.mp4", contentHash: "sha256:b", durationMs: 1500, hasAudio: true },
    } });
    const second = compileFrozenEditSpec({ spec, assets: {
      "asset-a": { assetId: "asset-a", relativePath: "originals/a.mp4", absolutePath: "/tmp/a.mp4", contentHash: "sha256:a", durationMs: 2000, hasAudio: true },
      "asset-b": { assetId: "asset-b", relativePath: "originals/b.mp4", absolutePath: "/tmp/b.mp4", contentHash: "sha256:b", durationMs: 1500, hasAudio: true },
    } });
    expect(first).toEqual(second);
    expect(first.deterministic).toBe(true);
    expect(first.outputProfile).toMatchObject({ width: 1080, height: 1920, subtitle: "srt" });
    expect(renderSrt(first)).toContain("00:00:02,000 --> 00:00:03,500");
  });

  it("rejects changed source content and overlapping proposal operations", () => {
    const spec = freezeEditProposal({ proposal, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] });
    expect(() => compileFrozenEditSpec({ spec, assets: { "asset-a": { assetId: "asset-a", relativePath: "a.mp4", absolutePath: "/tmp/a.mp4", contentHash: "sha256:changed", durationMs: 2000 }, "asset-b": { assetId: "asset-b", relativePath: "b.mp4", absolutePath: "/tmp/b.mp4", contentHash: "sha256:b", durationMs: 1500 } } })).toThrow("素材 hash 已变化");
    const overlapping = EditProposalSchema.parse({ ...proposal, operations: [{ ...proposal.operations[0], timeline: { startMs: 0, endMs: 2200 } }, { ...proposal.operations[1], timeline: { startMs: 2000, endMs: 3500 } }] });
    expect(() => freezeEditProposal({ proposal: overlapping, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] })).toThrow("重叠");
    const gapped = EditProposalSchema.parse({ ...proposal, operations: [{ ...proposal.operations[0], timeline: { startMs: 0, endMs: 1800 } }, { ...proposal.operations[1], timeline: { startMs: 2000, endMs: 3500 } }] });
    expect(() => freezeEditProposal({ proposal: gapped, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] })).toThrow("时间缺口");
  });
});

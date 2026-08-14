import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { stableStringify } from "../../contracts/src/index";
import { DEFAULT_VERTICAL_PROFILE, EditProposalSchema, FrozenEditSpecSchema, compileFrozenEditSpec, exportFcpXml, exportOtio, freezeEditProposal, proposeEditFromCapture, renderSrt } from "./index";

const now = "2026-08-14T00:00:00.000Z";
function rehashSpec<T extends { authoredSpecHash: string }>(spec: T): T {
  const { authoredSpecHash: _previous, ...authored } = spec;
  return { ...spec, authoredSpecHash: `sha256:${createHash("sha256").update(stableStringify(authored)).digest("hex")}` };
}
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

const layeredProposal = EditProposalSchema.parse({
  ...proposal,
  id: "proposal-layered-1",
  durationMs: 4_000,
  operations: [
    { id: "layered-primary", sourceAssetId: "asset-a", sourceSegment: { startMs: 0, endMs: 4_000 }, timeline: { startMs: 0, endMs: 4_000 }, role: "a_roll", placement: "primary", reason: "连续口播主干", evidenceIds: ["shot-primary"], confidence: 0.98, status: "accepted" },
    { id: "layered-overlay", sourceAssetId: "asset-b", sourceSegment: { startMs: 0, endMs: 1_000 }, timeline: { startMs: 1_500, endMs: 2_500 }, role: "b_roll", placement: "overlay", reason: "覆盖一段具体证据画面", evidenceIds: ["shot-overlay"], confidence: 0.91, status: "accepted", volume: 0 },
  ],
  subtitles: [{ id: "layered-subtitle", timeline: { startMs: 0, endMs: 4_000 }, text: "主干表达持续，证据画面在中间覆盖。" }],
  rationale: [{ operationId: "layered-overlay", reason: "对应分镜中的证明镜头", confidence: 0.91 }],
});

describe("AI edit proposal and deterministic render contracts", () => {
  it("creates an auditable local proposal and reports missing Takes", () => {
    const script = {
      schemaVersion: 1 as const,
      id: "script-1",
      projectId: "project-1",
      revision: 1,
      status: "approved" as const,
      blocks: [{ schemaVersion: 1 as const, id: "block-1", order: 0, kind: "hook" as const, text: "先把观点讲清楚。", emphasis: [], evidenceIds: [], visualNeed: "must_show" as const }],
      estimatedDurationMs: 2_000,
      createdAt: now,
      updatedAt: now,
    };
    const storyboard = {
      schemaVersion: 1 as const,
      id: "storyboard-1",
      projectId: "project-1",
      scriptId: "script-1",
      scriptRevision: 1,
      revision: 1,
      status: "approved" as const,
      shots: [{ schemaVersion: 1 as const, id: "shot-1", storyboardId: "storyboard-1", order: 0, scriptBlockIds: ["block-1"], purpose: "explain" as const, mode: "talking_head" as const, actionDescription: "正面讲出开头。", targetMs: 2_000, sourceRequirement: "shoot_task" as const, status: "covered" as const }],
      createdAt: now,
      updatedAt: now,
    };
    const task = { schemaVersion: 1 as const, id: "task-1", projectId: "project-1", shotId: "shot-1", title: "镜头 01", instruction: "正面讲出开头。", targetMs: 2_000, deviceHint: "phone" as const, orientation: "portrait" as const, checklist: ["稳定"], status: "accepted" as const, takeIds: ["take-1"], createdAt: now, updatedAt: now };
    const take = { schemaVersion: 1 as const, id: "take-1", shootTaskId: "task-1", assetId: "asset-1", relativePath: "originals/asset-1.mp4", durationMs: 2_000, status: "selected" as const, createdAt: now, updatedAt: now };
    const result = proposeEditFromCapture({ projectId: "project-1", script, storyboard, tasks: [task], takesByTask: { "task-1": [take] }, assetFacts: { "asset-1": { contentHash: "sha256:asset-1", durationMs: 2_000 } }, now });
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.proposal.operations[0]).toMatchObject({ sourceAssetId: "asset-1", role: "a_roll", status: "suggested" });
    const missing = proposeEditFromCapture({ projectId: "project-1", script, storyboard, tasks: [task], takesByTask: { "task-1": [{ ...take, status: "candidate" }] }, assetFacts: { "asset-1": { contentHash: "sha256:asset-1", durationMs: 2_000 } }, now });
    expect(missing).toMatchObject({ status: "needs_material", missing: [{ reason: "take_not_selected" }] });
  });

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

  it("freezes layered proposals into a contiguous primary track and a bounded overlay track", () => {
    const spec = freezeEditProposal({ proposal: layeredProposal, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] });
    expect(spec.tracks.map((track) => [track.kind, track.layer])).toEqual([["video", "primary"], ["video", "overlay"], ["subtitle", undefined]]);
    const ir = compileFrozenEditSpec({ spec, assets: {
      "asset-a": { assetId: "asset-a", relativePath: "originals/a.mp4", absolutePath: "/tmp/a.mp4", contentHash: "sha256:a", durationMs: 4000, hasAudio: true },
      "asset-b": { assetId: "asset-b", relativePath: "originals/b.mp4", absolutePath: "/tmp/b.mp4", contentHash: "sha256:b", durationMs: 1000, hasAudio: true },
    } });
    expect(ir.tracks.filter((track) => track.kind === "video").map((track) => ({ layer: track.layer, count: track.clips.length }))).toEqual([{ layer: "primary", count: 1 }, { layer: "overlay", count: 1 }]);
    expect(ir.tracks.find((track) => track.layer === "overlay")?.clips[0]).toMatchObject({ timeline: { startMs: 1500, endMs: 2500 }, placement: "overlay" });
    const reorderedIr = { ...ir, tracks: [ir.tracks.find((track) => track.layer === "overlay")!, ir.tracks.find((track) => track.layer === "primary")!, ...ir.tracks.filter((track) => track.kind === "subtitle")] };
    const fcpxml = exportFcpXml({ ir: reorderedIr, workspaceRoot: "/workspace" });
    const spine = fcpxml.body.match(/<spine>([\s\S]*?)<\/spine>/)?.[1] ?? "";
    expect(spine).toContain("layered-primary");
    expect(spine).not.toContain("layered-overlay");
    const otio = JSON.parse(exportOtio({ ir: reorderedIr, workspaceRoot: "/workspace" }).body) as { tracks: { children: Array<{ name: string; children: Array<{ OTIO_SCHEMA: string; source_range: { duration: { value: number } } }> }> } };
    const overlayOtio = otio.tracks.children.find((track) => track.name.includes("overlay"));
    expect(overlayOtio?.children.map((child) => [child.OTIO_SCHEMA, child.source_range.duration.value])).toEqual([["Gap.1", 45], ["Clip.2", 30], ["Gap.1", 45]]);
    const rejectedPrimary = EditProposalSchema.parse({ ...layeredProposal, operations: layeredProposal.operations.map((operation) => operation.id === "layered-primary" ? { ...operation, status: "rejected" as const } : operation) });
    expect(() => freezeEditProposal({ proposal: rejectedPrimary, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] })).toThrow("口播主干");
    const overlappingOverlay = EditProposalSchema.parse({ ...layeredProposal, operations: [...layeredProposal.operations, { id: "layered-overlay-overlap", sourceAssetId: "asset-b", sourceSegment: { startMs: 0, endMs: 500 }, timeline: { startMs: 2000, endMs: 2500 }, role: "b_roll" as const, placement: "overlay" as const, reason: "重叠覆盖", evidenceIds: ["shot-overlay-2"], confidence: 0.5, status: "accepted" as const }] });
    expect(() => freezeEditProposal({ proposal: overlappingOverlay, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] })).toThrow("画面覆盖");
  });

  it("rejects changed source content and overlapping proposal operations", () => {
    const spec = freezeEditProposal({ proposal, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] });
    expect(() => compileFrozenEditSpec({ spec, assets: { "asset-a": { assetId: "asset-a", relativePath: "a.mp4", absolutePath: "/tmp/a.mp4", contentHash: "sha256:changed", durationMs: 2000 }, "asset-b": { assetId: "asset-b", relativePath: "b.mp4", absolutePath: "/tmp/b.mp4", contentHash: "sha256:b", durationMs: 1500 } } })).toThrow("素材 hash 已变化");
    const overlapping = EditProposalSchema.parse({ ...proposal, operations: [{ ...proposal.operations[0], sourceSegment: { startMs: 0, endMs: 2200 }, timeline: { startMs: 0, endMs: 2200 } }, { ...proposal.operations[1], timeline: { startMs: 2000, endMs: 3500 } }] });
    expect(() => freezeEditProposal({ proposal: overlapping, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] })).toThrow("重叠");
    const gapped = EditProposalSchema.parse({ ...proposal, operations: [{ ...proposal.operations[0], sourceSegment: { startMs: 0, endMs: 1800 }, timeline: { startMs: 0, endMs: 1800 } }, { ...proposal.operations[1], timeline: { startMs: 2000, endMs: 3500 } }] });
    expect(() => freezeEditProposal({ proposal: gapped, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] })).toThrow("时间缺口");
    const implicitSpeedChange = EditProposalSchema.parse({ ...layeredProposal, operations: layeredProposal.operations.map((operation) => operation.id === "layered-primary" ? { ...operation, sourceSegment: { startMs: 0, endMs: 1000 } } : operation) });
    expect(() => freezeEditProposal({ proposal: implicitSpeedChange, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] })).toThrow("不支持隐式变速");
    const validLayeredSpec = freezeEditProposal({ proposal: layeredProposal, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] });
    const invalidFrozenSpec = rehashSpec({ ...validLayeredSpec, tracks: validLayeredSpec.tracks.map((track) => track.layer === "overlay" ? { ...track, clips: track.clips.map((clip) => "sourceAssetId" in clip ? { ...clip, sourceSegment: { startMs: 0, endMs: 250 } } : clip) } : track) });
    expect(() => compileFrozenEditSpec({ spec: invalidFrozenSpec, assets: { "asset-a": { assetId: "asset-a", relativePath: "a.mp4", absolutePath: "/tmp/a.mp4", contentHash: "sha256:a", durationMs: 4000 }, "asset-b": { assetId: "asset-b", relativePath: "b.mp4", absolutePath: "/tmp/b.mp4", contentHash: "sha256:b", durationMs: 1000 } } })).toThrow("不支持隐式变速");
    expect(() => compileFrozenEditSpec({ spec: { ...validLayeredSpec, projectId: "tampered-project" }, assets: {} })).toThrow("authoredSpecHash");
    const transformed = EditProposalSchema.parse({ ...layeredProposal, operations: layeredProposal.operations.map((operation) => operation.id === "layered-overlay" ? { ...operation, transform: { scale: 1.2, x: 10 } } : operation) });
    expect(() => freezeEditProposal({ proposal: transformed, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] })).toThrow("尚未实现的画面变换");
    const primaryTrack = validLayeredSpec.tracks.find((track) => track.layer === "primary")!;
    const overlayTrack = validLayeredSpec.tracks.find((track) => track.layer === "overlay")!;
    const subtitleTrack = validLayeredSpec.tracks.find((track) => track.kind === "subtitle")!;
    expect(FrozenEditSpecSchema.safeParse({ ...validLayeredSpec, tracks: [{ ...primaryTrack, clips: overlayTrack.clips }, overlayTrack, subtitleTrack] }).success).toBe(false);
    expect(FrozenEditSpecSchema.safeParse({ ...validLayeredSpec, tracks: [primaryTrack, { ...primaryTrack, id: "second-primary" }, overlayTrack, subtitleTrack] }).success).toBe(false);
    expect(FrozenEditSpecSchema.safeParse({ ...validLayeredSpec, tracks: [{ ...primaryTrack, kind: "audio", layer: undefined }, overlayTrack, subtitleTrack] }).success).toBe(false);
    expect(FrozenEditSpecSchema.safeParse({ ...validLayeredSpec, tracks: [{ ...primaryTrack, clips: subtitleTrack.clips }, overlayTrack, subtitleTrack] }).success).toBe(false);
  });

  it("exports the same RenderIR to standard exchange formats with loss reports", () => {
    const frozen = freezeEditProposal({ proposal, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }], now });
    const ir = compileFrozenEditSpec({ spec: frozen, assets: {
      "asset-a": { assetId: "asset-a", relativePath: "originals/a.mp4", absolutePath: "/workspace/originals/a.mp4", contentHash: "sha256:a", durationMs: 2000, hasAudio: true },
      "asset-b": { assetId: "asset-b", relativePath: "originals/b.mp4", absolutePath: "/workspace/originals/b.mp4", contentHash: "sha256:b", durationMs: 1500, hasAudio: true },
    } });
    const fcpxml = exportFcpXml({ ir, workspaceRoot: "/workspace" });
    expect(fcpxml.body).toContain("<fcpxml version=\"1.11\">");
    expect(fcpxml.body).toContain("asset-a");
    expect(fcpxml.report).toMatchObject({ adapter: "fcpxml", supported: expect.arrayContaining(["video"]), losses: [{ kind: "subtitle", severity: "warning" }] });
    const reusedAssetIr = { ...ir, tracks: ir.tracks.map((track) => track.kind === "video" ? { ...track, clips: (track.clips as Array<(typeof ir.tracks)[number]["clips"][number]>).map((clip, index) => "sourceAssetId" in clip && index === 1 ? { ...clip, sourceAssetId: "asset-a", sourceRelativePath: "originals/a.mp4", sourceContentHash: "sha256:a", sourceSegment: { startMs: 5_000, endMs: 6_500 } } : clip) } : track) };
    const reusedFcpXml = exportFcpXml({ ir: reusedAssetIr, workspaceRoot: "/workspace" });
    expect(reusedFcpXml.body).toMatch(/<asset[^>]+name="asset-a"[^>]+duration="6\.5s"/);
    const otio = exportOtio({ ir, workspaceRoot: "/workspace" });
    expect(JSON.parse(otio.body)).toMatchObject({ OTIO_SCHEMA: "Timeline.1", tracks: { children: expect.arrayContaining([expect.objectContaining({ kind: "Video" })]) } });
    expect(otio.report.adapter).toBe("otio");
  });
});

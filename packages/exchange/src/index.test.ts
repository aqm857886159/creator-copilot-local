import { describe, expect, it } from "vitest";
import { DEFAULT_VERTICAL_PROFILE, EditProposalSchema, compileFrozenEditSpec, freezeEditProposal, proposeEditFromCapture, renderSrt } from "./index";

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

  it("rejects changed source content and overlapping proposal operations", () => {
    const spec = freezeEditProposal({ proposal, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] });
    expect(() => compileFrozenEditSpec({ spec, assets: { "asset-a": { assetId: "asset-a", relativePath: "a.mp4", absolutePath: "/tmp/a.mp4", contentHash: "sha256:changed", durationMs: 2000 }, "asset-b": { assetId: "asset-b", relativePath: "b.mp4", absolutePath: "/tmp/b.mp4", contentHash: "sha256:b", durationMs: 1500 } } })).toThrow("素材 hash 已变化");
    const overlapping = EditProposalSchema.parse({ ...proposal, operations: [{ ...proposal.operations[0], timeline: { startMs: 0, endMs: 2200 } }, { ...proposal.operations[1], timeline: { startMs: 2000, endMs: 3500 } }] });
    expect(() => freezeEditProposal({ proposal: overlapping, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] })).toThrow("重叠");
    const gapped = EditProposalSchema.parse({ ...proposal, operations: [{ ...proposal.operations[0], timeline: { startMs: 0, endMs: 1800 } }, { ...proposal.operations[1], timeline: { startMs: 2000, endMs: 3500 } }] });
    expect(() => freezeEditProposal({ proposal: gapped, assetLocks: [{ assetId: "asset-a", contentHash: "sha256:a" }, { assetId: "asset-b", contentHash: "sha256:b" }] })).toThrow("时间缺口");
  });
});

import { describe, expect, it } from "vitest";
import {
  candidateChipText,
  candidateFileName,
  canRender,
  distinctAssetCount,
  assetDisplayName,
  evidenceLine,
  evidenceLineText,
  gateCounts,
  gateSentence,
  headSummary,
  isKept,
  placementRoleLabel,
  secondsLabel,
  timecode,
  timelineRange,
  toGapView,
  toRowView,
  type EditOperationLike,
  type EvidenceFactLike,
} from "./edit-page";

function op(overrides: Partial<EditOperationLike> = {}): EditOperationLike {
  return {
    id: "proposal-op-shot-01",
    shotId: "shot-01",
    sourceAssetId: "take-02",
    sourceSegment: { startMs: 0, endMs: 6000 },
    timeline: { startMs: 0, endMs: 6000 },
    role: "a_roll",
    placement: "primary",
    reason: "三条里这条语气最稳，结尾停顿干净，适合直接开场。",
    evidenceIds: ["fact-1", "shot-01"],
    confidence: 0.92,
    status: "suggested",
    ...overrides,
  };
}

describe("时间码与时长格式", () => {
  it("timecode 四舍五入到秒并补零", () => {
    expect(timecode(0)).toBe("00:00");
    expect(timecode(6000)).toBe("00:06");
    expect(timecode(75_000)).toBe("01:15");
    expect(timecode(-500)).toBe("00:00");
  });
  it("timelineRange 用 en dash 连接", () => {
    expect(timelineRange({ startMs: 0, endMs: 6000 })).toBe("00:00–00:06");
  });
  it("secondsLabel 给整秒", () => {
    expect(secondsLabel(38_400)).toBe("38s");
    expect(secondsLabel(0)).toBe("0s");
  });
});

describe("placement/role 中文短标", () => {
  it("primary 或 a_roll 恒为口播主干", () => {
    expect(placementRoleLabel("primary", "a_roll")).toBe("口播主干");
    expect(placementRoleLabel(undefined, "a_roll")).toBe("口播主干");
  });
  it("overlay 按 role 细分", () => {
    expect(placementRoleLabel("overlay", "b_roll")).toBe("补充画面");
    expect(placementRoleLabel("overlay", "screen")).toBe("录屏画面");
    expect(placementRoleLabel("overlay", "generated")).toBe("生成画面");
    expect(placementRoleLabel("overlay", "still")).toBe("静帧");
  });
});

describe("证据引用行", () => {
  const evidenceById = new Map<string, EvidenceFactLike>([
    ["fact-1", { id: "fact-1", startMs: 0, endMs: 3000, text: "为什么很多人越努力表达，反而越没有记忆点？" }],
  ]);
  it("命中 fact 时取其文本与起点时间码", () => {
    const line = evidenceLine(op(), evidenceById);
    expect(line.assetId).toBe("take-02");
    expect(line.timecode).toBe("00:00");
    expect(line.text).toBe("为什么很多人越努力表达，反而越没有记忆点？");
    expect(evidenceLineText(line)).toBe("▸ take-02 00:00『为什么很多人越努力表达，反而越没有记忆点？』");
  });
  it("查不到 fact 时退化为素材号+片段起点,不伪造文本", () => {
    const line = evidenceLine(op({ evidenceIds: ["shot-01"], sourceSegment: { startMs: 4000, endMs: 9000 } }), new Map());
    expect(line.text).toBeNull();
    expect(line.timecode).toBe("00:04");
    expect(evidenceLineText(line)).toBe("▸ take-02 00:04");
  });
});

describe("镜头行视图", () => {
  const evidenceById = new Map<string, EvidenceFactLike>([
    ["fact-1", { id: "fact-1", startMs: 0, endMs: 3000, text: "开场问题" }],
  ]);
  it("采用态:序号补零、短标、理由原文、非弃用、非待确认", () => {
    const view = toRowView(op(), 0, evidenceById);
    expect(view.index).toBe("01");
    expect(view.placementLabel).toBe("口播主干");
    expect(view.reason).toBe("三条里这条语气最稳，结尾停顿干净，适合直接开场。");
    expect(view.dropped).toBe(false);
    expect(view.needsConfirm).toBe(false);
  });
  it("rejected → 弃用态", () => {
    expect(toRowView(op({ status: "rejected" }), 3, evidenceById).dropped).toBe(true);
  });
  it("confidence < 0.8 → 待确认", () => {
    expect(toRowView(op({ confidence: 0.6 }), 1, evidenceById).needsConfirm).toBe(true);
  });
  it("isKept:非 rejected 即采用", () => {
    expect(isKept(op({ status: "suggested" }))).toBe(true);
    expect(isKept(op({ status: "accepted" }))).toBe(true);
    expect(isKept(op({ status: "rejected" }))).toBe(false);
  });
});

describe("头行汇总与素材去重", () => {
  it("含素材数时三段拼接", () => {
    expect(headSummary([op(), op({ id: "b" })], 38_000, 12)).toBe("2 个镜头 · 共 38s · 12 条素材");
  });
  it("素材数为 0 或缺省时省略末段", () => {
    expect(headSummary([op()], 6000)).toBe("1 个镜头 · 共 6s");
    expect(headSummary([op()], 6000, 0)).toBe("1 个镜头 · 共 6s");
  });
  it("台词时长已知时对账显示「粗剪/台词约」,未知退化为「共」", () => {
    expect(headSummary([op()], 7000, 1, 19_000)).toBe("1 个镜头 · 粗剪 7s / 台词约 19s · 1 条素材");
    expect(headSummary([op()], 7000, 1)).toBe("1 个镜头 · 共 7s · 1 条素材");
  });
  it("素材显示名:有文件名用文件名,长 ID 截短不裸奔", () => {
    expect(assetDisplayName("source-fc31c5246216c3dc4910cae0", new Map([["source-fc31c5246216c3dc4910cae0", "客厅第二条.mp4"]]))).toBe("客厅第二条.mp4");
    expect(assetDisplayName("source-fc31c5246216c3dc4910cae0")).toBe("素材 source-f…");
    expect(assetDisplayName("take-02")).toBe("take-02");
  });
  it("distinctAssetCount 按 sourceAssetId 去重", () => {
    expect(distinctAssetCount([op({ sourceAssetId: "a" }), op({ sourceAssetId: "a" }), op({ sourceAssetId: "b" })])).toBe(2);
  });
});

describe("闸门汇总句(诚实对账)", () => {
  it("有弃用与缺口时如实说明", () => {
    const counts = gateCounts([op(), op({ id: "b" }), op({ id: "c", status: "rejected" })], 1);
    expect(counts).toEqual({ kept: 2, dropped: 1, gaps: 1 });
    expect(gateSentence(counts)).toBe("2 个镜头采用、1 个不用，缺口先用口播带过 —— 出片不改你的素材，随时能重出一版。");
  });
  it("全部采用且无缺口时不编造不用/缺口", () => {
    const counts = gateCounts([op(), op({ id: "b" })], 0);
    expect(counts).toEqual({ kept: 2, dropped: 0, gaps: 0 });
    expect(gateSentence(counts)).toBe("2 个镜头全部采用 —— 出片不改你的素材，随时能重出一版。");
  });
  it("canRender:至少一个采用才可出片", () => {
    expect(canRender([op({ status: "rejected" }), op({ id: "b", status: "suggested" })])).toBe(true);
    expect(canRender([op({ status: "rejected" })])).toBe(false);
    expect(canRender([])).toBe(false);
  });
});

describe("缺口与候选映射", () => {
  it("required 缺省视为阻塞缺口", () => {
    expect(toGapView({ shotId: "shot-03", reason: "no_suitable_asset", instruction: "拍草稿" }).required).toBe(true);
    expect(toGapView({ shotId: "shot-03", taskId: "task-3", required: false, reason: "no_suitable_asset", instruction: "补充" })).toEqual({ key: "shot-03-task-3", instruction: "补充", required: false });
  });
  it("候选文件名取路径末段", () => {
    expect(candidateFileName("assets/source/桌面俯拍-0812.mp4")).toBe("桌面俯拍-0812.mp4");
    expect(candidateFileName("裸文件.mov")).toBe("裸文件.mov");
  });
  it("候选 chip 文本含时间码", () => {
    expect(candidateChipText({ assetId: "a", relativePath: "assets/桌面俯拍-0812.mp4", sourceSegment: { startMs: 32_000, endMs: 35_000 }, reason: "接近" })).toBe("▸ 桌面俯拍-0812.mp4 00:32");
    expect(candidateChipText({ assetId: "a", relativePath: "assets/x.mp4", reason: "接近" })).toBe("▸ x.mp4");
  });
});

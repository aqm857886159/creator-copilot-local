import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScriptSchema, attachTake, createShootTasks, createStoryboard, exportCapturePackage, selectTake, type Take } from "./index";

const now = "2026-08-14T00:00:00.000Z";
const script = ScriptSchema.parse({
  schemaVersion: 1,
  id: "script-1",
  projectId: "project-1",
  revision: 1,
  status: "approved",
  blocks: [
    { schemaVersion: 1, id: "block-1", order: 0, kind: "hook", text: "为什么很多人越努力越没记忆点？", emphasis: [], evidenceIds: [], visualNeed: "must_show" },
    { schemaVersion: 1, id: "block-2", order: 1, kind: "claim", text: "因为表达没有画面变化。", emphasis: [], evidenceIds: [], visualNeed: "support" },
  ],
  estimatedDurationMs: 12_000,
  createdAt: now,
  updatedAt: now,
});

describe("creation workflow contracts", () => {
  it("builds shots, executable shoot tasks, and an offline capture package", async () => {
    const storyboard = createStoryboard({ id: "storyboard-1", script, createdAt: now, shots: [
      { id: "shot-1", order: 0, scriptBlockIds: ["block-1"], purpose: "emotion", mode: "talking_head", framing: "medium", cameraDirection: "正面固定，中途停顿半秒", actionDescription: "看镜头，先说出问题，再停顿。", targetMs: 4_000, sourceRequirement: "shoot_task" },
      { id: "shot-2", order: 1, scriptBlockIds: ["block-2"], purpose: "explain", mode: "broll", actionDescription: "拍一张桌面上写满修改痕迹的纸。", targetMs: 3_000, sourceRequirement: "shoot_task" },
    ] });
    const tasks = createShootTasks(storyboard, now);
    expect(tasks).toHaveLength(2);
    const root = mkdtempSync(join(tmpdir(), "creator-copilot-capture-"));
    const capturePackage = await exportCapturePackage({ workspaceRoot: root, projectTitle: "表达结构", capturePackage: { schemaVersion: 1, id: "capture-1", projectId: "project-1", storyboardRevision: 1, format: "html", relativePath: "capture-packages/capture-1/index.html", taskIds: tasks.map((task) => task.id), status: "draft", createdAt: now, updatedAt: now }, storyboard, tasks });
    expect(capturePackage.status).toBe("ready");
    const html = readFileSync(join(root, capturePackage.relativePath), "utf8");
    expect(html).toContain("看镜头，先说出问题");
    expect(html).toContain("按目标时长多拍 2 秒余量");
    expect(html).toContain("lang=\"zh-CN\"");
    rmSync(root, { recursive: true, force: true });
  });

  it("preserves multiple takes and changes only the selected take", () => {
    const storyboard = createStoryboard({ id: "storyboard-2", script, createdAt: now, shots: [{ id: "shot-1", order: 0, scriptBlockIds: ["block-1"], purpose: "emotion", mode: "talking_head", actionDescription: "说出问题。", targetMs: 4_000, sourceRequirement: "shoot_task" }] });
    const task = createShootTasks(storyboard, now)[0];
    const baseTake = (id: string, status: Take["status"]): Take => ({ schemaVersion: 1, id, shootTaskId: task.id, assetId: `asset-${id}`, relativePath: `originals/${id}.mp4`, status, createdAt: now, updatedAt: now });
    const taskWithTakes = attachTake(attachTake(task, baseTake("take-1", "candidate")), baseTake("take-2", "candidate"));
    const result = selectTake(taskWithTakes, [baseTake("take-1", "candidate"), baseTake("take-2", "candidate")], "take-2");
    expect(result.task.status).toBe("accepted");
    expect(result.takes.find((take) => take.id === "take-2")?.status).toBe("selected");
    expect(result.takes.find((take) => take.id === "take-1")?.status).toBe("candidate");
    expect(() => selectTake(taskWithTakes, [baseTake("take-1", "candidate")], "take-2")).toThrow("找不到");
  });

  it("rejects a shot that references an unknown script block", () => {
    expect(() => createStoryboard({ id: "storyboard-invalid", script, createdAt: now, shots: [{ id: "shot-1", order: 0, scriptBlockIds: ["missing"], purpose: "explain", mode: "talking_head", actionDescription: "无效", targetMs: 1_000, sourceRequirement: "shoot_task" }] })).toThrow("不存在");
  });
});

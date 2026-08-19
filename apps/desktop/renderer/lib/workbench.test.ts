import { describe, expect, it } from "vitest";
import { deriveNextAction, workflowFromLoadedProject } from "./workbench";

describe("deriveNextAction", () => {
  it("script 阶段:第一段亮起,继续写脚本,不亮红点", () => {
    const action = deriveNextAction({ stage: "script", title: "先讲结论还是先讲故事？" });
    expect(action.stageLabel).toBe("脚本中");
    expect(action.actionLabel).toBe("继续写脚本");
    expect(action.target).toBe("script");
    expect(action.pulsing).toBe(false);
    expect(action.stages.map((cell) => cell.state)).toEqual(["now", "todo", "todo", "todo", "todo"]);
  });

  it("capture 阶段:前一段完成、当前点亮,看拍摄进度", () => {
    const action = deriveNextAction({ stage: "capture", title: "素材库不是仓库" });
    expect(action.stageLabel).toBe("拍摄中");
    expect(action.actionLabel).toBe("看拍摄进度");
    expect(action.target).toBe("capture");
    expect(action.stages.map((cell) => cell.state)).toEqual(["done", "now", "todo", "todo", "todo"]);
  });

  it("editing 阶段:继续剪辑,文案不承诺未回载的粗剪,红点留给等你定", () => {
    const action = deriveNextAction({ stage: "editing", title: "越努力越没记忆点？" });
    expect(action.stageLabel).toBe("剪辑中");
    expect(action.actionLabel).toBe("继续剪辑");
    expect(action.target).toBe("editing");
    expect(action.nextLine).toBe("素材已导入，进去让 AI 出一版粗剪");
    expect(action.pulsing).toBe(false);
    expect(action.stages.map((cell) => cell.state)).toEqual(["done", "done", "now", "todo", "todo"]);
  });

  it("rendered 阶段:去发布", () => {
    const action = deriveNextAction({ stage: "rendered", title: "一条已经出片的项目" });
    expect(action.stageLabel).toBe("已出片");
    expect(action.actionLabel).toBe("去发布");
    expect(action.target).toBe("rendered");
    expect(action.stages.map((cell) => cell.state)).toEqual(["done", "done", "done", "now", "todo"]);
  });

  it("published 阶段:五段全亮到末段,看数据", () => {
    const action = deriveNextAction({ stage: "published", title: "已经发出去的项目" });
    expect(action.stageLabel).toBe("已发布");
    expect(action.actionLabel).toBe("看数据");
    expect(action.target).toBe("published");
    expect(action.stages.map((cell) => cell.state)).toEqual(["done", "done", "done", "done", "now"]);
  });

  it("未知 stage:兜底为整理中,不亮红点,不崩", () => {
    const action = deriveNextAction({ stage: "archived_unknown", title: "阶段枚举之外" });
    expect(action.stageLabel).toBe("整理中");
    expect(action.actionLabel).toBe("打开看看");
    expect(action.target).toBe("script");
    expect(action.pulsing).toBe(false);
    expect(action.stages.map((cell) => cell.state)).toEqual(["todo", "todo", "todo", "todo", "todo"]);
  });
});

// ---- workflowFromLoadedProject fixtures ----

const baseProject = {
  id: "project-fixture-1",
  workspaceId: "workspace-1",
  title: "恢复用例项目",
  stage: "editing",
  revision: 3,
  payload: {},
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T01:00:00.000Z",
};

const baseScript = {
  id: "script-1",
  projectId: "project-fixture-1",
  revision: 2,
  blocks: [{ id: "block-1", order: 0, kind: "hook", text: "开头问题", emphasis: [], evidenceIds: [], visualNeed: "must_show" as const }],
  estimatedDurationMs: 30_000,
};

const baseStoryboard: NonNullable<LoadProjectResult["storyboard"]> = {
  id: "storyboard-1",
  projectId: "project-fixture-1",
  scriptId: "script-1",
  scriptRevision: 2,
  revision: 1,
  status: "ready",
  shots: [
    {
      id: "shot-1",
      order: 0,
      scriptBlockIds: ["block-1"],
      purpose: "explain",
      mode: "talking_head",
      actionDescription: "面对镜头讲出开头",
      targetMs: 4_000,
      sourceRequirement: "shoot_task",
      status: "ready",
    },
  ],
  createdAt: "2026-08-19T00:10:00.000Z",
  updatedAt: "2026-08-19T00:20:00.000Z",
};

const baseTasks: CaptureShootTask[] = [
  {
    id: "task-1",
    shotId: "shot-1",
    title: "拍开头口播",
    instruction: "面对镜头自然讲出开头问题",
    targetMs: 4_000,
    deviceHint: "phone",
    orientation: "portrait",
    checklist: ["光线均匀", "结尾多留两秒"],
    status: "imported",
    takeIds: ["take-1"],
  },
];

const baseCapturePackage = {
  id: "capture-package-1",
  projectId: "project-fixture-1",
  storyboardRevision: 1,
  format: "html" as const,
  relativePath: "capture/package-1.html",
  taskIds: ["task-1"],
  status: "ready",
  createdAt: "2026-08-19T00:30:00.000Z",
  updatedAt: "2026-08-19T00:40:00.000Z",
};

describe("workflowFromLoadedProject", () => {
  it("正常:分镜、拍摄任务、拍摄包齐全 → 完整 workflow", () => {
    const workflow = workflowFromLoadedProject({
      ok: true,
      project: baseProject,
      script: baseScript,
      storyboard: baseStoryboard,
      tasks: baseTasks,
      capturePackage: baseCapturePackage,
      takesByTask: { "task-1": [] },
    });
    expect(workflow.ok).toBe(true);
    // projectId 必须带上:AiEditWorkbench 以它判空,决定进真实态还是空态
    expect(workflow.projectId).toBe("project-fixture-1");
    expect(workflow.script).toBe(baseScript);
    expect(workflow.storyboard).toBe(baseStoryboard);
    expect(workflow.tasks).toEqual(baseTasks);
    expect(workflow.capturePackage).toEqual({ id: "capture-package-1", relativePath: "capture/package-1.html", status: "ready" });
  });

  it("缺 storyboard:仍带 projectId 与 tasks,storyboard/capturePackage 为空", () => {
    const workflow = workflowFromLoadedProject({
      ok: true,
      project: { ...baseProject, stage: "script" },
      script: baseScript,
      tasks: baseTasks,
    });
    expect(workflow.ok).toBe(true);
    expect(workflow.projectId).toBe("project-fixture-1");
    expect(workflow.storyboard).toBeUndefined();
    expect(workflow.capturePackage).toBeUndefined();
    expect(workflow.tasks).toEqual(baseTasks);
  });

  it("缺 tasks:退化为空数组,不返回 undefined", () => {
    const workflow = workflowFromLoadedProject({
      ok: true,
      project: baseProject,
      script: baseScript,
      storyboard: baseStoryboard,
      capturePackage: baseCapturePackage,
    });
    expect(workflow.ok).toBe(true);
    expect(workflow.projectId).toBe("project-fixture-1");
    expect(workflow.tasks).toEqual([]);
  });

  it("加载失败(ok=false 或缺 project):向上传递失败,不伪造 projectId", () => {
    const failed = workflowFromLoadedProject({ ok: false, errorCode: "not_found", message: "找不到项目" });
    expect(failed.ok).toBe(false);
    expect(failed.projectId).toBeUndefined();
    expect(failed.message).toBe("找不到项目");
  });
});

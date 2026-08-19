/*
 * 工作台纯函数 · 切片 1
 * - deriveNextAction:真实 stage 枚举 → 卡片阶段条 + 一句人话下一步 + 行动按钮文案
 * - workflowFromLoadedProject:LoadProjectResult → CaptureWorkflowResult 适配(恢复断点)
 * 两者都是纯函数,无 IPC、无 DOM,便于单测。文案语气取自 docs/design/01-workbench.html。
 */

// 真实项目 stage 枚举(来自 SQLite):script / capture / editing / rendered / published
export type ProjectStage = "script" | "capture" | "editing" | "rendered" | "published";

const STAGE_ORDER: ProjectStage[] = ["script", "capture", "editing", "rendered", "published"];

export interface StageCell {
  // done:已完成的阶段(石板实心);now:当前阶段(记号黄);未点亮为界线灰
  state: "done" | "now" | "todo";
}

export interface NextAction {
  // 阶段短标(如「剪辑中」),配合封面 tag
  stageLabel: string;
  // 五段阶段条,按 STAGE_ORDER
  stages: StageCell[];
  // 一句人话下一步(卡片底部)
  nextLine: string;
  // 是否亮录制红圆点(进行中/等你定)
  pulsing: boolean;
  // 行动按钮文案
  actionLabel: string;
  // 点击行动按钮进入的目标视图语义
  target: "script" | "capture" | "editing" | "rendered" | "published";
}

interface ProjectLike {
  stage: string;
  title: string;
}

// 未知 stage 兜底:当作脚本起点,不亮红点,给中性引导
function unknownStageAction(): NextAction {
  return {
    stageLabel: "整理中",
    stages: STAGE_ORDER.map(() => ({ state: "todo" as const })),
    nextLine: "这条还在整理，点开看看接下来做什么",
    pulsing: false,
    actionLabel: "打开看看",
    target: "script",
  };
}

function stagesUpTo(current: ProjectStage): StageCell[] {
  const currentIndex = STAGE_ORDER.indexOf(current);
  return STAGE_ORDER.map((_, index) => {
    if (index < currentIndex) return { state: "done" as const };
    if (index === currentIndex) return { state: "now" as const };
    return { state: "todo" as const };
  });
}

// 阶段映射(计划 §3):script→脚本中/继续写脚本、capture→拍摄中/看拍摄进度、
// editing→剪辑中/继续剪辑、rendered→已出片/去发布、published→已发布/看数据
export function deriveNextAction(project: ProjectLike): NextAction {
  const stage = project.stage as ProjectStage;
  switch (stage) {
    case "script":
      return {
        stageLabel: "脚本中",
        stages: stagesUpTo("script"),
        nextLine: "脚本还没写完，画面需求 AI 会顺手标好",
        pulsing: false,
        actionLabel: "继续写脚本",
        target: "script",
      };
    case "capture":
      return {
        stageLabel: "拍摄中",
        stages: stagesUpTo("capture"),
        nextLine: "拍摄清单已就位，拍完把素材扔回来",
        pulsing: false,
        actionLabel: "看拍摄进度",
        target: "capture",
      };
    case "editing":
      return {
        stageLabel: "剪辑中",
        stages: stagesUpTo("editing"),
        nextLine: "素材齐了，AI 已备好一版粗剪等你过目",
        pulsing: true,
        actionLabel: "继续剪辑",
        target: "editing",
      };
    case "rendered":
      return {
        stageLabel: "已出片",
        stages: stagesUpTo("rendered"),
        nextLine: "成片已经落到本地，随时可以去发布",
        pulsing: false,
        actionLabel: "去发布",
        target: "rendered",
      };
    case "published":
      return {
        stageLabel: "已发布",
        stages: stagesUpTo("published"),
        nextLine: "已经发出去了，回头看看数据怎么样",
        pulsing: false,
        actionLabel: "看数据",
        target: "published",
      };
    default:
      return unknownStageAction();
  }
}

// 恢复断点适配:把 loadProject 的结果整成 AiEditWorkbench 认得的 CaptureWorkflowResult。
// AiEditWorkbench 只以 workflow.projectId 判空(约 212 行),因此只要 project 存在就必须带上
// projectId,让剪辑页进入真实态而非「先准备一组真实素材」空态。
// storyboard / tasks / capturePackage 缺失时按可选处理:tasks 缺失退化为空数组,
// storyboard / capturePackage 缺失则不带该字段(剪辑页会据缺口继续引导)。
export function workflowFromLoadedProject(
  loaded: LoadProjectResult,
): CaptureWorkflowResult {
  if (!loaded.ok || !loaded.project) {
    return { ok: false, errorCode: loaded.errorCode, message: loaded.message ?? "项目载入失败" };
  }
  return {
    ok: true,
    projectId: loaded.project.id,
    script: loaded.script,
    storyboard: loaded.storyboard,
    tasks: loaded.tasks ?? [],
    capturePackage: loaded.capturePackage
      ? {
          id: loaded.capturePackage.id,
          relativePath: loaded.capturePackage.relativePath,
          status: loaded.capturePackage.status,
        }
      : undefined,
  };
}

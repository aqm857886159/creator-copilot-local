/*
 * 工作台纯函数 · 切片 1
 * - deriveNextAction:真实 stage 枚举 → 卡片阶段条 + 一句人话下一步 + 行动按钮文案
 * 纯函数,无 IPC、无 DOM,便于单测。文案语气取自 docs/design/01-workbench.html。
 * (切片 3:退役旧 AI 剪辑页后,原 workflowFromLoadedProject 适配器随最后调用方一并移除;
 *  新剪辑页按 projectId 自行 loadProject。)
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
        // 阶段推进后(S3c):项目进 editing 意味着 AI 已出过一版粗剪并落库,
        // 剪辑页挂载即回读显示(latestEditProposal)。文案据此:进去过一遍就能出片。
        nextLine: "粗剪已备好，点开过一遍就能出片",
        pulsing: false,
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

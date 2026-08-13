import type { ContentProject, Idea, Workspace } from "../types";

const now = new Date().toISOString();

export const demoIdeas: Idea[] = [
  {
    id: "idea-1",
    title: "为什么很多人越努力，越做不出有记忆点的内容？",
    premise: "从表达结构和真实经验切入，拆解深度口播的同质化问题。",
    source: "radar",
    score: 92,
    status: "selected",
    tags: ["表达", "内容方法", "深度口播"],
    createdAt: now,
  },
  {
    id: "idea-2",
    title: "一个人做内容，最应该先建立的不是素材库",
    premise: "把素材管理从囤积转向可检索、可复用的创作记忆。",
    source: "manual",
    score: 86,
    status: "candidate",
    tags: ["素材库", "个人品牌"],
    createdAt: now,
  },
];

export const demoProjects: ContentProject[] = [
  {
    id: "project-1",
    title: "越努力越没记忆点？问题可能在表达结构",
    angle: "从“努力”转向“观点组织方式”，给出三个可以立刻调整的口播动作。",
    stage: "script",
    platform: "抖音",
    format: "真人深度口播",
    dueAt: "今天 18:00",
    progress: 42,
    nextAction: "完成第二版脚本并生成分镜",
    assetIds: [],
    createdAt: now,
  },
  {
    id: "project-2",
    title: "素材库不是仓库，而是你的第二个大脑",
    angle: "从创作者的实际拍摄习惯出发，讲清楚标签、证据和可复用镜头的关系。",
    stage: "idea",
    platform: "抖音",
    format: "真人深度口播",
    dueAt: "周五",
    progress: 18,
    nextAction: "补充三个真实案例",
    assetIds: [],
    createdAt: now,
  },
];

export const demoWorkspace: Workspace = {
  profile: {
    name: "内容创作者",
    niche: "商业与个人成长",
    audience: "想把复杂观点讲清楚的人",
    positioning: "用真实经验拆解内容与表达方法",
    pillars: ["表达结构", "创作方法", "个人品牌"],
  },
  projects: demoProjects,
  ideas: demoIdeas,
  assets: [],
  editJobs: [],
  reviews: [],
};

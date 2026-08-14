import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";

const id = z.string().min(1);
const isoDate = z.string().datetime({ offset: true });

export const ScriptBlockSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  order: z.number().int().nonnegative(),
  kind: z.enum(["hook", "claim", "evidence", "example", "counterpoint", "transition", "conclusion", "cta"]),
  text: z.string().min(1),
  emphasis: z.array(z.string()),
  evidenceIds: z.array(id),
  visualNeed: z.enum(["none", "support", "must_show"]),
}).strict();

export type ScriptBlock = z.infer<typeof ScriptBlockSchema>;

export const ScriptSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  projectId: id,
  topicId: id.optional(),
  topicRevision: z.number().int().positive().optional(),
  revision: z.number().int().positive(),
  status: z.enum(["draft", "reviewing", "approved", "archived"]),
  blocks: z.array(ScriptBlockSchema),
  estimatedDurationMs: z.number().int().nonnegative(),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();

export type Script = z.infer<typeof ScriptSchema>;

export const ScriptProposalShotPlanSchema = z.object({
  schemaVersion: z.literal(1),
  purpose: z.enum(["explain", "prove", "transition", "emotion", "reset", "brand"]),
  mode: z.enum(["talking_head", "broll", "screen_recording", "graphic", "generated", "still"]),
  framing: z.enum(["wide", "medium", "close", "detail", "screen"]).optional(),
  actionDescription: z.string().min(1).max(500),
  cameraDirection: z.string().min(1).max(500),
  targetMs: z.number().int().positive().max(60_000),
  sourceRequirement: z.enum(["existing_asset", "shoot_task", "generated_asset", "any"]),
  deviceHint: z.enum(["phone", "camera", "screen", "any"]),
  orientation: z.enum(["portrait", "landscape", "any"]),
  checklist: z.array(z.string().min(1).max(160)).min(1).max(8),
  referencePrompt: z.string().min(1).max(500).optional(),
}).strict();
export type ScriptProposalShotPlan = z.infer<typeof ScriptProposalShotPlanSchema>;

export const ScriptProposalBlockSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  order: z.number().int().nonnegative(),
  kind: ScriptBlockSchema.shape.kind,
  text: z.string().min(1).max(2_000),
  emphasis: z.array(z.string().min(1).max(100)).max(12),
  evidenceIds: z.array(id).max(20),
  visualNeed: ScriptBlockSchema.shape.visualNeed,
  visualSuggestion: z.string().min(1).max(500),
  shotPlan: ScriptProposalShotPlanSchema.optional(),
}).strict();
export type ScriptProposalBlock = z.infer<typeof ScriptProposalBlockSchema>;

export const ScriptProposalSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  workspaceId: id,
  topicId: id.optional(),
  topicRevision: z.number().int().positive().optional(),
  brief: z.string().min(1).max(5_000),
  voiceProfile: z.string().max(3_000).optional(),
  blocks: z.array(ScriptProposalBlockSchema).min(1).max(30),
  styleNotes: z.array(z.string().min(1).max(300)).max(12),
  warnings: z.array(z.string().min(1).max(300)).max(12),
  status: z.enum(["previewed", "accepted", "rejected", "expired"]),
  provider: z.object({ providerKey: id, modelKey: id.optional(), responseHash: id.optional() }).strict(),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type ScriptProposal = z.infer<typeof ScriptProposalSchema>;

export const ShotSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  storyboardId: id,
  order: z.number().int().nonnegative(),
  scriptBlockIds: z.array(id),
  purpose: z.enum(["explain", "prove", "transition", "emotion", "reset", "brand"]),
  mode: z.enum(["talking_head", "broll", "screen_recording", "graphic", "generated", "still"]),
  framing: z.enum(["wide", "medium", "close", "detail", "screen"]).optional(),
  cameraDirection: z.string().optional(),
  deviceHint: z.enum(["phone", "camera", "screen", "any"]).optional(),
  orientation: z.enum(["portrait", "landscape", "any"]).optional(),
  actionDescription: z.string().min(1),
  targetMs: z.number().int().positive(),
  minMs: z.number().int().positive().optional(),
  maxMs: z.number().int().positive().optional(),
  sourceRequirement: z.enum(["existing_asset", "shoot_task", "generated_asset", "any"]),
  checklist: z.array(z.string().min(1).max(160)).max(8).optional(),
  selectedTakeId: id.optional(),
  status: z.enum(["planned", "needs_material", "ready", "covered", "rejected"]),
}).strict().superRefine((shot, context) => {
  if (shot.minMs !== undefined && shot.maxMs !== undefined && shot.minMs > shot.maxMs) context.addIssue({ code: z.ZodIssueCode.custom, path: ["minMs"], message: "最小时长不能大于最大时长" });
  if (shot.minMs !== undefined && shot.targetMs < shot.minMs) context.addIssue({ code: z.ZodIssueCode.custom, path: ["targetMs"], message: "目标时长不能小于最小时长" });
  if (shot.maxMs !== undefined && shot.targetMs > shot.maxMs) context.addIssue({ code: z.ZodIssueCode.custom, path: ["targetMs"], message: "目标时长不能大于最大时长" });
});

export type Shot = z.infer<typeof ShotSchema>;

export const StoryboardSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  projectId: id,
  scriptId: id,
  scriptRevision: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: z.enum(["draft", "reviewing", "approved", "frozen"]),
  shots: z.array(ShotSchema),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();

export type Storyboard = z.infer<typeof StoryboardSchema>;

export const ShootTaskSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  projectId: id,
  shotId: id,
  title: z.string().min(1),
  instruction: z.string().min(1),
  targetMs: z.number().int().positive(),
  minMs: z.number().int().positive().optional(),
  maxMs: z.number().int().positive().optional(),
  deviceHint: z.enum(["phone", "camera", "screen", "any"]),
  orientation: z.enum(["portrait", "landscape", "any"]),
  checklist: z.array(z.string().min(1)),
  status: z.enum(["todo", "recorded", "imported", "accepted", "skipped"]),
  takeIds: z.array(id),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();

export type ShootTask = z.infer<typeof ShootTaskSchema>;

export const CapturePackageSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  projectId: id,
  storyboardRevision: z.number().int().positive(),
  format: z.literal("html"),
  relativePath: z.string().min(1),
  taskIds: z.array(id),
  status: z.enum(["draft", "ready", "superseded", "archived"]),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();

export type CapturePackage = z.infer<typeof CapturePackageSchema>;

export const TakeSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  shootTaskId: id,
  assetId: id,
  relativePath: z.string().min(1),
  capturedAt: isoDate.optional(),
  durationMs: z.number().int().nonnegative().optional(),
  status: z.enum(["unreviewed", "candidate", "selected", "rejected"]),
  note: z.string().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();

export type Take = z.infer<typeof TakeSchema>;

export type ShotDraft = Omit<Shot, "schemaVersion" | "storyboardId" | "status"> & { status?: Shot["status"] };

export function createStoryboard(input: {
  id: string;
  script: Script;
  shots: ShotDraft[];
  createdAt: string;
}) {
  const storyboard = StoryboardSchema.parse({
    schemaVersion: 1,
    id: input.id,
    projectId: input.script.projectId,
    scriptId: input.script.id,
    scriptRevision: input.script.revision,
    revision: 1,
    status: "draft",
    shots: input.shots.map((shot, index) => ShotSchema.parse({ ...shot, schemaVersion: 1, id: shot.id || `${input.id}-shot-${index + 1}`, storyboardId: input.id, order: index, status: shot.status ?? "planned" })),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  const blockIds = new Set(input.script.blocks.map((block) => block.id));
  for (const shot of storyboard.shots) for (const blockId of shot.scriptBlockIds) if (!blockIds.has(blockId)) throw new Error(`分镜引用了不存在的脚本段落：${blockId}`);
  return storyboard;
}

export function assertLayeredStoryboardCoverage(scriptInput: Script, storyboardInput: Storyboard) {
  const script = ScriptSchema.parse(scriptInput);
  const storyboard = StoryboardSchema.parse(storyboardInput);
  if (storyboard.scriptId !== script.id || storyboard.scriptRevision !== script.revision) throw new Error("分镜与脚本版本不一致");
  for (const block of script.blocks) {
    const shots = storyboard.shots.filter((shot) => shot.scriptBlockIds.includes(block.id));
    const primaryShots = shots.filter((shot) => shot.mode === "talking_head");
    if (primaryShots.length !== 1) throw new Error(`脚本段落 ${block.id} 必须且只能有一个口播主干镜头`);
    if (primaryShots[0].scriptBlockIds.length !== 1) throw new Error(`口播主干镜头 ${primaryShots[0].id} 只能对应一个脚本段落`);
    if (block.visualNeed !== "none" && !shots.some((shot) => shot.mode !== "talking_head")) throw new Error(`脚本段落 ${block.id} 需要至少一个补充画面`);
  }
}

export function createShootTasks(storyboard: Storyboard, createdAt: string) {
  return storyboard.shots.filter((shot) => shot.sourceRequirement === "shoot_task" || shot.mode === "talking_head" || shot.mode === "broll").map((shot) => ShootTaskSchema.parse({
    schemaVersion: 1,
    id: `${storyboard.id}-task-${String(shot.order + 1).padStart(2, "0")}`,
    projectId: storyboard.projectId,
    shotId: shot.id,
    title: `镜头 ${String(shot.order + 1).padStart(2, "0")} · ${shot.purpose === "explain" ? "解释观点" : shot.purpose === "prove" ? "补充证据" : "完成画面"}`,
    instruction: shot.actionDescription,
    targetMs: shot.targetMs,
    minMs: shot.minMs,
    maxMs: shot.maxMs,
    deviceHint: shot.deviceHint ?? (shot.mode === "screen_recording" ? "screen" : "phone"),
    orientation: shot.orientation ?? "portrait",
    checklist: shot.checklist ?? ["画面稳定，主体完整", "按目标时长多拍 2 秒余量", "保留一条自然开头和结尾"],
    status: "todo",
    takeIds: [],
    createdAt,
    updatedAt: createdAt,
  }));
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function durationLabel(milliseconds: number) {
  const seconds = (milliseconds / 1000).toFixed(1).replace(/\.0$/, "");
  return `${seconds} 秒`;
}

export function renderCapturePackageHtml(input: { projectTitle: string; storyboard: Storyboard; tasks: ShootTask[]; generatedAt: string }) {
  const storyboard = StoryboardSchema.parse(input.storyboard);
  const tasks = input.tasks.map((task) => ShootTaskSchema.parse(task));
  const taskByShot = new Map(tasks.map((task) => [task.shotId, task]));
  const cards = storyboard.shots.map((shot) => {
    const task = taskByShot.get(shot.id);
    return `<article class="shot ${task ? "has-task" : "reference-only"}">
      <div class="shot-top"><span>镜头 ${String(shot.order + 1).padStart(2, "0")}</span><b>${escapeHtml(shot.mode)}</b><em>${durationLabel(shot.targetMs)}</em></div>
      <h2>${escapeHtml(shot.actionDescription)}</h2>
      <p class="why">画面目的：${escapeHtml(shot.purpose)}</p>
      ${shot.cameraDirection ? `<p><strong>拍法：</strong>${escapeHtml(shot.cameraDirection)}</p>` : ""}
      ${task ? `<div class="task"><p><strong>执行：</strong>${escapeHtml(task.instruction)}</p><p><strong>设备：</strong>${escapeHtml(task.deviceHint)} · ${escapeHtml(task.orientation)} · 建议拍 ${durationLabel(task.targetMs)}</p><ul>${task.checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : "<p class=\"reference\">此镜头使用已有素材或后续生成素材，无需现场拍摄。</p>"}
    </article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.projectTitle)} · 拍摄包</title>
<style>body{margin:0;background:#f4f0e8;color:#29251f;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;line-height:1.6}.page{max-width:760px;margin:auto;padding:28px 18px 48px}.eyebrow{color:#8e877b;font-size:11px;letter-spacing:.14em}.intro{border-bottom:1px solid #d9d1c4;padding-bottom:20px;margin-bottom:18px}.intro h1{font-family:Georgia,"Songti SC",serif;font-weight:500;font-size:31px;line-height:1.2;margin:8px 0}.meta{color:#777064;font-size:12px}.shot{background:#fffdf8;border:1px solid #ded7ca;border-radius:12px;padding:16px;margin:12px 0;break-inside:avoid}.shot-top{display:flex;gap:9px;align-items:center;color:#928a7c;font-size:11px}.shot-top b{font-weight:500;background:#e6eee1;color:#55704f;border-radius:5px;padding:2px 7px}.shot-top em{font-style:normal;margin-left:auto}.shot h2{font-family:Georgia,"Songti SC",serif;font-weight:500;font-size:21px;line-height:1.35;margin:13px 0 6px}.shot p{font-size:13px;margin:7px 0;color:#625c53}.why{color:#958d80!important;font-size:11px!important}.task{border-top:1px solid #ece6db;margin-top:14px;padding-top:10px}.task p{margin:6px 0}.task ul{margin:8px 0 0;padding-left:20px;color:#625c53;font-size:12px}.reference{color:#9b9285!important;background:#f2eee6;border-radius:7px;padding:8px 10px;font-size:11px!important}@media print{body{background:#fff}.page{padding:0}.shot{box-shadow:none}}</style></head>
<body><main class="page"><header class="intro"><div class="eyebrow">CREATOR COPILOT · OFFLINE CAPTURE PACKAGE</div><h1>${escapeHtml(input.projectTitle)}</h1><div class="meta">分镜 ${storyboard.revision} · 生成于 ${escapeHtml(input.generatedAt)} · 共 ${storyboard.shots.length} 个镜头</div></header>${cards}</main></body></html>`;
}

export async function exportCapturePackage(input: { workspaceRoot: string; projectTitle: string; capturePackage: CapturePackage; storyboard: Storyboard; tasks: ShootTask[] }) {
  const root = resolve(input.workspaceRoot);
  const packagePath = resolve(root, input.capturePackage.relativePath);
  if (packagePath !== root && !packagePath.startsWith(`${root}${sep}`)) throw new Error("拍摄包路径越过工作区");
  if (extname(packagePath).toLowerCase() !== ".html") throw new Error("拍摄包必须导出为 HTML");
  const html = renderCapturePackageHtml({ projectTitle: input.projectTitle, storyboard: input.storyboard, tasks: input.tasks, generatedAt: input.capturePackage.createdAt });
  await mkdir(resolve(packagePath, ".."), { recursive: true });
  const temporaryPath = `${packagePath}.tmp-${process.pid}-${Date.now()}.html`;
  try {
    await writeFile(temporaryPath, html, "utf8");
    await rename(temporaryPath, packagePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return { ...input.capturePackage, relativePath: relative(root, packagePath).split(sep).join("/"), status: "ready" as const, updatedAt: new Date().toISOString() };
}

export function selectTake(task: ShootTask, takes: Take[], takeId: string) {
  const normalizedTask = ShootTaskSchema.parse(task);
  const normalizedTakes = takes.map((take) => TakeSchema.parse(take));
  if (!normalizedTask.takeIds.includes(takeId)) throw new Error("Take 不属于这个拍摄任务");
  const selected = normalizedTakes.find((take) => take.id === takeId && take.shootTaskId === normalizedTask.id);
  if (!selected) throw new Error("找不到要选中的 Take");
  return {
    task: { ...normalizedTask, status: "accepted" as const, updatedAt: new Date().toISOString() },
    takes: normalizedTakes.map((take) => ({ ...take, status: take.id === takeId ? "selected" as const : take.status === "selected" ? "candidate" as const : take.status })),
  };
}

export function attachTake(task: ShootTask, take: Take) {
  const normalizedTask = ShootTaskSchema.parse(task);
  const normalizedTake = TakeSchema.parse(take);
  if (normalizedTake.shootTaskId !== normalizedTask.id) throw new Error("Take 与拍摄任务不匹配");
  return ShootTaskSchema.parse({ ...normalizedTask, takeIds: normalizedTask.takeIds.includes(normalizedTake.id) ? normalizedTask.takeIds : [...normalizedTask.takeIds, normalizedTake.id], status: "imported", updatedAt: new Date().toISOString() });
}

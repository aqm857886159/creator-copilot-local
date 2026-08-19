/*
 * 脚本页纯函数 · 切片 2
 * 事实源:docs/design/02-script.html、docs/plan/2026-08-20-retire-legacy-pages-s2-script.md
 * 全部无 IPC、无 DOM,便于单测。文案语气取自蓝本(全角标点逐字)。
 */

// 视觉需求三档:与域模型 visualNeed 枚举一一对应。
export type VisualNeed = "none" | "support" | "must_show";

const VISUAL_NEED_ORDER: VisualNeed[] = ["none", "support", "must_show"];

// 蓝本 chip 文案:none→不配画面、support→配画面更好、must_show→必须配画面。
const VISUAL_NEED_LABEL: Record<VisualNeed, string> = {
  none: "不配画面",
  support: "配画面更好",
  must_show: "必须配画面",
};

export function visualNeedLabel(need: VisualNeed): string {
  return VISUAL_NEED_LABEL[need];
}

// 点击轮换顺序:none → support → must_show → none。
export function nextVisualNeed(need: VisualNeed): VisualNeed {
  const index = VISUAL_NEED_ORDER.indexOf(need);
  return VISUAL_NEED_ORDER[(index + 1) % VISUAL_NEED_ORDER.length];
}

// emphasis 高亮:把台词切成若干「run」,mark=true 的 run 由 <mark> 包裹。
// 用切段而非直接拼 HTML,避免把用户文本当 HTML 注入。
export interface TextRun {
  text: string;
  mark: boolean;
}

interface Range {
  start: number;
  end: number;
}

// 找出所有 emphasis 词在 text 中的完整子串匹配范围(每个词的每次出现都标)。
// 匹配不到的词不硬造;空词跳过。范围重叠会在下一步合并。
function emphasisRanges(text: string, emphasis: string[]): Range[] {
  const ranges: Range[] = [];
  for (const rawWord of emphasis) {
    const word = rawWord;
    if (!word) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(word, from);
      if (at === -1) break;
      ranges.push({ start: at, end: at + word.length });
      // 允许重叠出现:游标只前进一个字符,保证 "aa" 里两个 "aa" 起点都被扫到。
      from = at + 1;
    }
  }
  return ranges;
}

// 合并重叠或相邻(端点相接)的范围,得到不相交、升序的高亮区间。
function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: Range[] = [{ ...sorted[0] }];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

export function segmentEmphasis(text: string, emphasis: string[]): TextRun[] {
  if (!text) return [];
  const highlights = mergeRanges(emphasisRanges(text, emphasis));
  if (highlights.length === 0) return [{ text, mark: false }];
  const runs: TextRun[] = [];
  let cursor = 0;
  for (const range of highlights) {
    if (range.start > cursor) runs.push({ text: text.slice(cursor, range.start), mark: false });
    runs.push({ text: text.slice(range.start, range.end), mark: true });
    cursor = range.end;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), mark: false });
  return runs;
}

// 底部闸门句(自适应)。当前域模型没有「AI 拿不准」信号 → 例外问题恒 0 条,
// 只说「画面需求已标好 N 段」,绝不出现「X 段等你拿主意」的假话。
export function gateSentence(blockCount: number): string {
  // 「N 段的…已全部标好」而非「已标好 N 段」:后者会被读成「有 N 段需要配画面」。
  return `${blockCount} 段的画面需求已全部标好，不用再逐段确认。`;
}

// 分镜新鲜度:脚本修订号超过分镜生成时记录的修订号即「过时」;没有分镜为 none。
// 编辑台词或改画面需求都会 +1 修订,因此任何改动后提示「重新生成会替换」是准确的。
export type StoryboardFreshness = "none" | "fresh" | "stale";

export function storyboardFreshness(scriptRevision: number, storyboardScriptRevision: number | null): StoryboardFreshness {
  if (storyboardScriptRevision == null) return "none";
  return scriptRevision > storyboardScriptRevision ? "stale" : "fresh";
}

// 秒数标注:蓝本轨道上的「~Ns」。四舍五入到整秒,至少 1 秒。
export function durationSecondsLabel(estimatedMs: number): string {
  return `~${Math.max(1, Math.round(estimatedMs / 1000))}s`;
}

// 时长卡:预计 vs 目标,进度条百分比(封顶 100%)。
// 域模型当前没有目标时长字段:调用方不传目标就只给「预计」,不伪造目标与进度。
export interface DurationView {
  estimatedSeconds: number;
  targetSeconds?: number;
  ratio?: number; // 0–1,给进度条宽度;无目标时不给
}

export function durationView(estimatedMs: number, targetSeconds?: number): DurationView {
  const estimatedSeconds = Math.max(0, Math.round(estimatedMs / 1000));
  if (typeof targetSeconds !== "number" || targetSeconds <= 0) return { estimatedSeconds };
  return { estimatedSeconds, targetSeconds, ratio: Math.min(1, estimatedSeconds / targetSeconds) };
}

// 与 packages/creation 的时长公式同构(260ms/字,1500ms 底垫)。该包顶部 import node:fs,
// 不能进 Vite 前端打包,故此处镜像仅作显示估计;存盘后以主进程回传的权威值覆盖。
export function estimateBlockMsForDisplay(text: string): number {
  return Math.max(1_500, Math.round(text.length * 260));
}

export function estimateScriptMsForDisplay(texts: string[]): number {
  return texts.reduce((total, text) => total + estimateBlockMsForDisplay(text), 0);
}

// 段落 kind → 中文短标(蓝本轨道上的 .kind)。
const KIND_LABEL: Record<string, string> = {
  hook: "开头",
  claim: "观点",
  evidence: "证据",
  example: "例子",
  counterpoint: "反例",
  transition: "过渡",
  conclusion: "结论",
  cta: "号召",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

// ---- 生成分镜:从 payload.shotPlans 组装 shots(与旧 creation 流同源) ----
// 复用旧 creation-workbench 的 restoreScriptDraftShots 设计:口播主干 + 视需要补一条补充画面。
// 旧组件文件一行不改;这里独立重写同一套规则,供新脚本页闸门调用。

type ShotPurpose = "explain" | "prove" | "transition" | "emotion" | "reset" | "brand";
type ShotMode = "talking_head" | "broll" | "screen_recording" | "graphic" | "generated" | "still";
type ShotFraming = "wide" | "medium" | "close" | "detail" | "screen";
type SourceRequirement = "existing_asset" | "shoot_task" | "generated_asset" | "any";
type DeviceHint = "phone" | "camera" | "screen" | "any";
type Orientation = "portrait" | "landscape" | "any";

const shotPurposes: readonly ShotPurpose[] = ["explain", "prove", "transition", "emotion", "reset", "brand"];
const shotModes: readonly ShotMode[] = ["talking_head", "broll", "screen_recording", "graphic", "generated", "still"];
const shotFramings: readonly ShotFraming[] = ["wide", "medium", "close", "detail", "screen"];
const sourceRequirements: readonly SourceRequirement[] = ["existing_asset", "shoot_task", "generated_asset", "any"];
const deviceHints: readonly DeviceHint[] = ["phone", "camera", "screen", "any"];
const orientations: readonly Orientation[] = ["portrait", "landscape", "any"];

function savedLiteral<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

// 脚本页里的段落:只需要生成分镜要用到的字段。
export interface ScriptBlockLike {
  id: string;
  kind: string;
  text: string;
  visualNeed: VisualNeed;
}

export type AssembledShot = CaptureWorkflowInput["shots"][number];

// 从段落 + payload.shotPlans 组装分镜草稿。每段一条口播主干;visualNeed≠none
// 或计划里给了非口播模式时,再补一条补充画面(与旧流一致,避免破坏分镜覆盖校验)。
export function assembleShotsFromPlans(blocks: ScriptBlockLike[], shotPlansRaw: unknown): AssembledShot[] {
  const rawPlans = shotPlansRaw && typeof shotPlansRaw === "object" && !Array.isArray(shotPlansRaw)
    ? (shotPlansRaw as Record<string, unknown>)
    : {};
  return blocks.flatMap((block, index) => {
    const rawPlan = rawPlans[block.id] && typeof rawPlans[block.id] === "object" && !Array.isArray(rawPlans[block.id])
      ? (rawPlans[block.id] as Record<string, unknown>)
      : {};
    const supplementalMode = savedLiteral(rawPlan.mode, shotModes, "talking_head");
    const primary: AssembledShot = {
      scriptBlockIndex: index,
      purpose: block.kind === "hook" ? "emotion" : "explain",
      mode: "talking_head",
      framing: savedLiteral(rawPlan.framing, shotFramings, index === 0 ? "medium" : "close"),
      cameraDirection: "手机竖拍，中景，完整讲完这一段并在结尾多留两秒。",
      deviceHint: savedLiteral(rawPlan.deviceHint, deviceHints, "phone"),
      orientation: savedLiteral(rawPlan.orientation, orientations, "portrait"),
      checklist: Array.isArray(rawPlan.checklist) ? rawPlan.checklist.filter((item): item is string => typeof item === "string") : [],
      actionDescription: `面对镜头自然讲出：${block.text}`,
      targetMs: typeof rawPlan.targetMs === "number" && rawPlan.targetMs > 0 ? rawPlan.targetMs : 4_000,
      sourceRequirement: "shoot_task",
    };
    const supplementalModeForBlock: ShotMode = supplementalMode === "talking_head" ? "broll" : supplementalMode;
    const shouldSupplement = block.visualNeed !== "none" || supplementalMode !== "talking_head";
    const supplemental: AssembledShot[] = shouldSupplement && savedLiteral(rawPlan.sourceRequirement, sourceRequirements, "shoot_task") !== "generated_asset"
      ? [{
          scriptBlockIndex: index,
          purpose: savedLiteral(rawPlan.purpose, shotPurposes, "prove"),
          mode: supplementalModeForBlock,
          framing: supplementalModeForBlock === "broll" ? "detail" : savedLiteral(rawPlan.framing, shotFramings, "detail"),
          cameraDirection: supplementalMode === "talking_head"
            ? "手机俯拍或录屏，完整展示能证明这一段话的具体画面。"
            : typeof rawPlan.cameraDirection === "string" ? rawPlan.cameraDirection : "保持主体清晰，拍摄一条备用版本。",
          deviceHint: supplementalModeForBlock === "screen_recording" ? "screen" : savedLiteral(rawPlan.deviceHint, deviceHints, "phone"),
          orientation: savedLiteral(rawPlan.orientation, orientations, "portrait"),
          checklist: primary.checklist,
          actionDescription: supplementalMode === "talking_head"
            ? `拍摄能够支撑“${block.text}”的真实画面。`
            : typeof rawPlan.actionDescription === "string" ? rawPlan.actionDescription : `拍摄能够支撑“${block.text}”的真实画面。`,
          targetMs: typeof rawPlan.targetMs === "number" && rawPlan.targetMs > 0 ? Math.min(rawPlan.targetMs, 3_000) : 3_000,
          sourceRequirement: supplementalModeForBlock === "screen_recording" ? "shoot_task" : savedLiteral(rawPlan.sourceRequirement, sourceRequirements, "shoot_task"),
        }]
      : [];
    return [primary, ...supplemental];
  });
}

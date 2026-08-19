/*
 * 剪辑页纯函数 · 切片 3
 * 事实源:docs/design/03-edit.html、docs/plan/2026-08-20-s3-edit-page-and-mainline.md
 * 全部无 IPC、无 DOM,便于单测。文案语气与全角标点取自蓝本。
 *
 * 数据来源(诚实降级):
 * - 行标题短标 = placement/role 中文短标(口播主干 / 补充画面 …);
 * - 行说明 p = operation.reason 原文(本地提案器较平实,照实显示,不编文案);
 * - 证据行 = evidenceIds 对应 fact 文本 + sourceSegment 起点时间码,格式「▸ 素材号 00:00『…』」;
 * - confidence < 0.8 标「待确认」(旧页 proposal-topline 有此语义)。
 */

// 与 global.d.ts 的 EditProposalOperation 对齐(此处只取纯函数用到的字段,避免耦合整个 window 类型)。
export type OperationPlacement = "primary" | "overlay";
export type OperationRole = "a_roll" | "b_roll" | "screen" | "generated" | "still";
export type OperationStatus = "suggested" | "accepted" | "rejected";

export interface EditOperationLike {
  id: string;
  shotId: string;
  sourceAssetId: string;
  sourceSegment: { startMs: number; endMs: number };
  timeline: { startMs: number; endMs: number };
  role: OperationRole;
  placement?: OperationPlacement;
  reason: string;
  evidenceIds: string[];
  confidence: number;
  status: OperationStatus;
}

export interface EvidenceFactLike {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

// 置信度阈值:>= 0.8 视为高置信度,不加小标;低于则「待确认」。与旧页 proposal-topline 判定一致。
const CONFIDENCE_THRESHOLD = 0.8;

// mm:ss 时间码(封底 0,四舍五入到秒)。用于时间段与证据引用,蓝本 mono 显示。
export function timecode(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// 时间段「00:00–00:06」。用 en dash,与蓝本一致。
export function timelineRange(timeline: { startMs: number; endMs: number }): string {
  return `${timecode(timeline.startMs)}–${timecode(timeline.endMs)}`;
}

// 秒数汇总:向下不小于 0,四舍五入到整秒,给「共 Ns」。
export function secondsLabel(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}

// placement + role → 蓝本时间列下方的中文短标。
// primary 恒为口播主干;overlay 按 role 细分(补充画面 / 录屏 / 生成画面 / 静帧)。
const ROLE_LABEL: Record<OperationRole, string> = {
  a_roll: "口播主干",
  b_roll: "补充画面",
  screen: "录屏画面",
  generated: "生成画面",
  still: "静帧",
};

export function placementRoleLabel(placement: OperationPlacement | undefined, role: OperationRole): string {
  if (placement === "primary" || role === "a_roll") return "口播主干";
  return ROLE_LABEL[role] ?? "补充画面";
}

// 证据引用行「▸ 素材号 00:00『文本』」。取第一条命中的 fact 文本 + 其起点时间码;
// fact 查不到就退化为素材号 + sourceSegment 起点(不伪造文本)。
export interface EvidenceLine {
  assetId: string;
  timecode: string;
  text: string | null;
}

// 素材显示名:有文件名用文件名(basename),没有就截短 ID —— 裸 UUID 对用户是天书。
export function assetDisplayName(assetId: string, assetNameById?: Map<string, string>): string {
  const named = assetNameById?.get(assetId);
  if (named) return named;
  return assetId.length > 14 ? `素材 ${assetId.slice(0, 8)}…` : assetId;
}

export function evidenceLine(operation: EditOperationLike, evidenceById: Map<string, EvidenceFactLike>, assetNameById?: Map<string, string>): EvidenceLine {
  const fact = operation.evidenceIds.map((id) => evidenceById.get(id)).find((candidate): candidate is EvidenceFactLike => Boolean(candidate));
  return {
    assetId: assetDisplayName(operation.sourceAssetId, assetNameById),
    timecode: timecode(fact ? fact.startMs : operation.sourceSegment.startMs),
    text: fact ? fact.text : null,
  };
}

// 证据行拼成蓝本字符串(供无障碍标签/文本断言);有文本才加『』。
export function evidenceLineText(line: EvidenceLine): string {
  const head = `▸ ${line.assetId} ${line.timecode}`;
  return line.text ? `${head}『${line.text}』` : head;
}

// 单条镜头行视图:把 operation 映射为蓝本 .row 需要的字段。
export interface EditRowView {
  id: string;
  index: string; // 两位序号
  timelineRange: string;
  placementLabel: string;
  reason: string;
  evidence: EvidenceLine;
  dropped: boolean; // status === rejected → 弃用态(整行压暗划除)
  needsConfirm: boolean; // confidence < 0.8 → 行内「待确认」
}

// 默认采用:未被标 rejected 即采用(旧页 renderProposal 语义 —— 非 rejected 一律 accepted)。
export function isKept(operation: EditOperationLike): boolean {
  return operation.status !== "rejected";
}

export function toRowView(operation: EditOperationLike, index: number, evidenceById: Map<string, EvidenceFactLike>, assetNameById?: Map<string, string>): EditRowView {
  return {
    id: operation.id,
    index: String(index + 1).padStart(2, "0"),
    timelineRange: timelineRange(operation.timeline),
    placementLabel: placementRoleLabel(operation.placement, operation.role),
    reason: operation.reason,
    evidence: evidenceLine(operation, evidenceById, assetNameById),
    dropped: operation.status === "rejected",
    needsConfirm: operation.confidence < CONFIDENCE_THRESHOLD,
  };
}

// 头行汇总「N 个镜头 · 粗剪 Ns / 台词约 Ms · K 条素材」。粗剪时长取 proposal.durationMs;
// 给出台词预计时长做对账,免得用户看到远短于口播的数字以为素材被吞了。
// 台词时长未知时退化为「共 Ns」;素材数为 0 或未知时省略该段。
export function headSummary(operations: EditOperationLike[], durationMs: number, assetCount?: number, scriptDurationMs?: number): string {
  const duration = typeof scriptDurationMs === "number" && scriptDurationMs > 0
    ? `粗剪 ${secondsLabel(durationMs)} / 台词约 ${secondsLabel(scriptDurationMs)}`
    : `共 ${secondsLabel(durationMs)}`;
  const parts = [`${operations.length} 个镜头`, duration];
  if (typeof assetCount === "number" && assetCount > 0) parts.push(`${assetCount} 条素材`);
  return parts.join(" · ");
}

export function distinctAssetCount(operations: EditOperationLike[]): number {
  return new Set(operations.map((operation) => operation.sourceAssetId)).size;
}

// 闸门汇总句(诚实):几采用、几不用、几缺口。数字实时对账,不承诺代码没做到的事。
// 缺口默认「先用口播带过」——粗剪本来就跳过缺口,这句只是陈述事实。
export interface GateCounts {
  kept: number;
  dropped: number;
  gaps: number;
}

export function gateCounts(operations: EditOperationLike[], missingCount: number): GateCounts {
  const kept = operations.filter((operation) => isKept(operation)).length;
  return { kept, dropped: operations.length - kept, gaps: missingCount };
}

export function gateSentence(counts: GateCounts): string {
  const head = counts.dropped > 0
    ? `${counts.kept} 个镜头采用、${counts.dropped} 个不用`
    : `${counts.kept} 个镜头全部采用`;
  const gap = counts.gaps > 0 ? `，缺口先用口播带过` : "";
  return `${head}${gap} —— 出片不改你的素材，随时能重出一版。`;
}

// 至少采用一个镜头才能出片(旧页 renderProposal 前置校验)。
export function canRender(operations: EditOperationLike[]): boolean {
  return operations.some((operation) => isKept(operation));
}

// 缺口行视图:来自 result.missing。required !== false 为阻塞缺口(记号红更重),否则可选补充。
export interface MissingItemLike {
  shotId: string;
  taskId?: string;
  reason: string;
  instruction: string;
  required?: boolean;
}

export interface EditGapView {
  key: string;
  instruction: string;
  required: boolean;
}

export function toGapView(item: MissingItemLike): EditGapView {
  return {
    key: `${item.shotId}-${item.taskId ?? "none"}`,
    instruction: item.instruction,
    required: item.required !== false,
  };
}

// 候选素材 chip 文本「▸ 名称 时间码」。名称取 relativePath 末段(去目录),时间码取 sourceSegment 起点。
export interface AssetCandidateLike {
  assetId: string;
  relativePath: string;
  sourceSegment?: { startMs: number; endMs: number };
  reason: string;
}

export function candidateFileName(relativePath: string): string {
  const segments = relativePath.split("/");
  return segments[segments.length - 1] || relativePath;
}

export function candidateChipText(candidate: AssetCandidateLike): string {
  const tail = candidate.sourceSegment ? ` ${timecode(candidate.sourceSegment.startMs)}` : "";
  return `▸ ${candidateFileName(candidate.relativePath)}${tail}`;
}

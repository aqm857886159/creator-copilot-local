import { useEffect, useState } from "react";
import { Check, ChevronRight, CircleAlert, Download, Film, PackageOpen, RotateCcw, Search, Sparkles, X } from "lucide-react";

function seconds(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(1).replace(/\.0$/, "")} 秒`;
}

function roleLabel(role: EditProposalOperation["role"]) {
  return { a_roll: "主口播", b_roll: "补充画面", screen: "录屏", generated: "生成素材", still: "静帧" }[role];
}

function placementLabel(placement: EditProposalOperation["placement"]) {
  return placement === "overlay" ? "画面覆盖" : "口播主干";
}

type RenderRecoveryItem = NonNullable<RenderRecoveryListResult["items"]>[number];

function AssetCandidateSection({ candidates, openFile, adoptCandidate }: { candidates: NonNullable<EditProposalResult["assetCandidates"]>; openFile: (relativePath: string) => Promise<void>; adoptCandidate: (shotId: string, candidate: NonNullable<EditProposalResult["assetCandidates"]>[number]["candidates"][number]) => Promise<void> }) {
  const sets = candidates.filter((set) => set.candidates.length > 0);
  if (sets.length === 0) return null;
  return <section className="edit-candidates"><div className="edit-section-heading"><div><div className="eyebrow">LOCAL CANDIDATES · REVIEW FIRST</div><h3>从素材库召回的候选画面</h3></div><span>{sets.reduce((count, set) => count + set.candidates.length, 0)} 个候选</span></div><p className="edit-candidate-note">候选只来自已经写入本地的 ASR、OCR 或镜头事实；先打开预览确认，再点击“作为 Take”把素材明确交给这个分镜。</p>{sets.map((set) => <div className="edit-candidate-shot" key={set.shotId}><strong>分镜 {set.shotId}</strong><div className="edit-candidate-list">{set.candidates.map((candidate) => <article className="edit-candidate-row" key={`${set.shotId}-${candidate.assetId}`}><div><div className="edit-candidate-topline"><span>{candidate.confidence === "high" ? "高" : candidate.confidence === "medium" ? "中" : "低"}置信度 · {Math.round(candidate.score * 100)}%</span><span>{candidate.relativePath}</span></div><p>{candidate.reason}</p><small>证据：{candidate.evidenceIds.length > 0 ? candidate.evidenceIds.join("、") : "无文本命中，仅类型匹配"}{candidate.sourceSegment ? ` · ${seconds(candidate.sourceSegment.endMs - candidate.sourceSegment.startMs)} 片段` : ""}</small></div><div className="edit-candidate-actions"><button className="text-button" onClick={() => void openFile(candidate.relativePath)}><Search size={13} />打开预览</button><button className="secondary-button" onClick={() => void adoptCandidate(set.shotId, candidate)}><Check size={13} />作为 Take</button></div></article>)}</div></div>)}</section>;
}

export function AiEditWorkbench({ workflow, openProjects }: { workflow: CaptureWorkflowResult | null; openProjects: () => void }) {
  const [proposal, setProposal] = useState<EditProposal | null>(null);
  const [missing, setMissing] = useState<NonNullable<EditProposalResult["missing"]>>([]);
  const [render, setRender] = useState<EditRenderResult | null>(null);
  const [exchange, setExchange] = useState<ExchangeExportResult | null>(null);
  const [publishPackage, setPublishPackage] = useState<PublishPackageResult | null>(null);
  const [provider, setProvider] = useState<EditProposalResult["provider"]>(undefined);
  const [analysisFacts, setAnalysisFacts] = useState<NonNullable<EditProposalResult["analysisFacts"]>>([]);
  const [assetCandidates, setAssetCandidates] = useState<NonNullable<EditProposalResult["assetCandidates"]>>([]);
  const [proposalRetryNonce, setProposalRetryNonce] = useState<string | undefined>(undefined);
  const [pendingRecovery, setPendingRecovery] = useState<{ idempotencyScope: string; idempotencyKey: string } | null>(null);
  const [renderRecovery, setRenderRecovery] = useState<RenderRecoveryItem | null>(null);

  useEffect(() => {
    let active = true;
    if (!workflow?.projectId || !window.desktop) return () => { active = false; };
    void window.desktop.listEditProposalRecoveries(workflow.projectId).then((response) => {
      const recovery = response.items?.[0];
      if (active && recovery) {
        setPendingRecovery({ idempotencyScope: recovery.idempotencyScope, idempotencyKey: recovery.idempotencyKey });
        setMessage("发现上一次 Provider 提交状态未知的 AI 提案；请先核对用量，再决定是否结束旧请求。");
      }
    });
    return () => { active = false; };
  }, [workflow?.projectId]);
  useEffect(() => {
    let active = true;
    if (!workflow?.projectId || !window.desktop) return () => { active = false; };
    void window.desktop.listRenderRecoveries(workflow.projectId).then((response) => {
      if (active) setRenderRecovery(response.items?.[0] ?? null);
    });
    return () => { active = false; };
  }, [workflow?.projectId]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshRenderRecovery() {
    if (!workflow?.projectId || !window.desktop) return;
    const response = await window.desktop.listRenderRecoveries(workflow.projectId);
    setRenderRecovery(response.items?.[0] ?? null);
  }

  async function requestProposal() {
    if (!workflow?.projectId || !window.desktop || busy) return;
    setBusy(true);
    setMessage(null);
    setRender(null);
    setExchange(null);
    setPublishPackage(null);
    setAssetCandidates([]);
    try {
      const result = await window.desktop.proposeEdit({ projectId: workflow.projectId, retryNonce: proposalRetryNonce });
      setAssetCandidates(result.assetCandidates ?? []);
      if (!result.ok) {
        if (result.status === "pending" && result.idempotencyScope && result.idempotencyKey) setPendingRecovery({ idempotencyScope: result.idempotencyScope, idempotencyKey: result.idempotencyKey });
        setMessage(result.status === "pending" ? "上一次 AI 提案请求的提交状态仍未知，已停止自动重试；请先核对 Provider 用量。" : result.message ?? "AI 剪辑提案生成失败");
        return;
      }
      setPendingRecovery(null);
      setProposalRetryNonce(undefined);
      setProposal(result.proposal ?? null);
      setMissing(result.missing ?? []);
      setAnalysisFacts(result.analysisFacts ?? []);
      setProvider(result.provider);
      if (result.status === "needs_material") setMessage("还有镜头没有选定 Take，先补齐素材再生成完整提案。");
    } finally {
      setBusy(false);
    }
  }

  async function reconcileUnknownProposal() {
    if (!window.desktop || !pendingRecovery || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await window.desktop.reconcileEditProposal({ ...pendingRecovery, action: "user_confirmed_not_submitted" });
      if (!response.ok || !response.retryNonce) {
        setMessage(response.message ?? "人工恢复失败");
        return;
      }
      setPendingRecovery(null);
      setProposalRetryNonce(response.retryNonce);
      setMessage("已结束这次未知提交；请点击“重新分析”，系统会使用新的幂等键。只有你确认未扣费后才应执行此操作。");
    } finally {
      setBusy(false);
    }
  }

  function setOperationStatus(operationId: string, status: EditProposalOperation["status"]) {
    setProposal((current) => current ? { ...current, operations: current.operations.map((operation) => operation.id === operationId ? { ...operation, status } : operation) } : current);
  }

  async function renderProposal() {
    if (!workflow?.projectId || !proposal || !window.desktop || busy) return;
    const adopted = { ...proposal, status: "adopted", operations: proposal.operations.map((operation) => operation.status === "rejected" ? operation : { ...operation, status: "accepted" as const }) };
    if (adopted.operations.length === 0 || adopted.operations.every((operation) => operation.status === "rejected")) {
      setMessage("至少采用一个镜头后才能导出。");
      return;
    }
    setBusy(true);
    setMessage(null);
    setExchange(null);
    setPublishPackage(null);
    try {
      const result = await window.desktop.renderEdit({ projectId: workflow.projectId, proposal: adopted });
      setRender(result);
      if (!result.ok) {
        setMessage(result.message ?? "AI 剪辑导出失败");
        await refreshRenderRecovery();
      } else {
        setRenderRecovery(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function retryFailedRender() {
    if (!workflow?.projectId || !renderRecovery || !window.desktop || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.desktop.retryRender({ projectId: workflow.projectId, renderRunId: renderRecovery.renderRun.id });
      setRender(result);
      if (result.ok) {
        setRenderRecovery(null);
        setMessage("已基于原 FrozenEditSpec 重新导出；没有重新调用 AI 或更换素材。");
      } else {
        setMessage(result.message ?? "渲染重试失败");
        await refreshRenderRecovery();
      }
    } finally {
      setBusy(false);
    }
  }

  async function exportExchange(format: "fcpxml" | "otio") {
    if (!render?.renderRunId || !window.desktop || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.desktop.exportExchange({ renderRunId: render.renderRunId, formats: [format] });
      setExchange(result);
      if (!result.ok) setMessage(result.message ?? "交换格式导出失败");
    } finally {
      setBusy(false);
    }
  }

  async function createPublishPackage() {
    if (!render?.renderRunId || !window.desktop || busy) return;
    const title = window.prompt("发布标题", "把观点讲清楚")?.trim();
    if (!title) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.desktop.createPublishPackage({ renderRunId: render.renderRunId, platform: "抖音", title });
      setPublishPackage(result);
      if (!result.ok) setMessage(result.message ?? "发布包生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function openFile(relativePath: string | null | undefined) {
    if (relativePath && window.desktop) await window.desktop.openWorkspaceFile(relativePath);
  }

  async function adoptCandidate(shotId: string, candidate: NonNullable<EditProposalResult["assetCandidates"]>[number]["candidates"][number]) {
    const task = taskByShot.get(shotId);
    if (!task || !window.desktop || busy) {
      if (!task) setMessage("这个候选没有对应的拍摄任务，暂时不能作为 Take。");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.desktop.adoptAssetCandidate({ shootTaskId: task.id, assetId: candidate.assetId, sourceSegment: candidate.sourceSegment, reason: candidate.reason, evidenceIds: candidate.evidenceIds });
      if (!result.ok) {
        setMessage(result.message ?? "候选素材采用失败");
        return;
      }
      setMessage(`${result.reused ? "已复用已有 Take" : "已创建 Take"}，并已选为“${task.title}”的当前素材。重新生成 AI 剪辑提案即可使用。`);
    } finally {
      setBusy(false);
    }
  }

  if (!workflow?.projectId) {
    return <section className="edit-workbench empty-edit-workbench"><div className="empty-icon"><Film size={24} /></div><div className="eyebrow">AI EDIT</div><h1>先准备一组真实素材</h1><p>从创作项目生成拍摄包，导入并选定 Take 后，AI 会先给出可审阅的粗剪提案，再由你确认成片。</p><button className="primary-button" onClick={openProjects}><ChevronRight size={16} /> 去创作项目</button></section>;
  }

  const evidenceById = new Map(analysisFacts.map((fact) => [fact.id, fact]));
  const taskByShot = new Map((workflow.tasks ?? []).map((task) => [task.shotId, task]));

  return <section className="edit-workbench">
    <div className="creation-heading"><div><div className="eyebrow">AI EDIT · HUMAN REVIEW</div><h1>让画面替观点工作。</h1><p>AI 只提出镜头、时间码和理由；你确认后才会生成正式文件。当前先用本地可审计提案器，Provider 接入后沿用同一份合同。</p></div><div className="workspace-state ready"><span />{workflow.projectId}</div></div>
    <div className="edit-notice"><Sparkles size={17} /><div><strong>先看理由，再决定采用。</strong><p>不满意可以拒绝单个镜头；不完整的素材会显示为缺口，不会被假素材悄悄替代。</p></div><span className="edit-notice-tag">{provider?.providerKey === "apimart" ? `APIMart · ${provider.modelKey ?? "model"}` : "本地提案器"}</span></div>
    <div className="edit-toolbar"><div><div className="eyebrow">PROPOSAL</div><h2>{proposal ? "一份待审阅的 AI 剪辑提案" : "还没有生成提案"}</h2></div><div className="edit-toolbar-actions"><button className="secondary-button" onClick={requestProposal} disabled={busy}><RotateCcw size={15} /> {busy ? "分析中…" : proposal ? "重新分析" : "生成 AI 剪辑提案"}</button>{proposal && <button className="primary-button" onClick={renderProposal} disabled={busy}><Film size={15} /> {busy ? "导出中…" : "确认并导出"}</button>}</div></div>
    {message && <div className="creation-message error" role="alert"><CircleAlert size={16} />{message}</div>}
    {pendingRecovery && <div className="edit-recovery"><div><strong>Provider 提交状态未知</strong><p>先在 Provider 控制台核对是否产生费用；确认没有提交成功后，才能结束旧请求并重新发起。</p></div><button className="secondary-button" onClick={() => void reconcileUnknownProposal()} disabled={busy}>我已核对，结束并允许重试</button></div>}
    {renderRecovery && <div className="edit-recovery"><div><strong>上一次导出没有完成</strong><p>状态：{renderRecovery.job.state} · 第 {renderRecovery.job.attempt} 次尝试。重试只使用已经确认的 FrozenEditSpec，不会重新调用 AI 或自动换素材。</p>{renderRecovery.job.lastError && <small>{renderRecovery.job.lastError.code}：{renderRecovery.job.lastError.message}</small>}</div><button className="secondary-button" onClick={() => void retryFailedRender()} disabled={busy}>基于已冻结方案重试</button></div>}
    {missing.length > 0 && <section className="edit-missing"><div className="edit-section-heading"><div><div className="eyebrow">MISSING MATERIAL</div><h3>还缺这些镜头</h3></div><span>{missing.length} 个缺口</span></div>{missing.map((item) => <article className={`missing-row ${item.required === false ? "optional" : ""}`} key={`${item.shotId}-${item.taskId ?? "none"}`}><CircleAlert size={16} /><div><strong>{item.taskId ? `拍摄任务 ${item.taskId}` : `分镜 ${item.shotId}`} · {item.required === false ? "可选补充" : "必须补齐"}</strong><p>{item.instruction}</p></div></article>)}</section>}
    <AssetCandidateSection candidates={assetCandidates} openFile={openFile} adoptCandidate={adoptCandidate} />
    {proposal && <section className="proposal-list"><div className="edit-section-heading"><div><div className="eyebrow">SHOT PLAN</div><h3>镜头采用建议</h3></div><span>{proposal.operations.length} 个候选 · {seconds(proposal.durationMs)}</span></div>{proposal.operations.map((operation, index) => { const task = taskByShot.get(operation.shotId); return <article className={`proposal-row ${operation.status} ${operation.placement === "overlay" ? "overlay" : "primary"}`} key={operation.id}><div className="proposal-index">{String(index + 1).padStart(2, "0")}</div><div className="proposal-main"><div className="proposal-topline"><strong>{placementLabel(operation.placement)} · {roleLabel(operation.role)}</strong><span>{seconds(operation.timeline.endMs - operation.timeline.startMs)} · {operation.placement === "overlay" ? `覆盖 ${seconds(operation.timeline.startMs)}–${seconds(operation.timeline.endMs)}` : "连续主干"} · {operation.confidence >= 0.8 ? "高置信度" : "待确认"}</span></div><p>{operation.reason}</p>{task && <div className="proposal-intent">拍摄意图：{task.instruction} · {task.deviceHint} · {task.orientation} · 检查：{task.checklist.join("、")}</div>}<div className="proposal-evidence">证据：{operation.evidenceIds.map((evidenceId) => { const fact = evidenceById.get(evidenceId); return fact ? `${evidenceId}「${fact.text}」` : evidenceId; }).join(" · ")} · 源片段 {seconds(operation.sourceSegment.endMs - operation.sourceSegment.startMs)}</div></div><div className="proposal-actions"><button className="proposal-accept" onClick={() => setOperationStatus(operation.id, "accepted")} aria-label={`采用第 ${index + 1} 个镜头`} aria-pressed={operation.status === "accepted"}><Check size={14} />采用</button><button className="proposal-reject" onClick={() => setOperationStatus(operation.id, "rejected")} aria-label={`拒绝第 ${index + 1} 个镜头`} aria-pressed={operation.status === "rejected"}><X size={14} />拒绝</button></div></article>; })}</section>}
    {render?.ok && render.files && <section className="render-success" aria-live="polite"><div><div className="eyebrow">EXPORT READY</div><h3>这次 AI 剪辑已经落到本地</h3><p>{render.renderId} · MP4、SRT 和 manifest 都保存在工作区；已登记 {render.artifactIds?.length ?? 0} 个本地资产。</p></div><div className="render-links"><button className="secondary-button" onClick={() => openFile(render.files?.video)}><Download size={15} /> 打开视频</button>{render.files.subtitle && <button className="secondary-button" onClick={() => openFile(render.files?.subtitle)}><Download size={15} /> 打开字幕</button>}<button className="text-button" onClick={() => openFile(render.files?.manifest)}>查看 manifest <ChevronRight size={14} /></button></div>{render.renderRunId && <div className="exchange-links"><span>外部精修</span><button className="secondary-button" onClick={() => void exportExchange("fcpxml")} disabled={busy}><PackageOpen size={14} /> FCPXML</button><button className="secondary-button" onClick={() => void exportExchange("otio")} disabled={busy}><PackageOpen size={14} /> OTIO</button><button className="primary-button" onClick={() => void createPublishPackage()} disabled={busy}><PackageOpen size={14} /> 生成抖音发布包</button>{publishPackage?.ok && publishPackage.manifestRelativePath && <button className="text-button" onClick={() => openFile(publishPackage.manifestRelativePath)}>打开发布包 manifest <ChevronRight size={14} /></button>}{exchange?.ok && exchange.outputs && Object.values(exchange.outputs).map((output) => <button className="text-button" key={output.relativePath} onClick={() => openFile(output.relativePath)}>打开 {output.relativePath.split("/").pop()} <ChevronRight size={14} /></button>)}</div>}</section>}
  </section>;
}

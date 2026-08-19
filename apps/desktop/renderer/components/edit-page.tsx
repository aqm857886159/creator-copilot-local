import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canRender,
  candidateChipText,
  distinctAssetCount,
  evidenceLineText,
  gateCounts,
  gateSentence,
  headSummary,
  isKept,
  timecode,
  toGapView,
  toRowView,
  type EditOperationLike,
  type EvidenceFactLike,
} from "../lib/edit-page";

// 剪辑页 · 切片 3(粗剪审阅台)
// 视觉蓝本:docs/design/03-edit.html;类名一律 ep- 前缀,颜色只用 tokens.css 令牌
//(蓝本专有中性 hover/边框色逐字取蓝本值,先例 script-page.css)。
// 能力对账(从旧 ai-edit-workbench 迁移):生成/重新分析(propose-edit 幂等 + retryNonce)、
// 提交状态未知恢复(reconcile)、镜头行证据、逐行采用/不用、候选素材采用(adopt-asset-candidate)、
// 确认渲染(render-edit)、渲染恢复(list/retry-render)、导出交换格式(export-exchange)、
// 发布包(create-publish-package)、打开本地文件(open-workspace-file)、提案回读(latestEditProposal)。

type StageId = "script" | "storyboard" | "capture" | "editing";
type ProposalState = EditProposal | null;

interface LoadedEdit {
  projectId: string;
  title: string;
  tasks: CaptureShootTask[];
  materialCount: number; // 已导入素材条数(用于空态「分析你的 N 条素材」)
  stage: string;
  scriptDurationMs: number | null;
}

// 恢复列表条目类型(与 preload 返回对齐)。
type RenderRecoveryItem = NonNullable<RenderRecoveryListResult["items"]>[number];

// operation.status 收窄:域模型给的是 suggested/accepted/rejected;此处按其原样透传纯函数。
function asOperationLike(operation: EditProposalOperation): EditOperationLike {
  return {
    id: operation.id,
    shotId: operation.shotId,
    sourceAssetId: operation.sourceAssetId,
    sourceSegment: operation.sourceSegment,
    timeline: operation.timeline,
    role: operation.role,
    placement: operation.placement,
    reason: operation.reason,
    evidenceIds: operation.evidenceIds,
    confidence: operation.confidence,
    status: operation.status,
  };
}

export function EditPage({
  projectId,
  onBackToWorkbench,
  onOpenStage,
}: {
  projectId: string;
  onBackToWorkbench: () => void;
  onOpenStage: (stage: "script" | "storyboard" | "capture") => void;
}) {
  const [loaded, setLoaded] = useState<LoadedEdit | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [proposal, setProposal] = useState<ProposalState>(null);
  const [missing, setMissing] = useState<NonNullable<EditProposalResult["missing"]>>([]);
  const [analysisFacts, setAnalysisFacts] = useState<NonNullable<EditProposalResult["analysisFacts"]>>([]);
  const [assetCandidates, setAssetCandidates] = useState<NonNullable<EditProposalResult["assetCandidates"]>>([]);
  // sourceAssetId → 素材工作区相对路径:提案只带 assetId,试听要靠 takesByTask 解析出真实文件路径。
  const [assetPathById, setAssetPathById] = useState<Map<string, string>>(new Map());
  const [render, setRender] = useState<EditRenderResult | null>(null);
  const [exchangeNote, setExchangeNote] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [proposalRetryNonce, setProposalRetryNonce] = useState<string | undefined>(undefined);
  const [pendingRecovery, setPendingRecovery] = useState<{ idempotencyScope: string; idempotencyKey: string } | null>(null);
  const [renderRecovery, setRenderRecovery] = useState<RenderRecoveryItem | null>(null);

  const busyRef = useRef(false);
  busyRef.current = busy;

  // 挂载即回读:载项目 → 已存粗剪(latestEditProposal)+ 素材数 + 提交/渲染恢复。
  const reload = useCallback(async () => {
    if (!window.desktop) {
      setLoadError("桌面环境不可用");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const result = await window.desktop.loadProject({ projectId });
    if (!result.ok || !result.project) {
      setLoadError(result.message ?? "这条项目暂时打不开，稍后再试。");
      setLoading(false);
      return;
    }
    const tasks = result.tasks ?? [];
    const takeAssetIds = new Set<string>();
    const pathById = new Map<string, string>();
    for (const list of Object.values(result.takesByTask ?? {})) for (const take of list) {
      takeAssetIds.add(take.assetId);
      if (take.relativePath) pathById.set(take.assetId, take.relativePath);
    }
    setAssetPathById(pathById);
    setLoaded({ projectId: result.project.id, title: result.project.title, tasks, materialCount: takeAssetIds.size, stage: result.project.stage, scriptDurationMs: result.script?.estimatedDurationMs ?? null });
    // 已存粗剪回读:直接显示,不再出现「还没有生成提案」的假话。
    setProposal(result.latestEditProposal ?? null);
    // 出片条回水合:已有成功渲染的项目,重开直接见「已出片」,不再让用户再出一遍。
    setRender(result.latestRender ? { ok: true, renderRunId: result.latestRender.renderRunId, files: result.latestRender.files } : null);
    setLoading(false);

    // 恢复横幅:提交状态未知(reconcile)、上次渲染未完成(retry)。
    const [proposalRecovery, renderRecoveries] = await Promise.all([
      window.desktop.listEditProposalRecoveries(projectId),
      window.desktop.listRenderRecoveries(projectId),
    ]);
    const pending = proposalRecovery.items?.[0];
    if (pending) {
      setPendingRecovery({ idempotencyScope: pending.idempotencyScope, idempotencyKey: pending.idempotencyKey });
      setNotice({ ok: false, text: "上一次让 AI 出粗剪时，请求是否发出去了还不确定。确认没有在别处跑着同一个任务后，再结束旧请求重试。" });
    }
    setRenderRecovery(renderRecoveries.items?.[0] ?? null);
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 生成 / 重新分析:propose-edit(幂等;带 retryNonce 语义与旧页一致)。
  const requestProposal = useCallback(async () => {
    if (!window.desktop || busyRef.current) return;
    setBusy(true);
    setNotice(null);
    setRender(null);
    setExchangeNote(null);
    setAssetCandidates([]);
    try {
      const result = await window.desktop.proposeEdit({ projectId, retryNonce: proposalRetryNonce });
      setAssetCandidates(result.assetCandidates ?? []);
      if (!result.ok) {
        if (result.status === "pending" && result.idempotencyScope && result.idempotencyKey) setPendingRecovery({ idempotencyScope: result.idempotencyScope, idempotencyKey: result.idempotencyKey });
        setNotice({ ok: false, text: result.status === "pending" ? "上一次请求是否发出去了还不确定，已停下自动重试。确认没有重复跑之后再重试。" : result.message ?? "粗剪没生成成功，稍后再试。" });
        return;
      }
      setPendingRecovery(null);
      setProposalRetryNonce(undefined);
      setProposal(result.proposal ?? null);
      setMissing(result.missing ?? []);
      setAnalysisFacts(result.analysisFacts ?? []);
      if (result.status === "needs_material") setNotice({ ok: false, text: "还有镜头没选定素材，先回拍摄把素材补齐再出粗剪。" });
    } finally {
      setBusy(false);
    }
  }, [projectId, proposalRetryNonce]);

  // 提交状态未知恢复:用户确认未扣费后,结束旧请求并拿到新 retryNonce。
  const reconcileUnknown = useCallback(async () => {
    if (!window.desktop || !pendingRecovery || busyRef.current) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await window.desktop.reconcileEditProposal({ ...pendingRecovery, action: "user_confirmed_not_submitted" });
      if (!response.ok || !response.retryNonce) {
        setNotice({ ok: false, text: response.message ?? "结束旧请求没成功，稍后再试。" });
        return;
      }
      setPendingRecovery(null);
      setProposalRetryNonce(response.retryNonce);
      setNotice({ ok: true, text: "已结束那次不确定的请求。点「重新分析」会用新的请求重来 —— 只有你确认没扣费才该这么做。" });
    } finally {
      setBusy(false);
    }
  }, [pendingRecovery]);

  function setOperationStatus(operationId: string, status: EditProposalOperation["status"]) {
    setProposal((current) => (current ? { ...current, operations: current.operations.map((operation) => (operation.id === operationId ? { ...operation, status } : operation)) } : current));
  }

  // 确认出片:render-edit。非 rejected 一律 accepted(默认全采用),至少留一个镜头。
  const confirmRender = useCallback(async () => {
    const current = proposal;
    if (!window.desktop || !current || busyRef.current) return;
    const operationLikes = current.operations.map(asOperationLike);
    if (!canRender(operationLikes)) {
      setNotice({ ok: false, text: "至少留一个镜头才能出片。" });
      return;
    }
    const adopted: EditProposal = { ...current, status: "adopted", operations: current.operations.map((operation) => (operation.status === "rejected" ? operation : { ...operation, status: "accepted" as const })) };
    setBusy(true);
    setNotice(null);
    setExchangeNote(null);
    try {
      const result = await window.desktop.renderEdit({ projectId, proposal: adopted });
      setRender(result);
      if (!result.ok) {
        setNotice({ ok: false, text: result.message ?? "这一版没出成功，稍后再试。" });
        const recoveries = await window.desktop.listRenderRecoveries(projectId);
        setRenderRecovery(recoveries.items?.[0] ?? null);
      } else {
        setRenderRecovery(null);
      }
    } finally {
      setBusy(false);
    }
  }, [proposal, projectId]);

  // 渲染恢复:基于已冻结方案重试(不重新调用 AI 或换素材)。
  const retryFailedRender = useCallback(async () => {
    if (!window.desktop || !renderRecovery || busyRef.current) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await window.desktop.retryRender({ projectId, renderRunId: renderRecovery.renderRun.id });
      setRender(result);
      if (result.ok) {
        setRenderRecovery(null);
        setNotice({ ok: true, text: "已按上次确认的方案重出，没有重新分析或换素材。" });
      } else {
        setNotice({ ok: false, text: result.message ?? "重出没成功，稍后再试。" });
        const recoveries = await window.desktop.listRenderRecoveries(projectId);
        setRenderRecovery(recoveries.items?.[0] ?? null);
      }
    } finally {
      setBusy(false);
    }
  }, [renderRecovery, projectId]);

  async function openFile(relativePath: string | null | undefined) {
    if (relativePath && window.desktop) await window.desktop.openWorkspaceFile(relativePath);
  }

  // 导出到剪映:export-exchange(保留旧页 FCPXML/OTIO 语义;剪映吃 FCPXML)。
  const exportToJianying = useCallback(async () => {
    if (!window.desktop || !render?.renderRunId || busyRef.current) return;
    setBusy(true);
    setNotice(null);
    setExchangeNote(null);
    try {
      const result = await window.desktop.exportExchange({ renderRunId: render.renderRunId, formats: ["fcpxml"] });
      if (!result.ok) {
        setNotice({ ok: false, text: result.message ?? "导出没成功，稍后再试。" });
        return;
      }
      const output = result.outputs?.fcpxml;
      setExchangeNote(output ? output.relativePath : "已导出，可在工作区 exports 目录找到。");
      if (output) await openFile(output.relativePath);
    } finally {
      setBusy(false);
    }
  }, [render?.renderRunId]);

  // 去发布:create-publish-package。标题走一次轻确认(沿用旧页 prompt 语义)。
  const goPublish = useCallback(async () => {
    if (!window.desktop || !render?.renderRunId || busyRef.current) return;
    const title = window.prompt("给这条视频起个发布标题", loaded?.title ?? "把观点讲清楚")?.trim();
    if (!title) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await window.desktop.createPublishPackage({ renderRunId: render.renderRunId, platform: "抖音", title });
      if (!result.ok) {
        setNotice({ ok: false, text: result.message ?? "发布包没生成成功，稍后再试。" });
        return;
      }
      setNotice({ ok: true, text: "发布包已备好，可在工作区里找到，去抖音发布时用它。" });
      if (result.manifestRelativePath) await openFile(result.manifestRelativePath);
    } finally {
      setBusy(false);
    }
  }, [render?.renderRunId, loaded?.title]);

  // 候选素材采用:adopt-asset-candidate(把候选写成对应拍摄任务的当前素材)。
  const adoptCandidate = useCallback(async (shotId: string, candidate: NonNullable<EditProposalResult["assetCandidates"]>[number]["candidates"][number]) => {
    if (!window.desktop || busyRef.current) return;
    const task = (loaded?.tasks ?? []).find((item) => item.shotId === shotId);
    if (!task) {
      setNotice({ ok: false, text: "这条候选没有对应的拍摄任务，暂时用不了。" });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await window.desktop.adoptAssetCandidate({ shootTaskId: task.id, assetId: candidate.assetId, sourceSegment: candidate.sourceSegment, reason: candidate.reason, evidenceIds: candidate.evidenceIds });
      if (!result.ok) {
        setNotice({ ok: false, text: result.message ?? "这条候选没用上，稍后再试。" });
        return;
      }
      setNotice({ ok: true, text: `已把这条素材接到「${task.title}」上，重新分析就能用它。` });
    } finally {
      setBusy(false);
    }
  }, [loaded?.tasks]);

  // ---- 派生视图 ----
  const evidenceById = useMemo(() => new Map<string, EvidenceFactLike>(analysisFacts.map((fact) => [fact.id, { id: fact.id, startMs: fact.startMs, endMs: fact.endMs, text: fact.text }])), [analysisFacts]);
  const operations = proposal?.operations ?? [];
  const operationLikes = useMemo(() => operations.map(asOperationLike), [operations]);
  // 素材显示名:take 的 relativePath 取 basename;查不到名字时 toRowView 内部退化为截短 ID。
  const assetNameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const [assetId, relativePath] of assetPathById) {
      const base = relativePath.split("/").pop();
      if (base) names.set(assetId, base);
    }
    return names;
  }, [assetPathById]);
  const rows = useMemo(() => operationLikes.map((operation, index) => toRowView(operation, index, evidenceById, assetNameById)), [operationLikes, evidenceById, assetNameById]);
  const counts = useMemo(() => gateCounts(operationLikes, missing.length), [operationLikes, missing.length]);
  const assetCount = useMemo(() => distinctAssetCount(operationLikes), [operationLikes]);
  const candidatesByShot = useMemo(() => new Map((assetCandidates ?? []).filter((set) => set.candidates.length > 0).map((set) => [set.shotId, set.candidates])), [assetCandidates]);
  const rendered = Boolean(render?.ok && render.files);

  const stages: Array<{ id: StageId; label: string; current?: boolean; handoff?: boolean; title?: string }> = [
    { id: "script", label: "脚本" },
    { id: "storyboard", label: "分镜" },
    { id: "capture", label: "拍摄", handoff: true, title: "拍摄不是页面：手机扫码逐镜拍，这里看回流进度" },
    { id: "editing", label: "剪辑", current: true },
  ];

  function onStageClick(stage: StageId) {
    if (stage === "editing") return;
    if (stage === "script") onOpenStage("script");
    else if (stage === "storyboard") onOpenStage("storyboard");
    else if (stage === "capture") onOpenStage("capture");
  }

  return (
    <div className="ep-root">
      <header className="ep-top">
        <button className="ep-back" onClick={onBackToWorkbench}>← 工作台</button>
        <span className="ep-ttl" title={loaded?.title}>{loaded?.title || "剪辑"}</span>
        <nav className="ep-stages" aria-label="阶段">
          {stages.map((stage) => (
            <button
              key={stage.id}
              className={stage.handoff ? "ep-handoff" : undefined}
              aria-current={stage.current ? "page" : undefined}
              title={stage.title}
              onClick={() => onStageClick(stage.id)}
            >
              {stage.label}
            </button>
          ))}
        </nav>
        <div className="ep-top-r"><span>在本机分析，不联网</span></div>
      </header>

      <main className="ep-page">
        {loading ? (
          <p className="ep-loading">正在读取粗剪…</p>
        ) : loadError ? (
          <div className="ep-error" role="alert">{loadError}</div>
        ) : (
          <>
            {notice ? (
              <div className={notice.ok ? "ep-flash ep-flash-ok" : "ep-flash ep-flash-bad"} role={notice.ok ? "status" : "alert"}>
                {notice.text}
              </div>
            ) : null}

            {pendingRecovery ? (
              <div className="ep-recovery" role="alert">
                <div>
                  <strong>上一次的请求状态不确定</strong>
                  <p>确认没有在别处跑着同一个任务、也没有扣费后，再结束旧请求重试。</p>
                </div>
                <button className="ep-recovery-btn" onClick={() => void reconcileUnknown()} disabled={busy}>我已确认，结束旧请求</button>
              </div>
            ) : null}

            {renderRecovery ? (
              <div className="ep-recovery" role="alert">
                <div>
                  <strong>上一版没出完</strong>
                  <p>重出只用上次确认好的方案，不会重新分析或换素材。</p>
                  {renderRecovery.job.lastError ? <small>{renderRecovery.job.lastError.message}</small> : null}
                </div>
                <button className="ep-recovery-btn" onClick={() => void retryFailedRender()} disabled={busy}>按原方案重出</button>
              </div>
            ) : null}

            {proposal ? (
              <>
                <div className="ep-head">
                  <h1>粗剪</h1>
                  <span className="ep-sum ep-num">{headSummary(operationLikes, proposal.durationMs, assetCount, loaded?.scriptDurationMs ?? undefined)}</span>
                  <button className="ep-re" onClick={() => void requestProposal()} disabled={busy} title="会重新选一遍镜头，替换这版粗剪">
                    {busy ? "分析中…" : "重新分析"}
                  </button>
                </div>

                <section className="ep-cut" aria-label="粗剪镜头，逐条可采用或不用">
                  {rows.map((row) => {
                    const evidence = row.evidence;
                    const evidencePath = assetPathById.get(evidence.assetId);
                    return (
                      <div className={row.dropped ? "ep-row ep-dropped" : "ep-row"} key={row.id}>
                        <span className="ep-idx ep-num">{row.index}</span>
                        <span className="ep-tc ep-num">{row.timelineRange}</span>
                        <span className="ep-what">
                          <b>{row.placementLabel}{row.needsConfirm ? <em className="ep-flag">待确认</em> : null}</b>
                          <p>{row.reason}</p>
                          {evidencePath ? (
                            <button className="ep-ev ep-num" onClick={() => void openFile(evidencePath)} title="点一下试听这段">
                              {evidenceLineText(evidence)}
                            </button>
                          ) : (
                            <span className="ep-ev ep-ev-static ep-num">{evidenceLineText(evidence)}</span>
                          )}
                        </span>
                        <span className="ep-acts">
                          <button className="ep-keep" aria-pressed={!row.dropped} onClick={() => setOperationStatus(row.id, "accepted")}>采用</button>
                          <button className="ep-drop" aria-pressed={row.dropped} onClick={() => setOperationStatus(row.id, row.dropped ? "accepted" : "rejected")}>不用</button>
                        </span>
                      </div>
                    );
                  })}

                  {missing.map((item) => {
                    const gap = toGapView(item);
                    const candidates = candidatesByShot.get(item.shotId) ?? [];
                    return (
                      <div className="ep-row ep-gap" key={gap.key}>
                        <span className="ep-idx ep-num">·</span>
                        <span className="ep-tc ep-num">该配画面<i>{gap.required ? "缺口" : "可选"}</i></span>
                        <span className="ep-what">
                          <b>这句没拍到画面</b>
                          <p>{item.instruction}</p>
                          <span className="ep-fix">
                            <button className="ep-chip" aria-pressed={true} title="粗剪先跳过这个缺口，用口播讲过去">先用口播带过</button>
                          </span>
                          {candidates.length > 0 ? (
                            <span className="ep-cand">
                              接近的素材：
                              {candidates.map((candidate) => (
                                <span className="ep-cand-item" key={`${item.shotId}-${candidate.assetId}`}>
                                  <button className="ep-num" onClick={() => void openFile(candidate.relativePath)} title="点一下预览这条">{candidateChipText(candidate)}</button>
                                  <button className="ep-use" onClick={() => void adoptCandidate(item.shotId, candidate)} disabled={busy}>用这条</button>
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </span>
                        <span className="ep-acts" />
                      </div>
                    );
                  })}
                </section>

                {rendered ? (
                  <div className="ep-done">
                    <b>这一版粗剪已经出片</b>
                    <span className="ep-num">{render?.files?.video ? render.files.video : "已保存到本机"}</span>
                    <span className="ep-ops">
                      <button className="ep-op-main" onClick={() => void openFile(render?.files?.video)}>打开成片</button>
                      <button className="ep-op" onClick={() => void exportToJianying()} disabled={busy}>导出到剪映</button>
                      <button className="ep-op" onClick={() => void goPublish()} disabled={busy}>去发布</button>
                    </span>
                    {exchangeNote ? <small className="ep-done-note ep-num">{exchangeNote}</small> : null}
                  </div>
                ) : (
                  <div className="ep-gate">
                    <div className="ep-gate-text">
                      <p>{gateSentence(counts)}</p>
                    </div>
                    <button className="ep-cta" onClick={() => void confirmRender()} disabled={busy}>{busy ? "出片中…" : "确认，出这一版粗剪"}</button>
                  </div>
                )}
              </>
            ) : (
              <div className="ep-empty">
                <button className="ep-cta" onClick={() => void requestProposal()} disabled={busy}>{busy ? "分析中…" : "让 AI 出一版粗剪"}</button>
                <p>{loaded && loaded.materialCount > 0 ? `在本机分析你的 ${loaded.materialCount} 条素材和台词，不联网、不花钱，大约一分钟。` : "在本机分析你的素材和台词，不联网、不花钱，大约一分钟。"}</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

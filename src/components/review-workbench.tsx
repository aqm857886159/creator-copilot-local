import { useEffect, useState } from "react";
import { BarChart3, Check, CircleAlert, RefreshCw, Sparkles } from "lucide-react";

export function ReviewWorkbench({ workspaceReady }: { workspaceReady: boolean }) {
  const [data, setData] = useState<PublicationListResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const [metrics, setMetrics] = useState({ views: "", likes: "", comments: "", shares: "", saves: "", completionRate: "" });

  async function refresh() {
    if (!window.desktop || !workspaceReady) return;
    setBusy(true); setMessage(null);
    try {
      const result = await window.desktop.listPublications();
      setData(result);
      if (!selectedId && result.publications?.[0]) setSelectedId(result.publications[0].publication.id);
      if (!result.ok) setMessage(result.message ?? "读取发布记录失败");
    } finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [workspaceReady]);
  function numeric(value: string) { if (!value.trim()) return null; const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
  async function recordMetrics() {
    if (!selectedId || !window.desktop || busy) return;
    setBusy(true); setMessage(null);
    try {
      const completion = numeric(metrics.completionRate);
      const result = await window.desktop.recordMetrics({ publicationId: selectedId, window: "24h", metrics: { views: numeric(metrics.views), likes: numeric(metrics.likes), comments: numeric(metrics.comments), shares: numeric(metrics.shares), saves: numeric(metrics.saves), completionRate: completion === null ? null : completion / 100 }, notes: "创作者手动录入" });
      if (!result.ok) setMessage(result.message ?? "指标录入失败"); else await refresh();
    } finally { setBusy(false); }
  }
  async function proposeMemory() {
    if (!selectedId || !statement.trim() || !window.desktop || busy) return;
    setBusy(true); setMessage(null);
    try { const result = await window.desktop.proposeReviewMemory({ publicationId: selectedId, statement: statement.trim() }); if (!result.ok) setMessage(result.message ?? "复盘建议生成失败"); else { setStatement(""); await refresh(); } } finally { setBusy(false); }
  }
  async function confirmMemory(proposalId: string) {
    if (!window.desktop || busy) return;
    setBusy(true); setMessage(null);
    try { const result = await window.desktop.confirmReviewMemory(proposalId); if (!result.ok) setMessage(result.message ?? "确认复盘记忆失败"); else await refresh(); } finally { setBusy(false); }
  }
  if (!workspaceReady) return <section className="empty-view"><div className="empty-icon"><BarChart3 size={24} /></div><div className="eyebrow">PUBLISH · REVIEW</div><h1>先选择本地工作区</h1><p>发布包、指标和创作记忆都只保存在你选择的本地工作区。</p></section>;
  const selected = data?.publications?.find((item) => item.publication.id === selectedId);
  return <section className="review-workbench"><div className="creation-heading"><div><div className="eyebrow">PUBLISH · REVIEW</div><h1>把发布后的结果带回下一条内容。</h1><p>先手动录入一个窗口的真实数据，再让系统提出可审阅的创作记忆。它不会自动替你下结论。</p></div><button className="secondary-button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} /> 刷新记录</button></div>
    {message && <div className="creation-message error" role="alert"><CircleAlert size={16} />{message}</div>}
    {!data?.publications?.length ? <section className="review-empty"><Sparkles size={20} /><h3>还没有本地发布记录</h3><p>在 AI 剪辑导出成功后生成一个发布包，它会出现在这里。</p></section> : <div className="review-grid"><section className="review-publications"><div className="edit-section-heading"><div><div className="eyebrow">PUBLICATIONS</div><h3>发布记录</h3></div><span>{data.publications.length} 条</span></div>{data.publications.map(({ publication, snapshots }) => <button className={`review-publication ${publication.id === selectedId ? "selected" : ""}`} key={publication.id} onClick={() => setSelectedId(publication.id)}><div><strong>{publication.platform} · {publication.packageId}</strong><small>{publication.status} · {snapshots.length} 个数据窗口</small></div><span>{snapshots.at(-1)?.metrics.views?.toLocaleString() ?? "—"} 播放</span></button>)}</section><section className="review-detail">{selected && <><div className="edit-section-heading"><div><div className="eyebrow">METRIC SNAPSHOT · 24H</div><h3>录入结果</h3></div><span>{selected.publication.platform}</span></div><div className="metric-form">{(["views", "likes", "comments", "shares", "saves", "completionRate"] as const).map((key) => <label key={key}>{({ views: "播放", likes: "点赞", comments: "评论", shares: "分享", saves: "收藏", completionRate: "完播率 %" }[key])}<input inputMode="decimal" value={metrics[key]} onChange={(event) => setMetrics((current) => ({ ...current, [key]: event.target.value }))} placeholder="—" /></label>)}</div><button className="primary-button" onClick={() => void recordMetrics()} disabled={busy}><BarChart3 size={15} /> 保存 24 小时数据</button><div className="review-memory-form"><div className="eyebrow">MEMORY PROPOSAL</div><h3>这条内容带来了什么经验？</h3><textarea value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="例如：先讲具体经历再给结论，完播表现值得继续验证。" /><button className="secondary-button" onClick={() => void proposeMemory()} disabled={busy || !statement.trim()}><Sparkles size={15} /> 基于已有指标生成建议</button></div></>}</section></div>}
    {data?.proposals?.length ? <section className="review-proposals"><div className="edit-section-heading"><div><div className="eyebrow">CREATOR MEMORY</div><h3>待确认的创作记忆</h3></div><span>{data.proposals.filter((proposal) => proposal.status === "candidate").length} 待处理</span></div>{data.proposals.map((proposal) => <article className="review-proposal" key={proposal.id}><div><p>{proposal.statement}</p><small>证据：{proposal.evidenceSnapshotIds.join(" · ")} · 置信度 {Math.round(proposal.confidence * 100)}%</small></div>{proposal.status === "candidate" ? <button className="primary-button" onClick={() => void confirmMemory(proposal.id)} disabled={busy}><Check size={14} /> 确认沉淀</button> : <span className="review-confirmed">{proposal.status === "confirmed" ? "已确认" : proposal.status}</span>}</article>)}</section> : null}
  </section>;
}

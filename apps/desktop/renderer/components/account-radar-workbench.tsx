import { useState } from "react";
import { BarChart3, Check, CircleAlert, Download, ExternalLink, Search, ShieldCheck } from "lucide-react";

function duration(milliseconds?: number) {
  if (!milliseconds) return "时长未知";
  return `${(milliseconds / 1000).toFixed(1).replace(/\.0$/, "")} 秒`;
}

function metricLabel(statistics: Record<string, number>) {
  const plays = statistics.play_count ?? statistics.playCount;
  const likes = statistics.digg_count ?? statistics.like_count ?? statistics.likes;
  if (plays === undefined && likes === undefined) return "平台未返回播放/点赞统计";
  return `${plays === undefined ? "播放未知" : `${plays.toLocaleString()} 播放`} · ${likes === undefined ? "点赞未知" : `${likes.toLocaleString()} 赞`}`;
}

function statusLabel(status: string, artifactIds: string[]) {
  if (artifactIds.length > 0 && status === "queued") return "已入素材库 · 待拆解";
  if (status === "partial") return "部分完成 · ASR/OCR 待配置";
  if (status === "failed") return "本地化失败 · 可重试";
  if (status === "metadata_only") return "待选中本地化";
  return status;
}

function evidenceSummary(payload: Record<string, unknown>) {
  const summary = typeof payload.summary === "string" ? payload.summary : undefined;
  if (summary) return summary;
  const analyzedVideoCount = typeof payload.analyzedVideoCount === "number" ? payload.analyzedVideoCount : undefined;
  const totalShotCount = typeof payload.totalShotCount === "number" ? payload.totalShotCount : undefined;
  const transcriptSegmentCount = typeof payload.transcriptSegmentCount === "number" ? payload.transcriptSegmentCount : undefined;
  const ocrCueCount = typeof payload.ocrCueCount === "number" ? payload.ocrCueCount : undefined;
  if (analyzedVideoCount !== undefined || totalShotCount !== undefined) return `${analyzedVideoCount ?? 0} 条作品 · ${totalShotCount ?? 0} 个镜头 · ${transcriptSegmentCount ?? 0} 段 ASR · ${ocrCueCount ?? 0} 条 OCR`;
  const requested = typeof payload.requested === "number" ? payload.requested : undefined;
  const received = typeof payload.received === "number" ? payload.received : undefined;
  if (requested !== undefined || received !== undefined) return `请求 ${requested ?? "—"} 条，取得 ${received ?? "—"} 条`;
  return "已保存来源快照，可在本地报告中继续追溯。";
}

export function AccountRadarWorkbench({ workspaceReady }: { workspaceReady: boolean }) {
  const [sourceInput, setSourceInput] = useState("");
  const [count, setCount] = useState(20);
  const [result, setResult] = useState<AccountResearchResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function research() {
    if (!window.desktop || !workspaceReady || loading || !sourceInput.trim()) return;
    setLoading(true);
    setActionMessage(null);
    setSelectedIds([]);
    try {
      setResult(await window.desktop.researchAccount({ sourceInput: sourceInput.trim(), count }));
    } finally {
      setLoading(false);
    }
  }

  function toggleSelection(awemeId: string) {
    setActionMessage(null);
    setSelectedIds((current) => current.includes(awemeId) ? current.filter((id) => id !== awemeId) : current.length >= 5 ? current : [...current, awemeId]);
  }

  async function downloadSelected() {
    if (!window.desktop || !report || selectedIds.length < 1 || selectedIds.length > 5 || downloading) return;
    setDownloading(true);
    setActionMessage(null);
    try {
      const response = await window.desktop.downloadResearchMedia({ reportId: report.id, awemeIds: selectedIds });
      if (response.report) setResult({ ok: response.ok, report: response.report, message: response.message, errorCode: response.errorCode });
      const successCount = response.downloaded?.length ?? 0;
      const failureCount = response.failed?.length ?? 0;
      if (successCount > 0) {
        const analysis = await window.desktop.analyzeResearchMedia({ reportId: report.id, awemeIds: selectedIds });
        if (analysis.report) setResult({ ok: analysis.ok, report: analysis.report, message: analysis.message, errorCode: analysis.errorCode });
        const analysisFailures = analysis.failed?.length ?? 0;
        setActionMessage(analysisFailures > 0 ? `已本地化 ${successCount} 条；本地分析有 ${analysisFailures} 条失败，可稍后重试。` : `已本地化并完成镜头事实分析 ${successCount} 条；ASR/OCR 按配置补齐。`);
      } else {
        setActionMessage(failureCount > 0 ? `本地化失败 ${failureCount} 条，可稍后重试。` : "没有作品需要本地化。");
      }
      setSelectedIds([]);
    } finally {
      setDownloading(false);
    }
  }

  if (!workspaceReady) return <section className="radar-workbench empty-edit-workbench"><div className="empty-icon"><BarChart3 size={24} /></div><div className="eyebrow">ACCOUNT RADAR</div><h1>先连接一个工作区</h1><p>账号快照、作品元数据和证据包会保存在本地，不会把临时 Provider URL 当成素材。</p></section>;

  const report = result?.report;
  const selectedCount = selectedIds.length;
  return <section className="radar-workbench">
    <div className="creation-heading"><div><div className="eyebrow">ACCOUNT RADAR · EVIDENCE FIRST</div><h1>先看对标账号的事实。</h1><p>首轮只拉公开账号资料和最多 20 条作品元数据；只有你选中的作品才进入下载、ASR、OCR 和镜头分析。</p></div><div className="workspace-state ready"><span />metadata-first</div></div>
    <div className="radar-query"><div className="radar-query-input"><Search size={17} /><input aria-label="抖音主页链接或 sec_user_id" value={sourceInput} onChange={(event) => setSourceInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void research(); }} placeholder="粘贴抖音主页链接或 sec_user_id" /></div><label><span>首轮作品</span><select value={count} onChange={(event) => setCount(Number(event.target.value))}><option value={10}>10 条</option><option value={20}>20 条</option></select></label><button className="primary-button" onClick={research} disabled={loading || !sourceInput.trim()}>{loading ? "分析中…" : "开始分析"}</button></div>
    <div className="radar-safety"><ShieldCheck size={15} /><span>公开元数据 · 本轮最多 {count} 条 · 不自动下载视频</span></div>
    {result?.ok === false && <div className="creation-message error" role="alert"><CircleAlert size={16} />{result.message ?? "账号分析失败"}</div>}
    {actionMessage && <div className="radar-action-message" role="status"><Check size={15} />{actionMessage}</div>}
    {report && <><section className="radar-profile"><div className="radar-profile-main"><div className="eyebrow">PROFILE SNAPSHOT</div><h2>{report.profile.nickname ?? report.secUserId}</h2><p>{report.profile.signature || "账号没有返回简介"}</p></div><div className="radar-profile-stats"><span><strong>{report.profile.followerCount?.toLocaleString() ?? "—"}</strong> 粉丝</span><span><strong>{report.profile.awemeCount?.toLocaleString() ?? "—"}</strong> 作品</span></div></section><section className="radar-coverage"><div><div className="eyebrow">COVERAGE</div><h3>首轮证据覆盖</h3></div><div className="coverage-numbers"><span><strong>{report.coverage.received}</strong> / {report.coverage.requested} 元数据</span><span><strong>{report.coverage.received - report.coverage.missingMedia}</strong> 条已本地化</span><span>{report.coverage.hasMore ? "还有下一页" : "已到末页"}</span></div><p>{report.coverage.note}</p></section><section className="radar-video-section"><div className="edit-section-heading"><div><div className="eyebrow">LATEST WORKS</div><h3>最新作品</h3></div><span>选择 1–5 条后再下载</span></div><div className="radar-selection-toolbar"><span>已选择 {selectedCount} / 5</span><button className="primary-button" onClick={() => void downloadSelected()} disabled={downloading || selectedCount < 1}>{downloading ? "本地化与分析中…" : <><Download size={14} />本地化并分析选中作品</>}</button></div><div className="radar-video-grid">{report.videos.map((video) => { const selected = selectedIds.includes(video.awemeId); const localised = video.artifactIds.length > 0; const analyzed = video.mediaAnalysisStatus === "completed"; return <article className={`radar-video-card ${selected ? "selected" : ""}`} key={video.awemeId}><button className="radar-video-select" onClick={() => toggleSelection(video.awemeId)} aria-pressed={selected} disabled={downloading || analyzed}>{selected ? <Check size={14} /> : null}<span>{analyzed ? "已完成" : localised ? "重试分析" : selected ? "已选择" : "选择拆解"}</span></button><div className="radar-video-top"><span>{duration(video.durationMs)}</span><span>{statusLabel(video.mediaAnalysisStatus, video.artifactIds)}</span></div><h4>{video.description || "无文案"}</h4><p>{metricLabel(video.statistics)}</p>{video.analysisFactIds.length > 0 && <p className="radar-video-facts">已回挂 {video.analysisFactIds.length} 条时间码事实</p>}<div className="radar-video-footer"><span>{video.awemeId}</span>{video.shareUrl && <button className="text-button" onClick={() => window.desktop?.openExternal(video.shareUrl!)}><ExternalLink size={13} /> 来源</button>}</div></article>; })}</div></section><section className="radar-findings"><div className="edit-section-heading"><div><div className="eyebrow">FINDINGS · EVIDENCE</div><h3>结论必须能追溯</h3></div><span>{report.findings.length} 条结论</span></div>{report.findings.map((finding) => <article className="radar-finding" key={finding.id}><div className="eyebrow">{finding.kind}</div><h3>{finding.title}</h3><p>{finding.detail}</p><div className="radar-evidence-list">{finding.evidenceIds.map((evidenceId) => { const evidence = report.evidence.find((item) => item.id === evidenceId); return <div className="radar-evidence" key={evidenceId}><strong>{evidence?.label ?? evidenceId}</strong><span>{evidence ? evidenceSummary(evidence.payload) : "来源证据不可用"}</span></div>; })}</div></article>)}</section></>}
  </section>;
}

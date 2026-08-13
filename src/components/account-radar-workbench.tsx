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
  if (status === "failed") return "本地化失败 · 可重试";
  if (status === "metadata_only") return "待选中本地化";
  return status;
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
      setActionMessage(failureCount > 0 ? `已本地化 ${successCount} 条，${failureCount} 条失败，可稍后重试。` : `已将 ${successCount} 条作品写入素材库，等待本地拆解。`);
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
    {report && <><section className="radar-profile"><div className="radar-profile-main"><div className="eyebrow">PROFILE SNAPSHOT</div><h2>{report.profile.nickname ?? report.secUserId}</h2><p>{report.profile.signature || "账号没有返回简介"}</p></div><div className="radar-profile-stats"><span><strong>{report.profile.followerCount?.toLocaleString() ?? "—"}</strong> 粉丝</span><span><strong>{report.profile.awemeCount?.toLocaleString() ?? "—"}</strong> 作品</span></div></section><section className="radar-coverage"><div><div className="eyebrow">COVERAGE</div><h3>首轮证据覆盖</h3></div><div className="coverage-numbers"><span><strong>{report.coverage.received}</strong> / {report.coverage.requested} 元数据</span><span><strong>{report.coverage.received - report.coverage.missingMedia}</strong> 条已本地化</span><span>{report.coverage.hasMore ? "还有下一页" : "已到末页"}</span></div><p>{report.coverage.note}</p></section><section className="radar-video-section"><div className="edit-section-heading"><div><div className="eyebrow">LATEST WORKS</div><h3>最新作品</h3></div><span>选择 1–5 条后再下载</span></div><div className="radar-selection-toolbar"><span>已选择 {selectedCount} / 5</span><button className="primary-button" onClick={() => void downloadSelected()} disabled={downloading || selectedCount < 1}>{downloading ? "本地化中…" : <><Download size={14} />下载并拆解选中作品</>}</button></div><div className="radar-video-grid">{report.videos.map((video) => { const selected = selectedIds.includes(video.awemeId); const localised = video.artifactIds.length > 0; return <article className={`radar-video-card ${selected ? "selected" : ""}`} key={video.awemeId}><button className="radar-video-select" onClick={() => toggleSelection(video.awemeId)} aria-pressed={selected} disabled={downloading || localised}>{selected ? <Check size={14} /> : null}<span>{localised ? "已入库" : selected ? "已选择" : "选择拆解"}</span></button><div className="radar-video-top"><span>{duration(video.durationMs)}</span><span>{statusLabel(video.mediaAnalysisStatus, video.artifactIds)}</span></div><h4>{video.description || "无文案"}</h4><p>{metricLabel(video.statistics)}</p><div className="radar-video-footer"><span>{video.awemeId}</span>{video.shareUrl && <button className="text-button" onClick={() => window.desktop?.openExternal(video.shareUrl!)}><ExternalLink size={13} /> 来源</button>}</div></article>; })}</div></section><section className="radar-finding"><div className="eyebrow">NEXT ACTION</div><h3>{report.findings[0]?.title ?? "选择作品做进一步分析"}</h3><p>{report.findings[0]?.detail ?? "从最新作品中选 3–5 条，再执行本地媒体事实分析。"}</p></section></>}
  </section>;
}

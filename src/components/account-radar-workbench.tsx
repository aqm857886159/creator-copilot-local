import { useState } from "react";
import { BarChart3, CircleAlert, ExternalLink, Search, ShieldCheck } from "lucide-react";

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

export function AccountRadarWorkbench({ workspaceReady }: { workspaceReady: boolean }) {
  const [sourceInput, setSourceInput] = useState("");
  const [count, setCount] = useState(20);
  const [result, setResult] = useState<AccountResearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function research() {
    if (!window.desktop || !workspaceReady || loading || !sourceInput.trim()) return;
    setLoading(true);
    try {
      setResult(await window.desktop.researchAccount({ sourceInput: sourceInput.trim(), count }));
    } finally {
      setLoading(false);
    }
  }

  if (!workspaceReady) return <section className="radar-workbench empty-edit-workbench"><div className="empty-icon"><BarChart3 size={24} /></div><div className="eyebrow">ACCOUNT RADAR</div><h1>先连接一个工作区</h1><p>账号快照、作品元数据和证据包会保存在本地，不会把临时 Provider URL 当成素材。</p></section>;

  const report = result?.report;
  return <section className="radar-workbench">
    <div className="creation-heading"><div><div className="eyebrow">ACCOUNT RADAR · EVIDENCE FIRST</div><h1>先看对标账号的事实。</h1><p>首轮只拉公开账号资料和最多 20 条作品元数据；只有你选中的作品才进入下载、ASR、OCR 和镜头分析。</p></div><div className="workspace-state ready"><span />metadata-first</div></div>
    <div className="radar-query"><div className="radar-query-input"><Search size={17} /><input aria-label="抖音主页链接或 sec_user_id" value={sourceInput} onChange={(event) => setSourceInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void research(); }} placeholder="粘贴抖音主页链接或 sec_user_id" /></div><label><span>首轮作品</span><select value={count} onChange={(event) => setCount(Number(event.target.value))}><option value={10}>10 条</option><option value={20}>20 条</option></select></label><button className="primary-button" onClick={research} disabled={loading || !sourceInput.trim()}>{loading ? "分析中…" : "开始分析"}</button></div>
    <div className="radar-safety"><ShieldCheck size={15} /><span>公开元数据 · 本轮最多 {count} 条 · 不自动下载视频</span></div>
    {result?.ok === false && <div className="creation-message error" role="alert"><CircleAlert size={16} />{result.message ?? "账号分析失败"}</div>}
    {report && <><section className="radar-profile"><div className="radar-profile-main"><div className="eyebrow">PROFILE SNAPSHOT</div><h2>{report.profile.nickname ?? report.secUserId}</h2><p>{report.profile.signature || "账号没有返回简介"}</p></div><div className="radar-profile-stats"><span><strong>{report.profile.followerCount?.toLocaleString() ?? "—"}</strong> 粉丝</span><span><strong>{report.profile.awemeCount?.toLocaleString() ?? "—"}</strong> 作品</span></div></section><section className="radar-coverage"><div><div className="eyebrow">COVERAGE</div><h3>首轮证据覆盖</h3></div><div className="coverage-numbers"><span><strong>{report.coverage.received}</strong> / {report.coverage.requested} 元数据</span><span><strong>0</strong> 条媒体拆解</span><span>{report.coverage.hasMore ? "还有下一页" : "已到末页"}</span></div><p>{report.coverage.note}</p></section><section className="radar-video-section"><div className="edit-section-heading"><div><div className="eyebrow">LATEST WORKS</div><h3>最新作品</h3></div><span>每条都有来源 evidence</span></div><div className="radar-video-grid">{report.videos.map((video) => <article className="radar-video-card" key={video.awemeId}><div className="radar-video-top"><span>{duration(video.durationMs)}</span><span>{video.mediaAnalysisStatus === "metadata_only" ? "待选中拆解" : video.mediaAnalysisStatus}</span></div><h4>{video.description || "无文案"}</h4><p>{metricLabel(video.statistics)}</p><div className="radar-video-footer"><span>{video.awemeId}</span>{video.shareUrl && <button className="text-button" onClick={() => window.desktop?.openExternal(video.shareUrl!)}><ExternalLink size={13} /> 来源</button>}</div></article>)}</div></section><section className="radar-finding"><div className="eyebrow">NEXT ACTION</div><h3>{report.findings[0]?.title ?? "选择作品做进一步分析"}</h3><p>{report.findings[0]?.detail ?? "从最新作品中选 3–5 条，再执行本地媒体事实分析。"}</p></section></>}
  </section>;
}

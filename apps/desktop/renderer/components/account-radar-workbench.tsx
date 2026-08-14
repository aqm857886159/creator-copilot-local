import { useEffect, useState } from "react";
import { BarChart3, Check, ChevronDown, CircleAlert, Clock3, Download, ExternalLink, Search, ShieldCheck } from "lucide-react";

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

function timecode(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function timelineText(items: Array<{ text: string }>, fallback: string) {
  return items.length > 0 ? items.map((item) => item.text).join(" · ") : fallback;
}

export function AccountRadarWorkbench({ workspaceReady }: { workspaceReady: boolean }) {
  const [sourceInput, setSourceInput] = useState("");
  const [count, setCount] = useState(20);
  const [result, setResult] = useState<AccountResearchResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [metricsBusy, setMetricsBusy] = useState(false);
  const [metricsQuote, setMetricsQuote] = useState<AccountMetricsQuoteView | null>(null);
  const [accountAnalysisBusy, setAccountAnalysisBusy] = useState(false);
  const [accountAnalysisQuote, setAccountAnalysisQuote] = useState<AccountWorkAnalysisQuoteView | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null);
  const [savedTopicIds, setSavedTopicIds] = useState<Set<string>>(new Set());
  const [topicBusyId, setTopicBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceReady || !window.desktop) return;
    void window.desktop.listTopics().then((response) => {
      if (response.topics) setSavedTopicIds(new Set(response.topics.filter((topic) => topic.source.kind === "account_research").map((topic) => topic.source.opportunityId)));
    });
  }, [workspaceReady]);

  async function research() {
    if (!window.desktop || !workspaceReady || loading || !sourceInput.trim()) return;
    setLoading(true);
    setActionMessage(null);
    setSelectedIds([]);
    setMetricsQuote(null);
    setAccountAnalysisQuote(null);
    setExpandedVideoId(null);
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

  async function quoteMissingMetrics() {
    if (!window.desktop || !report || metricsBusy) return;
    const awemeIds = report.videos.filter((video) => video.statistics.play_count === undefined && video.statistics.playCount === undefined).map((video) => video.awemeId).slice(0, 50);
    if (awemeIds.length === 0) {
      setActionMessage("当前作品已经包含播放统计，不需要再次补齐。");
      return;
    }
    setMetricsBusy(true);
    setActionMessage(null);
    try {
      const response = await window.desktop.quoteAccountMetrics({ reportId: report.id, awemeIds });
      if (response.quote) setMetricsQuote(response.quote);
      setActionMessage(response.ok ? `已生成 ${awemeIds.length} 条作品的统计报价，请确认后才会调用 TikHub。` : response.message ?? "无法取得作品统计报价");
    } finally {
      setMetricsBusy(false);
    }
  }

  async function runMetrics() {
    if (!window.desktop || !metricsQuote || metricsBusy) return;
    setMetricsBusy(true);
    setActionMessage(null);
    try {
      const response = await window.desktop.runAccountMetrics(metricsQuote.id);
      if (response.report) setResult({ ok: response.ok, report: response.report, message: response.message, errorCode: response.errorCode });
      setMetricsQuote(null);
      setActionMessage(response.message ?? (response.ok ? `已补齐 ${response.updatedCount ?? 0} 条作品统计。` : "作品统计补齐失败；不会自动重试。"));
    } finally {
      setMetricsBusy(false);
    }
  }

  async function quoteAccountAnalysis() {
    if (!window.desktop || !report || accountAnalysisBusy || report.accountAnalysis) return;
    setAccountAnalysisBusy(true);
    setActionMessage(null);
    try {
      const response = await window.desktop.quoteAccountAnalysis({ reportId: report.id, day: 7 });
      if (response.quote) setAccountAnalysisQuote(response.quote);
      setActionMessage(response.ok ? "已生成近 7 日账号表现报价，请确认后才会调用 TikHub。" : response.message ?? "无法取得账号表现报价");
    } finally {
      setAccountAnalysisBusy(false);
    }
  }

  async function runAccountAnalysis() {
    if (!window.desktop || !accountAnalysisQuote || accountAnalysisBusy) return;
    setAccountAnalysisBusy(true);
    setActionMessage(null);
    try {
      const response = await window.desktop.runAccountAnalysis(accountAnalysisQuote.id);
      if (response.report) setResult({ ok: response.ok, report: response.report, message: response.message, errorCode: response.errorCode });
      setAccountAnalysisQuote(null);
      setActionMessage(response.message ?? (response.ok ? "已补充账号表现基准。" : "账号表现补齐失败；不会自动重试。"));
    } finally {
      setAccountAnalysisBusy(false);
    }
  }

  async function saveOpportunity(opportunityId: string) {
    if (!window.desktop || !report || topicBusyId) return;
    setTopicBusyId(opportunityId);
    setActionMessage(null);
    try {
      const response = await window.desktop.saveTopicOpportunity({ source: "account_research", reportId: report.id, opportunityId });
      if (!response.ok || !response.topic) {
        setActionMessage(response.message ?? "加入选题库失败");
        return;
      }
      setSavedTopicIds((current) => new Set(current).add(opportunityId));
      setActionMessage(response.created ? "已加入本地选题库；下一步由你确认是否值得写成自己的观点。" : "这个机会已经在本地选题库中，仍需你确认后再进入脚本。");
    } finally {
      setTopicBusyId(null);
    }
  }

  if (!workspaceReady) return <section className="radar-workbench empty-edit-workbench"><div className="empty-icon"><BarChart3 size={24} /></div><div className="eyebrow">ACCOUNT RADAR</div><h1>先连接一个工作区</h1><p>账号快照、作品元数据和证据包会保存在本地，不会把临时 Provider URL 当成素材。</p></section>;

  const report = result?.report;
  const selectedCount = selectedIds.length;
  const opportunityActions = report && report.opportunities.length > 0 ? <section className="radar-opportunity-actions"><div className="edit-section-heading"><div><div className="eyebrow">TOPIC LIBRARY · HUMAN CONFIRMATION</div><h3>把切入假设保存为选题</h3></div><span>{report.opportunities.length} 条机会</span></div><p>保存后会进入本地选题库；它仍是候选方向，不会自动生成脚本或覆盖已有项目。</p><div className="radar-opportunity-save-list">{report.opportunities.map((opportunity) => <div className="radar-opportunity-save-row" key={opportunity.id}><div><strong>{opportunity.title}</strong><span>{opportunity.evidenceIds.length} 条证据 · {opportunity.sourceVideoIds.join("、")}</span></div><button className="secondary-button" onClick={() => void saveOpportunity(opportunity.id)} disabled={topicBusyId !== null}>{savedTopicIds.has(opportunity.id) ? <><Check size={14} />已在选题库</> : topicBusyId === opportunity.id ? "保存中…" : "加入选题库"}</button></div>)}</div></section> : null;
  return <section className="radar-workbench">
    {opportunityActions}
    <div className="creation-heading"><div><div className="eyebrow">ACCOUNT RADAR · EVIDENCE FIRST</div><h1>先看对标账号的事实。</h1><p>首轮只拉公开账号资料和最多 20 条作品元数据；只有你选中的作品才进入下载、ASR、OCR 和镜头分析。</p></div><div className="workspace-state ready"><span />metadata-first</div></div>
    <div className="radar-query"><div className="radar-query-input"><Search size={17} /><input aria-label="抖音主页链接或 sec_user_id" value={sourceInput} onChange={(event) => setSourceInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void research(); }} placeholder="粘贴抖音主页链接或 sec_user_id" /></div><label><span>首轮作品</span><select value={count} onChange={(event) => setCount(Number(event.target.value))}><option value={10}>10 条</option><option value={20}>20 条</option></select></label><button className="primary-button" onClick={research} disabled={loading || !sourceInput.trim()}>{loading ? "分析中…" : "开始分析"}</button></div>
    <div className="radar-safety"><ShieldCheck size={15} /><span>公开元数据 · 本轮最多 {count} 条 · 不自动下载视频</span></div>
    {result?.ok === false && <div className="creation-message error" role="alert"><CircleAlert size={16} />{result.message ?? "账号分析失败"}</div>}
    {actionMessage && <div className="radar-action-message" role="status"><Check size={15} />{actionMessage}</div>}
    {report && <><section className="radar-profile"><div className="radar-profile-main"><div className="eyebrow">PROFILE SNAPSHOT</div><h2>{report.profile.nickname ?? report.secUserId}</h2><p>{report.profile.signature || "账号没有返回简介"}</p></div><div className="radar-profile-stats"><span><strong>{report.profile.followerCount?.toLocaleString() ?? "—"}</strong> 粉丝</span><span><strong>{report.profile.awemeCount?.toLocaleString() ?? "—"}</strong> 作品</span></div></section>{report.accountAnalysis && <section className="radar-account-analysis"><div><div className="eyebrow">ACCOUNT PERFORMANCE · EVIDENCE</div><h3>近 {report.accountAnalysis.day} 日作品表现基准</h3><p>这是账号聚合数据，不是单条作品的因果结论；抓取时间与原始响应 hash 已保存在证据中。</p></div><div className="radar-account-analysis-metrics">{[["平均点赞", report.accountAnalysis.metrics.avg_like_count], ["平均评论", report.accountAnalysis.metrics.avg_comment_count], ["平均分享", report.accountAnalysis.metrics.avg_share_count], ["点赞分位", report.accountAnalysis.metrics.percentile_like_count]].map(([label, value]) => value !== undefined ? <span key={String(label)}><strong>{typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</strong>{label}</span> : null)}</div></section>}<section className="radar-coverage"><div><div className="eyebrow">COVERAGE</div><h3>首轮证据覆盖</h3></div><div className="coverage-numbers"><span><strong>{report.coverage.received}</strong> / {report.coverage.requested} 元数据</span><span><strong>{report.coverage.received - report.coverage.missingMedia}</strong> 条已本地化</span><span>{report.coverage.hasMore ? "还有下一页" : "已到末页"}</span></div><p>{report.coverage.note}</p><div className="radar-account-analysis-action"><div><strong>补充近 7 日账号表现</strong><span>单次读取账号聚合基准；确认后才调用 TikHub，不会自动后台运行。</span></div><button className="secondary-button" onClick={() => void quoteAccountAnalysis()} disabled={accountAnalysisBusy || Boolean(report.accountAnalysis)}>{report.accountAnalysis ? "已补充" : accountAnalysisBusy ? "处理中…" : "补充账号表现"}</button></div>{accountAnalysisQuote && <div className="radar-account-analysis-quote"><div><strong>确认读取近 {accountAnalysisQuote.day} 日表现</strong><span>预计费用 ${accountAnalysisQuote.costUsd.toFixed(3)} · 报价 10 分钟内有效 · 不会自动重试</span></div><button className="primary-button" onClick={() => void runAccountAnalysis()} disabled={accountAnalysisBusy}>{accountAnalysisBusy ? "调用中…" : "确认调用"}</button></div>}<div className="radar-metrics-action"><div><strong>播放统计缺失时再补齐</strong><span>只对当前报告中没有播放数的作品报价；确认后才调用 TikHub，最多 50 条。</span></div><button className="secondary-button" onClick={() => void quoteMissingMetrics()} disabled={metricsBusy}>{metricsBusy ? "处理中…" : "补齐播放统计"}</button></div>{metricsQuote && <div className="radar-metrics-quote"><div><strong>确认补齐 {metricsQuote.awemeIds.length} 条作品</strong><span>预计费用 ${metricsQuote.costUsd.toFixed(3)} · 报价 10 分钟内有效 · 不会自动重试</span></div><button className="primary-button" onClick={() => void runMetrics()} disabled={metricsBusy}>{metricsBusy ? "调用中…" : "确认调用"}</button></div>}</section><section className="radar-video-section"><div className="edit-section-heading"><div><div className="eyebrow">LATEST WORKS</div><h3>最新作品</h3></div><span>选择 1–5 条后再下载</span></div><div className="radar-selection-toolbar"><span>已选择 {selectedCount} / 5</span><button className="primary-button" onClick={() => void downloadSelected()} disabled={downloading || selectedCount < 1}>{downloading ? "本地化与分析中…" : <><Download size={14} />本地化并分析选中作品</>}</button></div><div className="radar-video-grid">{report.videos.map((video) => { const selected = selectedIds.includes(video.awemeId); const localised = video.artifactIds.length > 0; const analyzed = video.mediaAnalysisStatus === "completed"; const expanded = expandedVideoId === video.awemeId; const analysis = video.analysis; return <article className={`radar-video-card ${selected ? "selected" : ""}`} key={video.awemeId}><button className="radar-video-select" onClick={() => toggleSelection(video.awemeId)} aria-pressed={selected} disabled={downloading || analyzed}>{selected ? <Check size={14} /> : null}<span>{analyzed ? "已完成" : localised ? "重试分析" : selected ? "已选择" : "选择拆解"}</span></button><div className="radar-video-top"><span>{duration(video.durationMs)}</span><span>{statusLabel(video.mediaAnalysisStatus, video.artifactIds)}</span></div><h4>{video.description || "无文案"}</h4><p>{metricLabel(video.statistics)}</p>{video.analysisFactIds.length > 0 && <p className="radar-video-facts">已回挂 {video.analysisFactIds.length} 条时间码事实</p>}<div className="radar-video-footer"><span>{video.awemeId}</span><button className="text-button radar-video-detail-toggle" onClick={() => setExpandedVideoId(expanded ? null : video.awemeId)} aria-expanded={expanded} disabled={!analysis}>{analysis ? <>{expanded ? "收起拆解" : "查看拆解"}<ChevronDown size={13} className={expanded ? "rotated" : ""} /></> : "完成本地分析后查看"}</button>{video.shareUrl && <button className="text-button" onClick={() => window.desktop?.openExternal(video.shareUrl!)}><ExternalLink size={13} /> 来源</button>}</div>{expanded && analysis && <div className="radar-video-analysis"><div className="radar-analysis-stats"><span><strong>{analysis.shotCount}</strong> 镜头</span><span><strong>{analysis.transcriptCount}</strong> 段 ASR</span><span><strong>{analysis.ocrCount}</strong> 条 OCR</span></div>{analysis.openingText.length > 0 && <div className="radar-opening"><div className="eyebrow">OPENING ASR</div><p>{analysis.openingText.join(" ")}</p></div>}{analysis.timeline.length > 0 ? <div className="radar-timeline">{analysis.timeline.map((segment) => <div className="radar-timeline-row" key={segment.id}><time><Clock3 size={12} />{timecode(segment.startMs)}–{timecode(segment.endMs)}</time><div><strong>{segment.transition ? `镜头 · ${segment.transition}` : "镜头时间段"}</strong><p>{timelineText(segment.transcript, "没有可用 ASR")}</p>{segment.ocr.length > 0 && <small>画面文字：{timelineText(segment.ocr, "")}</small>}</div></div>)}</div> : <div className="radar-analysis-empty">当前没有可展示的镜头时间线；保留已获取的事实数量，稍后可重试或补模型。</div>}{analysis.missingKinds.length > 0 && <p className="radar-analysis-gap">缺少：{analysis.missingKinds.map((kind) => kind === "transcript" ? "ASR" : kind === "ocr" ? "OCR" : "镜头检测").join("、")}</p>}</div>}</article>; })}</div></section>{report.opportunities.length > 0 && <section className="radar-opportunities"><div className="edit-section-heading"><div><div className="eyebrow">TOPIC OPPORTUNITIES · REVIEW FIRST</div><h3>从事实得到的切入假设</h3></div><span>{report.opportunities.length} 条候选</span></div><p className="radar-opportunity-disclaimer">这些不是自动生成的结论，而是根据已拆解作品的文案和镜头事实整理的待审阅方向。</p><div className="radar-opportunity-grid">{report.opportunities.map((opportunity) => <article className="radar-opportunity" key={opportunity.id}><h4>{opportunity.title}</h4><p>{opportunity.angle}</p><small>{opportunity.whyNow}</small><div className="radar-opportunity-evidence">证据：{opportunity.evidenceIds.length} 条 · 作品 {opportunity.sourceVideoIds.join("、")}</div></article>)}</div></section>}<section className="radar-findings"><div className="edit-section-heading"><div><div className="eyebrow">FINDINGS · EVIDENCE</div><h3>结论必须能追溯</h3></div><span>{report.findings.length} 条结论</span></div>{report.findings.map((finding) => <article className="radar-finding" key={finding.id}><div className="eyebrow">{finding.kind}</div><h3>{finding.title}</h3><p>{finding.detail}</p><div className="radar-evidence-list">{finding.evidenceIds.map((evidenceId) => { const evidence = report.evidence.find((item) => item.id === evidenceId); return <div className="radar-evidence" key={evidenceId}><strong>{evidence?.label ?? evidenceId}</strong><span>{evidence ? evidenceSummary(evidence.payload) : "来源证据不可用"}</span></div>; })}</div></article>)}</section></>}
  </section>;
}

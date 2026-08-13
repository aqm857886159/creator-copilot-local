import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CircleDollarSign, Clock3, ExternalLink, Lightbulb, LoaderCircle, RefreshCw, Search, ShieldCheck, Sparkles } from "lucide-react";

const sourceLabels: Record<TopicRadarQueryView["sources"][number], string> = {
  low_fan: "低粉爆款",
  high_completion: "高完播样本",
  search_hot: "搜索热榜",
};

const sourceDescriptions: Record<TopicRadarQueryView["sources"][number], string> = {
  low_fan: "发现粉丝量不高但传播表现突出的作品",
  high_completion: "寻找值得拆解开头与节奏的高完播样本",
  search_hot: "观察用户正在主动搜索的词和趋势",
};

function money(value: number) {
  return value === 0 ? "$0" : `$${value.toFixed(3)}`;
}

function relativeExpiry(expiresAt: string) {
  const minutes = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60_000));
  return minutes > 0 ? `${minutes} 分钟内有效` : "已过期";
}

export function TopicRadarWorkbench({ workspacePath }: { workspacePath: string | null }) {
  const workspaceReady = Boolean(workspacePath);
  const [sources, setSources] = useState<TopicRadarQueryView["sources"]>(["low_fan", "search_hot"]);
  const [keyword, setKeyword] = useState("");
  const [dateWindow, setDateWindow] = useState<TopicRadarQueryView["dateWindow"]>(24);
  const [pageSize, setPageSize] = useState(10);
  const [quote, setQuote] = useState<TopicRadarQuoteView | null>(null);
  const [report, setReport] = useState<TopicRadarReportView | null>(null);
  const [history, setHistory] = useState<TopicRadarReportView[]>([]);
  const [busy, setBusy] = useState<"quote" | "run" | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [, setClock] = useState(() => Date.now());

  const query = useMemo<TopicRadarQueryView>(() => ({ schemaVersion: 1, sources, keyword: keyword.trim(), dateWindow, pageSize }), [dateWindow, keyword, pageSize, sources]);
  const quoteIsFresh = quote && quote.query.sources.join(",") === query.sources.join(",") && quote.query.keyword === query.keyword && quote.query.dateWindow === query.dateWindow && quote.query.pageSize === query.pageSize && new Date(quote.expiresAt).getTime() > Date.now();

  useEffect(() => {
    if (!workspaceReady || !window.desktop) return;
    void window.desktop.listTopicRadarReports().then((result) => { if (result.reports) setHistory(result.reports); });
  }, [workspacePath, workspaceReady]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  function toggleSource(source: TopicRadarQueryView["sources"][number]) {
    setQuote(null);
    setReport(null);
    setMessage(null);
    setSources((current) => current.includes(source) ? current.filter((item) => item !== source) : current.length >= 3 ? current : [...current, source]);
  }

  async function getQuote() {
    if (!window.desktop || !workspaceReady || sources.length === 0 || busy) return;
    setBusy("quote");
    setQuote(null);
    setReport(null);
    setMessage(null);
    try {
      const result = await window.desktop.quoteTopicRadar(query);
      if (result.quote) setQuote(result.quote);
      else setMessage({ kind: "error", text: result.message ?? "无法取得动态报价" });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "无法取得动态报价" });
    } finally {
      setBusy(null);
    }
  }

  async function runRadar() {
    if (!window.desktop || !quote || !quoteIsFresh || busy) return;
    setBusy("run");
    setMessage({ kind: "info", text: "已确认调用，正在按来源逐项运行；此过程不会自动重试。" });
    try {
      const result = await window.desktop.runTopicRadar(quote.id);
      if (result.report) {
        setReport(result.report);
        setHistory((current) => [result.report!, ...current.filter((item) => item.id !== result.report!.id)]);
        setQuote(null);
        setMessage({ kind: result.report.status === "completed" ? "success" : "info", text: result.message ?? (result.report.status === "completed" ? "选题雷达完成，候选机会已保存为本地证据。" : "部分来源完成，失败来源没有自动重试。") });
      } else setMessage({ kind: "error", text: result.message ?? "选题雷达运行失败" });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "选题雷达运行失败" });
    } finally {
      setBusy(null);
    }
  }

  if (!workspaceReady) return <section className="topic-radar-workbench topic-radar-empty"><div className="empty-icon"><Lightbulb size={24} /></div><div className="eyebrow">TOPIC RADAR</div><h1>先连接一个本地工作区</h1><p>报价、调用记录、候选选题和证据都会保存在本地。</p></section>;

  return <section className="topic-radar-workbench">
    <div className="creation-heading"><div><div className="eyebrow">TOPIC RADAR · QUOTE BEFORE CALL</div><h1>先知道为什么现在值得做。</h1><p>把平台信号当作研究入口，不把榜单直接当答案。每次调用前先看动态价格，结果只会成为带证据的候选选题。</p></div><div className="workspace-state ready"><span />本地证据优先</div></div>
    <section className="topic-radar-config">
      <div className="topic-radar-config-heading"><div><div className="eyebrow">01 · RESEARCH SCOPE</div><h2>选择你想验证的信号</h2></div><span>一次最多 3 个来源</span></div>
      <div className="topic-source-grid">{(Object.keys(sourceLabels) as TopicRadarQueryView["sources"][number][]).map((source) => { const checked = sources.includes(source); return <label className={`topic-source-card ${checked ? "checked" : ""}`} key={source}><input type="checkbox" checked={checked} onChange={() => toggleSource(source)} /><span className="topic-source-check">{checked ? <Check size={13} /> : null}</span><span><strong>{sourceLabels[source]}</strong><small>{sourceDescriptions[source]}</small></span></label>; })}</div>
      <div className="topic-radar-fields"><label><span>关键词（可选）</span><div className="topic-input"><Search size={15} /><input value={keyword} onChange={(event) => { setKeyword(event.target.value); setQuote(null); setReport(null); }} placeholder="例如：表达结构、职场沟通" maxLength={100} /></div></label><label><span>时间窗口</span><select value={dateWindow} onChange={(event) => { setDateWindow(Number(event.target.value) as TopicRadarQueryView["dateWindow"]); setQuote(null); setReport(null); }}><option value={1}>近 1 小时</option><option value={24}>近 24 小时</option><option value={72}>近 3 天</option><option value={168}>近 7 天</option></select></label><label><span>每个来源</span><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setQuote(null); setReport(null); }}><option value={5}>5 条</option><option value={10}>10 条</option><option value={20}>20 条</option></select></label></div>
      <div className="topic-radar-safety"><ShieldCheck size={15} /><span>只读公开榜单与搜索信号 · 不自动下载视频 · 报价不等于已调用</span><button className="primary-button" onClick={() => void getQuote()} disabled={busy !== null || sources.length === 0}>{busy === "quote" ? <><LoaderCircle size={14} className="spin" />读取报价…</> : <><CircleDollarSign size={14} />读取动态报价</>}</button></div>
      {sources.length === 0 && <div className="topic-selection-error" role="alert">至少选择一个信号来源，才能读取报价。</div>}
    </section>
    {message && <div className={`topic-radar-message ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}><span>{message.kind === "error" ? <AlertTriangle size={16} /> : message.kind === "success" ? <Check size={16} /> : <Clock3 size={16} />}</span>{message.text}</div>}
    {quote && <section className="topic-radar-quote"><div className="topic-radar-quote-heading"><div><div className="eyebrow">02 · REVIEW COST</div><h2>确认后才会调用</h2></div><span>{relativeExpiry(quote.expiresAt)}</span></div><div className="topic-radar-quote-lines">{quote.lines.map((line) => <div className="topic-radar-quote-line" key={line.source}><span>{sourceLabels[line.source]}</span><strong>{money(line.costUsd)}</strong><small>{line.rateLimit ? `限流 ${line.rateLimit}` : "价格由 TikHub 动态返回"}</small></div>)}</div><div className="topic-radar-quote-total"><span>本次最多 {quote.query.sources.length * quote.query.pageSize} 条候选</span><strong>{money(quote.totalCostUsd)} USD</strong></div><button className="primary-button topic-radar-confirm" onClick={() => void runRadar()} disabled={busy !== null || !quoteIsFresh}>{busy === "run" ? <><LoaderCircle size={14} className="spin" />运行中…</> : <>确认并运行选题雷达 <Sparkles size={14} /></>}</button></section>}
    {report && <section className="topic-radar-result"><div className="topic-radar-result-heading"><div><div className="eyebrow">03 · EVIDENCE REPORT</div><h2>{report.status === "completed" ? "候选信号已归档" : report.status === "partial" ? "部分信号已归档" : "本次没有得到有效信号"}</h2></div><span className={`topic-status topic-status-${report.status}`}>{report.status === "completed" ? "完成" : report.status === "partial" ? "部分完成" : "失败"}</span></div>{report.opportunities.length === 0 ? <div className="topic-empty-result"><AlertTriangle size={17} /><p>没有生成候选机会。检查来源运行状态，或换一个关键词和时间窗口。</p></div> : <div className="topic-opportunity-grid">{report.opportunities.map((opportunity) => <article className="topic-opportunity-card" key={opportunity.id}><div className="topic-opportunity-top"><span>{sourceLabels[opportunity.source as TopicRadarQueryView["sources"][number]] ?? opportunity.source}</span><span>{opportunity.evidenceIds.length} 条证据</span></div><h3>{opportunity.title}</h3><p>{opportunity.angle}</p><small>{opportunity.whyNow}</small><div className="topic-evidence-list">{opportunity.evidenceIds.map((evidenceId) => { const evidence = report.signals.find((signal) => signal.id === evidenceId); return <span key={evidenceId}><Check size={11} />{evidence?.label ?? evidenceId}</span>; })}</div></article>)}</div>}<div className="topic-run-list">{report.runs.map((run) => <div key={run.source} className="topic-run-row"><span>{sourceLabels[run.source as TopicRadarQueryView["sources"][number]] ?? run.source}</span><span>{run.status === "succeeded" ? `完成 · ${run.itemCount} 条` : run.status === "submission_unknown" ? "状态未知 · 不会自动重试" : `失败 · ${run.error?.message ?? "请稍后重试"}`}</span></div>)}</div></section>}
    {!report && history.length > 0 && <section className="topic-radar-history"><div className="topic-radar-config-heading"><div><div className="eyebrow">LOCAL HISTORY</div><h2>之前保存的雷达结果</h2></div><RefreshCw size={16} /></div>{history.slice(0, 3).map((item) => <button className="topic-history-row" key={item.id} onClick={() => setReport(item)}><span><strong>{item.query.keyword || "未填写关键词"}</strong><small>{item.query.sources.map((source) => sourceLabels[source]).join("、")} · {new Date(item.createdAt).toLocaleString()}</small></span><span>{item.opportunities.length} 个候选 <ExternalLink size={13} /></span></button>)}</section>}
  </section>;
}

import { useEffect, useState } from "react";
import { Database, FileVideo, Search, Tag, Upload } from "lucide-react";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function AssetLibraryWorkbench({ workspaceReady, importMedia }: { workspaceReady: boolean; importMedia: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<AssetSearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!window.desktop || !workspaceReady || loading) return;
    setLoading(true);
    try {
      setResult(await window.desktop.searchAssets(query));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (workspaceReady) void search();
  }, [workspaceReady]);

  if (!workspaceReady) return <section className="asset-library empty-edit-workbench"><div className="empty-icon"><Database size={24} /></div><div className="eyebrow">LOCAL ASSET LIBRARY</div><h1>先连接一个工作区</h1><p>导入的原素材、代理片、缩略图和后续分析事实都会留在本地工作区。</p></section>;

  const artifacts = result?.artifacts ?? [];
  const facts = result?.facts ?? [];
  return <section className="asset-library">
    <div className="creation-heading"><div><div className="eyebrow">LOCAL ASSET LIBRARY</div><h1>素材知道自己能做什么。</h1><p>先用文件事实和本地分析结果搜索；ASR、OCR 和镜头标签都会带时间码回到这里。</p></div><button className="primary-button" onClick={importMedia}><Upload size={15} /> 导入视频</button></div>
    <div className="asset-search-bar"><Search size={17} /><input aria-label="搜索本地素材和分析事实" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="搜索观点、画面、文件名或标签" /><button className="secondary-button" onClick={search} disabled={loading}>{loading ? "搜索中…" : "搜索"}</button></div>
    {result?.ok === false && <div className="creation-message error">{result.message ?? "素材搜索失败"}</div>}
    <div className="asset-summary"><span><strong>{artifacts.length}</strong> 个本地产物</span><span><strong>{facts.length}</strong> 条可检索事实</span><span className="asset-summary-note"><Tag size={13} /> FTS5 · 本地索引</span></div>
    <div className="asset-library-grid"><section className="asset-panel"><div className="edit-section-heading"><div><div className="eyebrow">FILES</div><h3>素材与产物</h3></div><span>按最近导入</span></div>{artifacts.length === 0 ? <div className="asset-empty"><FileVideo size={19} /><p>还没有本地视频。导入第一段素材后，它会自动生成代理片和缩略图。</p></div> : <div className="asset-file-list">{artifacts.map((artifact) => <article className="asset-file-row" key={artifact.artifactId}><div className={`asset-kind asset-kind-${artifact.kind}`}><FileVideo size={16} /></div><div className="asset-file-main"><strong>{artifact.relativePath}</strong><p>{artifact.kind} · {artifact.mimeType} · {formatBytes(artifact.byteSize)}</p></div><span className="asset-hash">{artifact.contentHash.slice(0, 14)}…</span></article>)}</div>}</section><section className="asset-panel"><div className="edit-section-heading"><div><div className="eyebrow">ANALYSIS FACTS</div><h3>时间码证据</h3></div><span>{query ? `匹配“${query}”` : "最近分析"}</span></div>{facts.length === 0 ? <div className="asset-empty"><Tag size={19} /><p>素材导入后可以接入 whisper.cpp、OCR 和镜头检测；没有分析结果时不会显示虚假标签。</p></div> : <div className="asset-fact-list">{facts.map((fact) => <article className="asset-fact-row" key={fact.id}><div className="fact-time">{formatTime(fact.startMs)}<br />{formatTime(fact.endMs)}</div><div><strong>{fact.text || "无文本"}</strong><p>{fact.kind} · {fact.providerKey} · {fact.artifactId}</p></div></article>)}</div>}</section></div>
  </section>;
}

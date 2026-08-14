import { useEffect, useMemo, useState } from "react";
import { AudioLines, CheckCircle2, CircleAlert, FolderOpen, RefreshCw, ScanText, Settings2 } from "lucide-react";

const fallbackSettings: LocalAnalysisSettingsView = {
  schemaVersion: 1,
  asr: { engine: "disabled", language: "zh", device: "cpu", computeType: "int8" },
  ocr: { engine: "disabled", sampleIntervalMs: 1_000 },
  updatedAt: new Date(0).toISOString(),
};

function capabilityTone(capability?: LocalAnalysisEngineView) {
  if (capability?.ready) return "ready";
  if (capability?.configured) return "warning";
  return "idle";
}

export function SettingsWorkbench() {
  const [settings, setSettings] = useState<LocalAnalysisSettingsView>(fallbackSettings);
  const [capabilities, setCapabilities] = useState<LocalAnalysisSettingsResult["capabilities"]>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  async function refresh() {
    if (!window.desktop) { setLoading(false); return; }
    setLoading(true); setMessage(null);
    try {
      const result = await window.desktop.getLocalAnalysisSettings();
      if (!result.ok || !result.settings) { setMessage({ tone: "error", text: result.message ?? "无法读取本地分析设置" }); return; }
      setSettings(result.settings);
      setCapabilities(result.capabilities);
      if (result.message) setMessage({ tone: "info", text: result.message });
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  function updateAsr(patch: Partial<LocalAnalysisSettingsView["asr"]>) {
    setSettings((current) => ({ ...current, asr: { ...current.asr, ...patch } }));
  }
  function updateOcr(patch: Partial<LocalAnalysisSettingsView["ocr"]>) {
    setSettings((current) => ({ ...current, ocr: { ...current.ocr, ...patch } }));
  }
  async function choose(kind: Parameters<NonNullable<Window["desktop"]>["chooseAnalysisPath"]>[0]["kind"]) {
    if (!window.desktop) return;
    const engine = kind.startsWith("asr-") ? settings.asr.engine === "disabled" ? "whisper.cpp" : settings.asr.engine : "apple-vision";
    const result = await window.desktop.chooseAnalysisPath({ kind, engine });
    if (result.ok && result.path) {
      if (kind === "asr-model") updateAsr({ modelPath: result.path });
      else if (kind === "asr-binary") updateAsr({ binaryPath: result.path });
      else if (kind === "asr-python") updateAsr({ pythonPath: result.path });
      else if (kind === "asr-script") updateAsr({ scriptPath: result.path });
      else if (kind === "ocr-script") updateOcr({ scriptPath: result.path });
      else if (kind === "ocr-binary") updateOcr({ binaryPath: result.path });
      setMessage({ tone: "info", text: "路径已选择，点击“保存设置”后才会用于下一次分析。" });
    } else if (!result.ok) setMessage({ tone: "error", text: result.message ?? "选择路径失败" });
  }
  async function save() {
    if (!window.desktop || saving) return;
    setSaving(true); setMessage(null);
    try {
      const result = await window.desktop.saveLocalAnalysisSettings({ ...settings, updatedAt: new Date().toISOString() });
      if (!result.ok || !result.settings) { setMessage({ tone: "error", text: result.message ?? "保存设置失败" }); return; }
      setSettings(result.settings); setCapabilities(result.capabilities); setMessage({ tone: "success", text: "本地分析设置已保存。下一次分析会使用这里的配置。" });
    } finally { setSaving(false); }
  }

  const asr = capabilities?.asr;
  const ocr = capabilities?.ocr;
  const statusSummary = useMemo(() => {
    const ready = [asr?.ready, ocr?.ready].filter(Boolean).length;
    return `${ready}/2 个可选智能能力的路径可用；首次分析仍会校验运行时，FFmpeg 镜头检测始终可用。`;
  }, [asr?.ready, ocr?.ready]);
  if (loading) return <section className="settings-workbench empty-edit-workbench"><RefreshCw className="spin" size={24} /><div className="eyebrow">LOCAL RUNTIMES</div><h1>正在检查本地能力…</h1><p>只读取本机配置和文件状态，不会上传模型或素材。</p></section>;
  return <section className="settings-workbench">
    <div className="creation-heading"><div><div className="eyebrow">LOCAL RUNTIMES · SETTINGS</div><h1>让本地能力说清楚自己。</h1><p>ASR、OCR 和镜头检测是素材库的事实层。模型路径由你选择，设置只留在本机，不会把密钥交给渲染器。</p></div><div className="settings-actions"><button className="secondary-button" onClick={() => void refresh()} disabled={saving}><RefreshCw size={15} /> 重新检查</button><button className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "保存设置"}</button></div></div>
    {message && <div className={`creation-message ${message.tone === "error" ? "error" : message.tone === "success" ? "success" : "info"}`} role={message.tone === "error" ? "alert" : "status"}>{message.tone === "error" ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}{message.text}</div>}
    <section className="settings-status-grid">
      <article className={`settings-status-card ${capabilityTone(asr)}`}><div className="settings-status-icon"><AudioLines size={18} /></div><div className="settings-status-copy"><div className="eyebrow">ASR · 语音转写</div><h3>{asr?.label ?? "未读取"}</h3><p>{asr?.ready ? `路径可用 · ${asr.pathLabel ?? "本地模型"}（首次分析会做运行校验）` : asr?.errors?.[0] ?? "未配置，不影响导入和镜头检测"}</p></div><span className="settings-status-pill">{asr?.ready ? "路径可用" : asr?.configured ? "待修复" : "未启用"}</span></article>
      <article className={`settings-status-card ${capabilityTone(ocr)}`}><div className="settings-status-icon"><ScanText size={18} /></div><div className="settings-status-copy"><div className="eyebrow">OCR · 画面文字</div><h3>{ocr?.label ?? "未读取"}</h3><p>{ocr?.ready ? `路径可用 · ${ocr.pathLabel ?? "本地 sidecar"}（首次分析会做运行校验）` : ocr?.errors?.[0] ?? "未配置，不影响导入和镜头检测"}</p></div><span className="settings-status-pill">{ocr?.ready ? "路径可用" : ocr?.configured ? "待修复" : "未启用"}</span></article>
      <article className="settings-status-card ready"><div className="settings-status-icon"><Settings2 size={18} /></div><div className="settings-status-copy"><div className="eyebrow">MEDIA FACTS · 基础事实</div><h3>{capabilities?.sceneDetection.label ?? "FFmpeg 镜头检测"}</h3><p>{statusSummary}</p></div><span className="settings-status-pill">可用</span></article>
    </section>
    <div className="settings-form-grid">
      <section className="settings-panel"><div className="edit-section-heading"><div><div className="eyebrow">SPEECH TO TEXT</div><h3>ASR 本地转写</h3></div><span>不自动下载模型</span></div><label className="settings-field"><span>引擎</span><select value={settings.asr.engine} onChange={(event) => updateAsr({ engine: event.target.value as LocalAnalysisSettingsView["asr"]["engine"] })}><option value="disabled">暂不启用</option><option value="whisper.cpp">whisper.cpp · 轻量离线</option><option value="faster-whisper">faster-whisper · Python sidecar</option></select></label><div className="settings-path-field"><div><span>模型路径</span><code>{settings.asr.modelPath ?? "尚未选择"}</code></div><button className="secondary-button" onClick={() => void choose("asr-model")} disabled={settings.asr.engine === "disabled"}><FolderOpen size={14} /> 选择</button></div>{settings.asr.engine === "whisper.cpp" && <div className="settings-path-field"><div><span>whisper-cli（可选）</span><code>{settings.asr.binaryPath ?? "使用 PATH 中的 whisper-cli"}</code></div><button className="secondary-button" onClick={() => void choose("asr-binary")}><FolderOpen size={14} /> 选择</button></div>}{settings.asr.engine === "faster-whisper" && <><div className="settings-path-field"><div><span>Python</span><code>{settings.asr.pythonPath ?? "尚未选择"}</code></div><button className="secondary-button" onClick={() => void choose("asr-python")}><FolderOpen size={14} /> 选择</button></div><div className="settings-path-field"><div><span>sidecar 脚本</span><code>{settings.asr.scriptPath ?? "尚未选择"}</code></div><button className="secondary-button" onClick={() => void choose("asr-script")}><FolderOpen size={14} /> 选择</button></div></>}<div className="settings-inline-fields"><label className="settings-field"><span>语言</span><input value={settings.asr.language} onChange={(event) => updateAsr({ language: event.target.value })} /></label><label className="settings-field"><span>设备</span><select value={settings.asr.device} onChange={(event) => updateAsr({ device: event.target.value as LocalAnalysisSettingsView["asr"]["device"] })}><option value="cpu">CPU</option><option value="cuda">CUDA</option><option value="auto">自动</option></select></label><label className="settings-field"><span>计算类型</span><input value={settings.asr.computeType} onChange={(event) => updateAsr({ computeType: event.target.value })} /></label></div></section>
      <section className="settings-panel"><div className="edit-section-heading"><div><div className="eyebrow">TEXT IN FRAME</div><h3>OCR 画面文字</h3></div><span>macOS Vision baseline</span></div><label className="settings-field"><span>引擎</span><select value={settings.ocr.engine} onChange={(event) => updateOcr({ engine: event.target.value as LocalAnalysisSettingsView["ocr"]["engine"] })}><option value="disabled">暂不启用</option><option value="apple-vision">Apple Vision · macOS</option></select></label><div className="settings-path-field"><div><span>Swift sidecar</span><code>{settings.ocr.scriptPath ?? "macOS 可使用内置 sidecar"}</code></div><button className="secondary-button" onClick={() => void choose("ocr-script")} disabled={settings.ocr.engine === "disabled"}><FolderOpen size={14} /> 选择</button></div><label className="settings-field"><span>抽帧间隔（毫秒）</span><input type="number" min={250} max={30000} step={250} value={settings.ocr.sampleIntervalMs} onChange={(event) => updateOcr({ sampleIntervalMs: Number(event.target.value) })} /></label><div className="settings-note"><ScanText size={15} /><p>OCR 结果会按时间码写回素材库，并合并相邻重复花字。Vision 不是 Windows/Linux 的通用方案，跨平台 adapter 会单独评估。</p></div></section>
    </div>
    <div className="settings-footnote"><span>当前配置更新时间：{settings.updatedAt === new Date(0).toISOString() ? "尚未保存" : new Date(settings.updatedAt).toLocaleString("zh-CN")}</span><span>本地优先 · 路径只存于应用 userData</span></div>
  </section>;
}

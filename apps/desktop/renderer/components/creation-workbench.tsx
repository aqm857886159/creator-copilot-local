import { useEffect, useState } from "react";
import { Camera, Check, ExternalLink, FileText, FolderOpen, Plus, Upload } from "lucide-react";

const initialBlocks: CaptureWorkflowInput["blocks"] = [
  { kind: "hook", text: "为什么很多人越努力表达，反而越没有记忆点？", visualNeed: "must_show" },
  { kind: "claim", text: "因为观点一直停留在同一个口播画面里，观众没有新的视觉证据。", visualNeed: "support" },
  { kind: "example", text: "讲到修改和推翻时，让观众真正看到桌面上的草稿和修改痕迹。", visualNeed: "must_show" },
];

const initialShots: CaptureWorkflowInput["shots"] = [
  { scriptBlockIndex: 0, purpose: "emotion", mode: "talking_head", framing: "medium", cameraDirection: "正面固定，问题说完后停顿半秒。", actionDescription: "面对镜头说出问题，保持眼神稳定。", targetMs: 4_000, sourceRequirement: "shoot_task" },
  { scriptBlockIndex: 1, purpose: "explain", mode: "talking_head", framing: "close", cameraDirection: "轻微推近或切近景。", actionDescription: "用更近的景别讲出核心判断。", targetMs: 5_000, sourceRequirement: "shoot_task" },
  { scriptBlockIndex: 2, purpose: "prove", mode: "broll", framing: "detail", cameraDirection: "手机俯拍，缓慢横移。", actionDescription: "拍桌面上带有圈画和修改痕迹的草稿。", targetMs: 3_000, sourceRequirement: "shoot_task" },
];

const shotPurposes = ["explain", "prove", "transition", "emotion", "reset", "brand"] as const;
const shotModes = ["talking_head", "broll", "screen_recording", "graphic", "generated", "still"] as const;
const shotFramings = ["wide", "medium", "close", "detail", "screen"] as const;
const sourceRequirements = ["existing_asset", "shoot_task", "generated_asset", "any"] as const;
const deviceHints = ["phone", "camera", "screen", "any"] as const;
const orientations = ["portrait", "landscape", "any"] as const;
const projectStageLabels: Record<string, string> = { script: "脚本已确认", capture: "拍摄包已生成", editing: "剪辑中", rendered: "已导出", published: "已发布" };

function savedLiteral<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && allowed.includes(value) ? value as T[number] : fallback;
}

function restoreScriptDraftShots(script: NonNullable<LoadProjectResult["script"]>, payload: Record<string, unknown>): CaptureWorkflowInput["shots"] {
  const rawPlans = payload.shotPlans && typeof payload.shotPlans === "object" && !Array.isArray(payload.shotPlans) ? payload.shotPlans as Record<string, unknown> : {};
  return script.blocks.map((block, index) => {
    const rawPlan = rawPlans[block.id] && typeof rawPlans[block.id] === "object" && !Array.isArray(rawPlans[block.id]) ? rawPlans[block.id] as Record<string, unknown> : {};
    const defaultPurpose = block.kind === "evidence" || block.kind === "example" ? "prove" : index === 0 ? "emotion" : "explain";
    return {
      scriptBlockIndex: index,
      purpose: savedLiteral(rawPlan.purpose, shotPurposes, defaultPurpose),
      mode: savedLiteral(rawPlan.mode, shotModes, "talking_head"),
      framing: savedLiteral(rawPlan.framing, shotFramings, index === 0 ? "medium" : "close"),
      cameraDirection: typeof rawPlan.cameraDirection === "string" ? rawPlan.cameraDirection : "保持主体清晰，完整拍一条备用版本。",
      deviceHint: savedLiteral(rawPlan.deviceHint, deviceHints, "any"),
      orientation: savedLiteral(rawPlan.orientation, orientations, "portrait"),
      checklist: Array.isArray(rawPlan.checklist) ? rawPlan.checklist.filter((item): item is string => typeof item === "string") : [],
      actionDescription: typeof rawPlan.actionDescription === "string" ? rawPlan.actionDescription : `拍摄能够支撑“${block.text}”的画面。`,
      targetMs: typeof rawPlan.targetMs === "number" && rawPlan.targetMs > 0 ? rawPlan.targetMs : 4_000,
      sourceRequirement: savedLiteral(rawPlan.sourceRequirement, sourceRequirements, "shoot_task"),
    };
  });
}

export function CreationWorkbench({ workspaceReady, chooseWorkspace, onWorkflowReady, openEdit }: { workspaceReady: boolean; chooseWorkspace: () => Promise<void>; onWorkflowReady: (workflow: CaptureWorkflowResult) => void; openEdit: () => void }) {
  const [projectTitle, setProjectTitle] = useState("表达为什么需要画面变化");
  const [blocks, setBlocks] = useState(initialBlocks);
  const [shots, setShots] = useState(initialShots);
  const [workflow, setWorkflow] = useState<CaptureWorkflowResult | null>(null);
  const [scriptBrief, setScriptBrief] = useState("我以前以为只要多拍几个镜头，口播就会更丰富。\n后来我发现，问题不在镜头数量，而在每个画面有没有真正证明观点。\n所以真正需要补的不是泛化 B-roll，而是能让观众看见证据的画面。")
  const [voiceProfile, setVoiceProfile] = useState("像平时聊天一样，有判断但不端着；保留具体经历，不用万能金句。")
  const [topics, setTopics] = useState<TopicView[]>([])
  const [selectedTopicId, setSelectedTopicId] = useState("")
  const [scriptProposal, setScriptProposal] = useState<ScriptProposalView | null>(null);
  const [acceptedScript, setAcceptedScript] = useState<ScriptAcceptResult["script"] | null>(null);
  const [acceptedProjectId, setAcceptedProjectId] = useState<string | undefined>();
  const [scriptBusy, setScriptBusy] = useState(false);
  const [takesByTask, setTakesByTask] = useState<Record<string, CaptureTake[]>>({});
  const [projects, setProjects] = useState<ProjectSummaryView[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">("error");

  useEffect(() => {
    if (!workspaceReady || !window.desktop) {
      setTopics([]);
      setSelectedTopicId("");
      return;
    }
    void window.desktop.listTopics().then((result) => {
      const selected = (result.topics ?? []).filter((topic) => topic.status === "selected");
      setTopics(selected);
      setSelectedTopicId((current) => current && selected.some((topic) => topic.id === current) ? current : selected[0]?.id ?? "");
    });
  }, [workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || !window.desktop) {
      setProjects([]);
      setProjectsLoading(false);
      return;
    }
    void refreshProjects();
  }, [workspaceReady]);

  async function refreshProjects() {
    if (!window.desktop) return;
    setProjectsLoading(true);
    try {
      const result = await window.desktop.listProjects();
      if (!result.ok) {
        setMessageTone("error");
        setMessage(result.message ?? "本地项目列表读取失败");
        return;
      }
      setProjects(result.projects ?? []);
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "本地项目列表读取失败");
    } finally {
      setProjectsLoading(false);
    }
  }

  async function loadProject(projectId: string) {
    if (!window.desktop || !projectId || loadingProjectId) return;
    setLoadingProjectId(projectId);
    setMessage(null);
    try {
      const result = await window.desktop.loadProject({ projectId });
      if (!result.ok || !result.project || !result.script) {
        setMessageTone("error");
        setMessage(result.message ?? "项目载入失败");
        return;
      }
      const loadedScript = result.script;
      const loadedStoryboard = result.storyboard;
      const loadedTasks = result.tasks ?? [];
      const taskByShotId = new Map(loadedTasks.map((task) => [task.shotId, task]));
      const blockIndexById = new Map(loadedScript.blocks.map((block, index) => [block.id, index]));
      setProjectTitle(result.project.title);
      setBlocks(loadedScript.blocks.map((block) => ({ kind: block.kind as CaptureWorkflowInput["blocks"][number]["kind"], text: block.text, visualNeed: block.visualNeed })));
      setShots(loadedStoryboard ? loadedStoryboard.shots.map((shot) => {
        const task = taskByShotId.get(shot.id);
        const blockIndex = shot.scriptBlockIds.map((id) => blockIndexById.get(id)).find((index) => index !== undefined) ?? 0;
        return { scriptBlockIndex: blockIndex, purpose: shot.purpose, mode: shot.mode, framing: shot.framing, cameraDirection: shot.cameraDirection, deviceHint: task?.deviceHint ?? shot.deviceHint, orientation: task?.orientation ?? shot.orientation, checklist: task?.checklist ?? shot.checklist, actionDescription: task?.instruction ?? shot.actionDescription, targetMs: task?.targetMs ?? shot.targetMs, sourceRequirement: shot.sourceRequirement };
      }) : restoreScriptDraftShots(loadedScript, result.project.payload));
      setAcceptedProjectId(result.project.id);
      setAcceptedScript(loadedScript);
      setScriptProposal(null);
      setWorkflow(loadedStoryboard && result.capturePackage ? { ok: true, projectId: result.project.id, script: loadedScript, storyboard: loadedStoryboard, tasks: loadedTasks, capturePackage: result.capturePackage } : null);
      setTakesByTask(result.takesByTask ?? {});
      setMessageTone("success");
      setMessage(loadedStoryboard && result.capturePackage ? `已从本地工作区恢复“${result.project.title}”的脚本、分镜和拍摄任务。` : `已从本地工作区恢复“${result.project.title}”的脚本，可以继续完善分镜。`);
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "项目载入失败");
    } finally {
      setLoadingProjectId(null);
    }
  }

  function updateBlock(index: number, patch: Partial<CaptureWorkflowInput["blocks"][number]>) {
    setBlocks((current) => current.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } : block));
  }

  function updateShot(index: number, patch: Partial<CaptureWorkflowInput["shots"][number]>) {
    setShots((current) => current.map((shot, shotIndex) => shotIndex === index ? { ...shot, ...patch } : shot));
  }

  function addBlockAndShot() {
    const blockIndex = blocks.length;
    setBlocks((current) => [...current, { kind: "evidence", text: "补充一个新的表达段落。", visualNeed: "support" }]);
    setShots((current) => [...current, { scriptBlockIndex: blockIndex, purpose: "prove", mode: "broll", framing: "detail", cameraDirection: "保持主体清晰，拍摄一条备用版本。", actionDescription: "描述这个段落需要补拍的具体画面。", targetMs: 3_000, sourceRequirement: "shoot_task" }]);
  }

  async function exportWorkflow() {
    const desktop = window.desktop;
    if (!desktop || !workspaceReady || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await desktop.createCaptureWorkflow({ projectTitle, existingProjectId: acceptedProjectId, existingScriptId: acceptedScript?.id, blocks, shots });
      setWorkflow(result);
      if (result.ok) void refreshProjects();
      onWorkflowReady(result);
      if (!result.ok) {
        setMessageTone("error");
        setMessage(result.message ?? "拍摄包生成失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function proposeScript() {
    if (!window.desktop || !workspaceReady || scriptBusy || !scriptBrief.trim()) return;
    setScriptBusy(true);
    setMessage(null);
    try {
      const result = await window.desktop.proposeScript({ brief: scriptBrief, voiceProfile, topicId: selectedTopicId || undefined });
      if (result.proposal) setScriptProposal(result.proposal);
      if (!result.ok) {
        setMessageTone("error");
        setMessage(result.message ?? "脚本提案失败");
      }
    } finally {
      setScriptBusy(false);
    }
  }

  async function acceptScript() {
    if (!window.desktop || !scriptProposal || scriptBusy || !projectTitle.trim()) return;
    setScriptBusy(true);
    setMessage(null);
    try {
      const result = await window.desktop.acceptScriptProposal({ proposalId: scriptProposal.id, projectTitle });
      if (!result.ok || !result.script) {
        setMessageTone("error");
        setMessage(result.message ?? "脚本确认失败");
        return;
      }
      const nextBlocks = result.script.blocks.map((block) => ({ kind: block.kind as CaptureWorkflowInput["blocks"][number]["kind"], text: block.text, visualNeed: block.visualNeed }));
      const proposalBlocks = result.proposal?.blocks ?? scriptProposal.blocks;
      const nextShots = nextBlocks.map((block, index) => {
        const plan = proposalBlocks[index]?.shotPlan;
        if (plan) return { scriptBlockIndex: index, purpose: plan.purpose, mode: plan.mode, framing: plan.framing, cameraDirection: plan.cameraDirection, deviceHint: plan.deviceHint, orientation: plan.orientation, checklist: plan.checklist, actionDescription: plan.actionDescription, targetMs: plan.targetMs, sourceRequirement: plan.sourceRequirement };
        const fallback = initialShots[index] ?? initialShots[initialShots.length - 1];
        return { ...fallback, scriptBlockIndex: index, purpose: block.kind === "hook" ? "emotion" as const : block.kind === "example" || block.kind === "evidence" ? "prove" as const : "explain" as const };
      });
      setBlocks(nextBlocks);
      setShots(nextShots);
      setAcceptedScript(result.script);
      setAcceptedProjectId(result.project?.id);
      void refreshProjects();
      setScriptProposal(result.proposal ?? { ...scriptProposal, status: "accepted" });
      setMessageTone("success");
      setMessage("脚本已确认并保存为本地版本；现在可以继续补分镜和拍摄包。");
    } finally {
      setScriptBusy(false);
    }
  }

  async function importTake(taskId: string) {
    const desktop = window.desktop;
    if (!desktop) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await desktop.importTake(taskId);
      if (!result.ok || !result.take) {
        if (result.errorCode !== "cancelled") {
          setMessageTone("error");
          setMessage(result.message ?? "Take 导入失败");
        }
        return;
      }
      setTakesByTask((current) => ({ ...current, [taskId]: [...(current[taskId] ?? []), result.take!] }));
      if (result.task) setWorkflow((current) => current ? { ...current, tasks: current.tasks?.map((task) => task.id === taskId ? result.task! : task) } : current);
    } finally {
      setBusy(false);
    }
  }

  async function chooseTake(taskId: string, takeId: string) {
    const desktop = window.desktop;
    if (!desktop) return;
    const result = await desktop.selectTake({ shootTaskId: taskId, takeId });
    if (!result.ok) {
      setMessageTone("error");
      setMessage(result.message ?? "Take 选择失败");
      return;
    }
    if (result.takes) setTakesByTask((current) => ({ ...current, [taskId]: result.takes! }));
    if (result.task) setWorkflow((current) => current ? { ...current, tasks: current.tasks?.map((task) => task.id === taskId ? result.task! : task) } : current);
  }

  return (
    <section className="creation-workbench">
      <div className="creation-heading">
        <div><div className="eyebrow">MANUAL CREATION LOOP</div><h1>脚本、分镜与拍摄包</h1><p>先把观点拆成可以执行的镜头；AI 会在这条真实链路上继续提案，而不是替你虚构素材。</p></div>
        <div className={`workspace-state ${workspaceReady ? "ready" : "missing"}`}><span />{workspaceReady ? "本地工作区已连接" : "尚未选择工作区"}</div>
      </div>

      {!workspaceReady && <div className="workspace-gate"><FileText size={19} /><div><strong>先选择一个本地工作区</strong><p>脚本、SQLite、拍摄包和导入的 Take 都会保存在这个目录。</p></div><button className="primary-button" onClick={chooseWorkspace}>选择工作区</button></div>}

      {workspaceReady && <section className="project-resume-panel" aria-busy={projectsLoading}><div className="project-resume-heading"><div><div className="eyebrow">LOCAL PROJECTS</div><strong>从上次停下的地方继续</strong><small>项目、脚本、分镜和拍摄任务都从本地工作区恢复。</small></div><FolderOpen size={18} /></div>{projectsLoading ? <p className="project-resume-empty" role="status">正在读取本地项目…</p> : projects.length === 0 ? <p className="project-resume-empty">还没有保存的项目，先从下面的脚本或分镜开始。</p> : <div className="project-resume-list">{projects.slice(0, 8).map((project) => <div className={`project-resume-row ${acceptedProjectId === project.id ? "active" : ""}`} key={project.id}><div><strong>{project.title}</strong><small>{projectStageLabels[project.stage] ?? project.stage} · 修订 {project.revision} · {new Date(project.updatedAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}</small></div><button className="secondary-button" onClick={() => void loadProject(project.id)} disabled={loadingProjectId !== null}>{loadingProjectId === project.id ? "载入中…" : "继续编辑"}</button></div>)}</div>}</section>}

      <label className="project-title-field"><span>项目标题</span><input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} /></label>

      {topics.length > 0 && <section className="script-topic-context"><label><span>可选：使用已确认选题</span><select value={selectedTopicId} onChange={(event) => { setSelectedTopicId(event.target.value); setScriptProposal(null); }}><option value="">不绑定选题，按原始思路整理</option>{topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label><small>只有选题库中已确认的方向才能进入这里；来源证据会随脚本提案保存。</small></section>}

      <section className="script-ai-panel"><div className="script-ai-heading"><div><div className="eyebrow">SCRIPT EDITOR · VOICE FIRST</div><h2>先把你真正想说的写下来</h2><p>AI 只整理表达，不替你发明经历、事实或“金句”。确认前不会覆盖脚本。</p></div><button className="secondary-button" onClick={() => void proposeScript()} disabled={!workspaceReady || scriptBusy || !scriptBrief.trim()}>{scriptBusy ? "整理中…" : "生成脚本提案"}</button></div><textarea className="script-brief-input" value={scriptBrief} onChange={(event) => setScriptBrief(event.target.value)} placeholder="写下你的原始想法，允许不完整、口语化、带犹豫。" /><input className="script-voice-input" value={voiceProfile} onChange={(event) => setVoiceProfile(event.target.value)} placeholder="表达偏好：例如像平时聊天、不用万能金句、保留具体经历" />{scriptProposal && <div className="script-proposal-review"><div className="script-proposal-review-top"><div><strong>{scriptProposal.status === "accepted" ? "脚本已确认" : "一份待审阅的脚本提案"}</strong><span>{scriptProposal.provider.providerKey} · {scriptProposal.blocks.length} 段 · 原稿不会被覆盖</span></div>{scriptProposal.status === "previewed" && <button className="primary-button" onClick={() => void acceptScript()} disabled={scriptBusy}>确认并保存脚本</button>}</div><div className="script-proposal-blocks">{scriptProposal.blocks.map((block) => <article key={block.id}><div className="eyebrow">{block.kind}</div><p>{block.text}</p><small>画面：{block.visualSuggestion}</small>{block.shotPlan && <div className="script-proposal-shot-plan"><small>拍什么：{block.shotPlan.actionDescription}</small><small>拍法：{block.shotPlan.cameraDirection} · {Math.round(block.shotPlan.targetMs / 100) / 10} 秒 · {block.shotPlan.deviceHint} · {block.shotPlan.orientation}</small><small>检查：{block.shotPlan.checklist.join(" · ")}</small></div>}</article>)}</div>{scriptProposal.styleNotes.length > 0 && <p className="script-proposal-note">表达提醒：{scriptProposal.styleNotes.join(" · ")}</p>}{scriptProposal.warnings.length > 0 && <p className="script-proposal-warning">需要你核验：{scriptProposal.warnings.join(" · ")}</p>}</div>}</section>

      <div className="creation-editor-grid">
        <section className="creation-column"><div className="column-title"><div><span>01</span><h2>脚本段落</h2></div><small>写你真正想说的话</small></div>{blocks.map((block, index) => <article className="editor-card" key={`block-${index}`}><div className="editor-card-top"><b>段落 {String(index + 1).padStart(2, "0")}</b><select value={block.kind} onChange={(event) => updateBlock(index, { kind: event.target.value as typeof block.kind })}><option value="hook">开头</option><option value="claim">观点</option><option value="evidence">证据</option><option value="example">案例</option><option value="counterpoint">反方</option><option value="conclusion">结论</option><option value="cta">行动</option></select></div><textarea value={block.text} onChange={(event) => updateBlock(index, { text: event.target.value })} /><label className="inline-field"><span>画面需要</span><select value={block.visualNeed} onChange={(event) => updateBlock(index, { visualNeed: event.target.value as typeof block.visualNeed })}><option value="none">不需要补画面</option><option value="support">建议补画面</option><option value="must_show">必须展示</option></select></label></article>)}</section>

        <section className="creation-column"><div className="column-title"><div><span>02</span><h2>分镜与拍法</h2></div><small>拍什么、为什么、拍多久</small></div>{shots.map((shot, index) => <article className="editor-card shot-editor" key={`shot-${index}`}><div className="editor-card-top"><b>镜头 {String(index + 1).padStart(2, "0")}</b><div className="select-pair"><select value={shot.mode} onChange={(event) => updateShot(index, { mode: event.target.value as typeof shot.mode })}><option value="talking_head">真人口播</option><option value="broll">B-roll</option><option value="screen_recording">录屏</option><option value="graphic">图形</option><option value="still">静帧</option></select><select value={shot.framing} onChange={(event) => updateShot(index, { framing: event.target.value as typeof shot.framing })}><option value="wide">全景</option><option value="medium">中景</option><option value="close">近景</option><option value="detail">细节</option><option value="screen">屏幕</option></select></div></div><textarea value={shot.actionDescription} onChange={(event) => updateShot(index, { actionDescription: event.target.value })} /><input className="camera-direction" value={shot.cameraDirection} onChange={(event) => updateShot(index, { cameraDirection: event.target.value })} placeholder="拍摄方式，例如：手机俯拍、缓慢横移" /><label className="inline-field"><span>目标时长</span><input type="number" min="1" max="60" value={shot.targetMs / 1000} onChange={(event) => updateShot(index, { targetMs: Math.max(1, Number(event.target.value)) * 1000 })} /><em>秒</em></label></article>)}</section>
      </div>

      <div className="creation-actions"><button className="secondary-button" onClick={addBlockAndShot}><Plus size={16} /> 添加段落与镜头</button><button className="primary-button" disabled={!workspaceReady || busy} onClick={exportWorkflow}><Camera size={16} /> {busy ? "处理中…" : "生成并导出拍摄包"}</button></div>
      {message && <div className={`creation-message ${messageTone}`} role={messageTone === "error" ? "alert" : "status"}>{message}</div>}

      {workflow?.ok && workflow.tasks && <section className="capture-result" aria-live="polite"><div className="capture-result-heading"><div><div className="eyebrow">CAPTURE PACKAGE READY</div><h2>逐镜头拍摄清单</h2></div><div className="capture-result-actions">{workflow.capturePackage && <button className="secondary-button" onClick={() => window.desktop?.openWorkspaceFile(workflow.capturePackage!.relativePath)}><ExternalLink size={15} /> 手机/浏览器查看</button>}<button className="primary-button" onClick={openEdit}><Camera size={15} /> 进入 AI 剪辑</button></div></div><div className="capture-task-list">{workflow.tasks.map((task, index) => <article className="capture-task" key={task.id}><div className="task-number">{String(index + 1).padStart(2, "0")}</div><div className="capture-task-main"><div className="capture-task-title"><strong>{task.title}</strong><span>{Math.round(task.targetMs / 100) / 10} 秒 · {task.deviceHint} · {task.orientation}</span></div><p>{task.instruction}</p><small className="capture-task-checklist">检查：{task.checklist.join(" · ")}</small><div className="take-list">{(takesByTask[task.id] ?? []).map((take, takeIndex) => <button className={`take-chip ${take.status === "selected" ? "selected" : ""}`} key={take.id} onClick={() => chooseTake(task.id, take.id)} aria-pressed={take.status === "selected"}>{take.status === "selected" ? <Check size={13} /> : null}Take {takeIndex + 1}</button>)}<button className="take-import" disabled={busy} onClick={() => importTake(task.id)}><Upload size={13} /> 导入 Take</button></div></div></article>)}</div></section>}
    </section>
  );
}

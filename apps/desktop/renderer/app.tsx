import { useEffect, useState } from "react";
import { deriveNextAction, workflowFromLoadedProject } from "./lib/workbench";
import { Workbench } from "./components/workbench";
import { CreationWorkbench } from "./components/creation-workbench";
import { ScriptPage } from "./components/script-page";
import { AiEditWorkbench } from "./components/ai-edit-workbench";
import { AssetLibraryWorkbench } from "./components/asset-library-workbench";
import { AccountRadarWorkbench } from "./components/account-radar-workbench";
import { ReviewWorkbench } from "./components/review-workbench";
import { TopicRadarWorkbench } from "./components/topic-radar-workbench";
import { SettingsWorkbench } from "./components/settings-workbench";

// 导航四项(+设置),对齐 spec-02 产品形状:比旧七标签少。
// edit / creation / script 是内部视图(从工作台卡片进入),不进主导航。
type View = "workbench" | "topics" | "assets" | "memory" | "settings" | "edit" | "creation" | "script";

const NAV: Array<{ id: View; label: string }> = [
  { id: "workbench", label: "工作台" },
  { id: "topics", label: "选题" },
  { id: "assets", label: "素材库" },
  { id: "memory", label: "记忆" },
];

export function App() {
  const [view, setView] = useState<View>("workbench");
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [captureWorkflow, setCaptureWorkflow] = useState<CaptureWorkflowResult | null>(null);
  const [mediaImporting, setMediaImporting] = useState(false);
  const [mediaFeedback, setMediaFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [projectsReloadKey, setProjectsReloadKey] = useState(0);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  // 脚本页(切片 2):从工作台 script 阶段卡进入,承载真实脚本编辑与生成分镜。
  const [scriptProjectId, setScriptProjectId] = useState<string | null>(null);
  // 选题视图内的二级切换:热点雷达(TopicRadar)⇄ 账号雷达(AccountRadar),账号雷达能力不丢。
  const [topicsTab, setTopicsTab] = useState<"radar" | "account">("radar");

  useEffect(() => {
    let active = true;
    if (!window.desktop) return () => { active = false; };
    void window.desktop.getInfo().then((info) => {
      if (active && info.workspacePath) setWorkspacePath(info.workspacePath);
    });
    return () => { active = false; };
  }, []);

  const workspaceReady = Boolean(workspacePath);

  async function chooseWorkspace() {
    if (!window.desktop) return;
    const result = await window.desktop.chooseWorkspace();
    if (!result.canceled) {
      setWorkspacePath(result.path);
      setProjectsReloadKey((key) => key + 1);
    }
  }

  function formatDuration(durationMs?: number | null) {
    if (!durationMs) return "时长未知";
    const totalSeconds = Math.round(durationMs / 1000);
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
  }

  // 正门「拍好了就扔进来」:本切片行为 = 现有 importMedia();快剪管线是切片 3,不假装存在。
  async function importMedia() {
    if (!window.desktop || mediaImporting) return;
    setMediaImporting(true);
    setMediaFeedback(null);
    try {
      const result = await window.desktop.importMedia();
      if (result.ok) {
        setMediaFeedback({ ok: true, text: `已接住「${result.sourceName ?? "素材"}」，${formatDuration(result.durationMs)}，已进素材库，可去整理。` });
      } else if (result.errorCode !== "cancelled") {
        setMediaFeedback({ ok: false, text: result.message ?? "素材导入没成功，检查工作区和文件后再试。" });
      }
    } finally {
      setMediaImporting(false);
    }
  }

  // 工作台点卡:editing/rendered 载入并适配后进 AI 剪辑;script/capture 进创作流;published 看数据。
  async function openProject(project: ProjectSummaryView) {
    const target = deriveNextAction(project).target;
    if (target === "editing" || target === "rendered") {
      if (!window.desktop || openingProjectId) return;
      setOpeningProjectId(project.id);
      try {
        const loaded = await window.desktop.loadProject({ projectId: project.id });
        const workflow = workflowFromLoadedProject(loaded);
        if (!workflow.ok) {
          setMediaFeedback({ ok: false, text: loaded.message ?? "这条项目暂时打不开，稍后再试。" });
          return;
        }
        setCaptureWorkflow(workflow);
        setView("edit");
      } finally {
        setOpeningProjectId(null);
      }
      return;
    }
    if (target === "published") {
      setView("memory");
      return;
    }
    if (target === "script") {
      // 切片 2:script 阶段进新脚本页(真实脚本编辑 + 生成分镜)。
      setScriptProjectId(project.id);
      setView("script");
      return;
    }
    // capture:进入手动创作流,从其本地恢复列表一键继续(过渡期仍用旧 creation-workbench)。
    setView("creation");
  }

  // 脚本页阶段页签(过渡期):有 storyboard 时,分镜/拍摄进旧 creation-workbench,剪辑载入并进 AI 剪辑。
  async function openScriptStage(stage: "storyboard" | "capture" | "editing") {
    if (stage === "editing") {
      if (!window.desktop || !scriptProjectId || openingProjectId) return;
      setOpeningProjectId(scriptProjectId);
      try {
        const loaded = await window.desktop.loadProject({ projectId: scriptProjectId });
        const workflow = workflowFromLoadedProject(loaded);
        if (!workflow.ok) {
          setMediaFeedback({ ok: false, text: loaded.message ?? "这条项目暂时打不开，稍后再试。" });
          return;
        }
        setCaptureWorkflow(workflow);
        setView("edit");
      } finally {
        setOpeningProjectId(null);
      }
      return;
    }
    // 分镜 / 拍摄:进旧创作流的恢复列表。
    setView("creation");
  }

  return (
    <div className="wb-app">
      <header className="wb-top">
        <div className="wb-brand"><i>原</i><b>原点</b></div>
        <nav className="wb-nav" aria-label="主导航">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? "page" : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="wb-top-r">
          <button
            className="wb-ws"
            onClick={chooseWorkspace}
            title={workspacePath ?? "选择一个本机工作区"}
          >
            {workspaceReady ? "数据在本机" : "选择工作区"}
          </button>
          <button
            className="wb-settings"
            onClick={() => setView("settings")}
            aria-current={view === "settings" ? "page" : undefined}
          >
            设置
          </button>
        </div>
      </header>

      {view === "workbench" ? (
        <Workbench
          workspaceReady={workspaceReady}
          reloadKey={projectsReloadKey}
          onOpenProject={openProject}
          onImportMedia={importMedia}
          onOpenCreation={() => setView("creation")}
          mediaImporting={mediaImporting}
          mediaFeedback={mediaFeedback}
        />
      ) : view === "creation" ? (
        <div className="wb-page">
          <CreationWorkbench
            workspaceReady={workspaceReady}
            chooseWorkspace={chooseWorkspace}
            onWorkflowReady={(workflow) => {
              setCaptureWorkflow(workflow);
              setProjectsReloadKey((key) => key + 1);
            }}
            openEdit={() => setView("edit")}
          />
        </div>
      ) : view === "script" && scriptProjectId ? (
        <ScriptPage
          projectId={scriptProjectId}
          onBackToWorkbench={() => setView("workbench")}
          onOpenStage={openScriptStage}
        />
      ) : view === "edit" ? (
        <div className="wb-page">
          <AiEditWorkbench workflow={captureWorkflow} openProjects={() => setView("creation")} />
        </div>
      ) : view === "topics" ? (
        <div className="wb-page">
          <div className="wb-subtabs" role="tablist" aria-label="选题来源">
            <button role="tab" aria-selected={topicsTab === "radar"} className={topicsTab === "radar" ? "active" : ""} onClick={() => setTopicsTab("radar")}>热点雷达</button>
            <button role="tab" aria-selected={topicsTab === "account"} className={topicsTab === "account" ? "active" : ""} onClick={() => setTopicsTab("account")}>账号雷达</button>
          </div>
          {topicsTab === "radar"
            ? <TopicRadarWorkbench workspacePath={workspacePath} />
            : <AccountRadarWorkbench workspaceReady={workspaceReady} />}
        </div>
      ) : view === "assets" ? (
        <div className="wb-page">
          <AssetLibraryWorkbench workspaceReady={workspaceReady} importMedia={importMedia} />
        </div>
      ) : view === "memory" ? (
        <div className="wb-page">
          <ReviewWorkbench workspaceReady={workspaceReady} />
        </div>
      ) : (
        <div className="wb-page">
          <SettingsWorkbench />
        </div>
      )}
    </div>
  );
}

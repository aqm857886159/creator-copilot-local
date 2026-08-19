import { useEffect, useState } from "react";
import { deriveNextAction } from "../lib/workbench";

// 工作台:首页,回答「接着干哪件」。项目是一张竖片(9:16),标题像抖音封面题字。
// 真实数据来自 window.desktop.listProjects();点击卡片进入对应阶段的现有工作台。
export function Workbench({
  workspaceReady,
  reloadKey,
  onOpenProject,
  onImportMedia,
  onOpenCreation,
  mediaImporting,
  mediaFeedback,
}: {
  workspaceReady: boolean;
  reloadKey: number;
  onOpenProject: (project: ProjectSummaryView) => void;
  onImportMedia: () => void;
  onOpenCreation: () => void;
  mediaImporting: boolean;
  mediaFeedback: { ok: boolean; text: string } | null;
}) {
  const [projects, setProjects] = useState<ProjectSummaryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!workspaceReady || !window.desktop) {
      setProjects([]);
      setLoading(false);
      setError(null);
      return () => { active = false; };
    }
    setLoading(true);
    setError(null);
    window.desktop
      .listProjects()
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setError(result.message ?? "本地项目列表读取失败");
          setProjects([]);
          return;
        }
        setProjects(result.projects ?? []);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "本地项目列表读取失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [workspaceReady, reloadKey]);

  const hasProjects = projects.length > 0;

  return (
    <div className="wb-page">
      <div className="wb-sec">
        <h1>接着做</h1>
        <small>
          {!workspaceReady
            ? "先选一个本机工作区"
            : loading
              ? "正在读取本机项目…"
              : hasProjects
                ? `${projects.length} 个进行中`
                : "还没有进行中的项目"}
        </small>
      </div>

      {error && <div className="wb-error" role="alert">{error}</div>}

      {mediaFeedback && (
        <div className={`wb-toast ${mediaFeedback.ok ? "ok" : "bad"}`} role={mediaFeedback.ok ? "status" : "alert"}>
          {mediaFeedback.text}
        </div>
      )}

      <div className="wb-row">
        {/* 新片卡:永远在第一格 */}
        <div className="wb-proj wb-new">
          <button className="wb-new-main" onClick={onImportMedia} disabled={mediaImporting}>
            <span className="wb-plus" aria-hidden="true">＋</span>
            <p>
              <b>{mediaImporting ? "正在接住素材…" : "拍好了就扔进来"}</b>
              AI 转写、剪掉磕巴和重来，<br />直接给你一版粗剪
            </p>
          </button>
          <button className="wb-alt" onClick={onOpenCreation}>想从头规划一条 →</button>
        </div>

        {workspaceReady && hasProjects
          ? projects.map((project) => {
              const action = deriveNextAction(project);
              return (
                <button className="wb-proj" key={project.id} onClick={() => onOpenProject(project)}>
                  <span className="wb-cover">
                    <span className="wb-tag">{action.stageLabel}</span>
                    <span className="wb-title">{project.title}</span>
                  </span>
                  <span className="wb-meta">
                    <span className="wb-stages">
                      {action.stages.map((cell, index) => (
                        <i
                          key={index}
                          className={cell.state === "done" ? "wb-done" : cell.state === "now" ? "wb-now" : ""}
                        />
                      ))}
                    </span>
                    <span className="wb-next">
                      {action.pulsing && <span className="wb-dot" aria-hidden="true" />}
                      {action.nextLine}
                    </span>
                    <span className="wb-go">{action.actionLabel}</span>
                  </span>
                </button>
              );
            })
          : null}
      </div>

      {workspaceReady && !loading && !hasProjects && !error && (
        <p className="wb-invite">扔一段拍好的素材进来，或者从头规划一条，第一张竖片就会出现在这里。</p>
      )}
    </div>
  );
}

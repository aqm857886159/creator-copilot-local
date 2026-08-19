import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assembleShotsFromPlans,
  durationSecondsLabel,
  durationView,
  estimateBlockMsForDisplay,
  estimateScriptMsForDisplay,
  gateSentence,
  storyboardFreshness,
  kindLabel,
  nextVisualNeed,
  segmentEmphasis,
  visualNeedLabel,
  type ScriptBlockLike,
  type VisualNeed,
} from "../lib/script-page";

// 脚本页 · 切片 2
// 视觉蓝本:docs/design/02-script.html;类名一律 sp- 前缀,颜色只用 tokens.css 令牌。
// 数据:loadProject → script.blocks / estimatedDurationMs;立场卡 = payload.topicId 对应选题 angle;
// payload.visualSuggestions[blockId] → must chip 下 .why 行;payload.shotPlans → 生成分镜。
// 蓝本偏差(计划 §11):右上「让 AI 提结构建议」、立场卡「改立场」两个控件整个不渲染。

type SaveState = "saved" | "saving" | "error";
type StageId = "script" | "storyboard" | "capture" | "editing";

interface ScriptBlockState {
  id: string;
  order: number;
  kind: string;
  text: string;
  emphasis: string[];
  visualNeed: VisualNeed;
}

interface LoadedScript {
  id: string;
  projectId: string;
  revision: number;
  blocks: ScriptBlockState[];
  estimatedDurationMs: number;
}

const AUTOSAVE_DELAY_MS = 800;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// 初始 innerHTML:命中的 emphasis 词包 <mark>,其余转义。只在挂载/换段时写一次,
// 编辑期间不再由 state 覆写(避免 IME 吞字与光标跳动)。
function markedHtml(text: string, emphasis: string[]): string {
  return segmentEmphasis(text, emphasis)
    .map((run) => (run.mark ? `<mark title="AI 标的重点词，口播时加重语气">${escapeHtml(run.text)}</mark>` : escapeHtml(run.text)))
    .join("");
}

// 单段可编辑器:自管 contenteditable ref 与 IME composition 标记。
// 变更(非 composition 期)向上抛,由父组件去抖存盘。
function BlockEditor({
  block,
  onTextChange,
  onFlush,
}: {
  block: ScriptBlockState;
  onTextChange: (id: string, text: string) => void;
  onFlush: () => void;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const composingRef = useRef(false);

  // 只在挂载与 block.id 变化时写入初始 HTML;之后不再从 state 覆写内容。
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = markedHtml(block.text, block.emphasis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  const readText = () => ref.current?.textContent ?? "";

  return (
    <p
      ref={ref}
      className="sp-words"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-label={`第 ${block.order + 1} 段台词`}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        // 组字结束后才算一次真实变更。
        composingRef.current = false;
        onTextChange(block.id, readText());
      }}
      onInput={() => {
        // composition 期间绝不读值、绝不触发存盘。
        if (composingRef.current) return;
        onTextChange(block.id, readText());
      }}
      onBlur={() => {
        if (composingRef.current) return;
        onTextChange(block.id, readText());
        onFlush();
      }}
    />
  );
}

export function ScriptPage({
  projectId,
  onBackToWorkbench,
  onOpenStage,
}: {
  projectId: string;
  onBackToWorkbench: () => void;
  // 过渡期阶段跳转:有数据时进旧视图。无数据的阶段页签 disabled(在本组件内判定)。
  onOpenStage: (stage: "storyboard" | "capture" | "editing") => void;
}) {
  const [title, setTitle] = useState("");
  const [script, setScript] = useState<LoadedScript | null>(null);
  const [stance, setStance] = useState<string | null>(null);
  const [visualSuggestions, setVisualSuggestions] = useState<Record<string, string>>({});
  const [shotPlans, setShotPlans] = useState<unknown>({});
  const [hasStoryboard, setHasStoryboard] = useState(false);
  // 分镜生成时记录的脚本修订号:与当前 revision 对比得出「分镜是否过时」。
  const [storyboardScriptRev, setStoryboardScriptRev] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [generating, setGenerating] = useState(false);
  const [gateFeedback, setGateFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // 去抖存盘计时器与「最新一次要存的脚本」引用(避免闭包读到旧值)。
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scriptRef = useRef<LoadedScript | null>(null);
  const dirtyRef = useRef(false);
  scriptRef.current = script;

  const reload = useCallback(async () => {
    if (!window.desktop) {
      setLoadError("桌面环境不可用");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const loaded = await window.desktop.loadProject({ projectId });
    if (!loaded.ok || !loaded.project || !loaded.script) {
      setLoadError(loaded.message ?? "这条项目暂时打不开，稍后再试。");
      setLoading(false);
      return;
    }
    const payload = loaded.project.payload ?? {};
    setTitle(loaded.project.title);
    setScript({
      id: loaded.script.id,
      projectId: loaded.project.id,
      revision: loaded.script.revision,
      blocks: loaded.script.blocks
        .slice()
        .sort((left, right) => left.order - right.order)
        .map((block) => ({
          id: block.id,
          order: block.order,
          kind: block.kind,
          text: block.text,
          emphasis: block.emphasis ?? [],
          visualNeed: block.visualNeed,
        })),
      estimatedDurationMs: loaded.script.estimatedDurationMs,
    });
    setHasStoryboard(Boolean(loaded.storyboard));
    setStoryboardScriptRev(loaded.storyboard?.scriptRevision ?? null);
    setVisualSuggestions(
      payload.visualSuggestions && typeof payload.visualSuggestions === "object" && !Array.isArray(payload.visualSuggestions)
        ? (payload.visualSuggestions as Record<string, string>)
        : {},
    );
    setShotPlans(payload.shotPlans ?? {});
    setSaveState("saved");
    dirtyRef.current = false;
    setLoading(false);

    // 立场卡:payload.topicId 对应选题的 angle;查不到 → 整卡隐藏,不伪造「已确认」。
    const topicId = typeof payload.topicId === "string" ? payload.topicId : null;
    if (topicId) {
      const topicsResult = await window.desktop.listTopics();
      const topic = topicsResult.ok ? topicsResult.topics?.find((candidate) => candidate.id === topicId) : undefined;
      setStance(topic ? topic.angle : null);
    } else {
      setStance(null);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [reload]);

  // 全量存盘:带期望 revision 乐观锁。成功后 revision+1、重估时长;冲突提示重新载入。
  const persist = useCallback(async () => {
    const current = scriptRef.current;
    if (!current || !window.desktop || !dirtyRef.current) return;
    dirtyRef.current = false;
    setSaveState("saving");
    const result = await window.desktop.updateScript({
      projectId: current.projectId,
      scriptId: current.id,
      expectedRevision: current.revision,
      blocks: current.blocks.map((block) => ({
        id: block.id,
        kind: block.kind as "hook" | "claim" | "evidence" | "example" | "counterpoint" | "transition" | "conclusion" | "cta",
        text: block.text,
        emphasis: block.emphasis,
        visualNeed: block.visualNeed,
      })),
    });
    if (result.ok && result.script) {
      // 用后端回值的 revision/时长刷新,内容不覆写(避免打断正在编辑的 contenteditable)。
      setScript((previous) => (previous ? { ...previous, revision: result.script!.revision, estimatedDurationMs: result.script!.estimatedDurationMs } : previous));
      setSaveState("saved");
      return;
    }
    setSaveState("error");
  }, []);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist();
    }, AUTOSAVE_DELAY_MS);
  }, [persist]);

  const flushSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void persist();
  }, [persist]);

  const handleTextChange = useCallback((id: string, text: string) => {
    setScript((previous) => {
      if (!previous) return previous;
      const blocks = previous.blocks.map((block) => (block.id === id ? { ...block, text } : block));
      // 时长即时重估(与后端共享公式的同构估计),不等存盘往返。
      const estimatedDurationMs = estimateScriptMsForDisplay(blocks.map((item) => item.text));
      return { ...previous, blocks, estimatedDurationMs };
    });
    scheduleSave();
  }, [scheduleSave]);

  const cycleVisualNeed = useCallback((id: string) => {
    setScript((previous) => {
      if (!previous) return previous;
      return { ...previous, blocks: previous.blocks.map((block) => (block.id === id ? { ...block, visualNeed: nextVisualNeed(block.visualNeed) } : block)) };
    });
    scheduleSave();
  }, [scheduleSave]);

  const generateStoryboard = useCallback(async () => {
    const current = scriptRef.current;
    if (!current || !window.desktop || generating) return;
    // 先把未存改动落地,保证分镜基于最新脚本。
    if (dirtyRef.current) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await persist();
    }
    setGenerating(true);
    setGateFeedback(null);
    const blockLikes: ScriptBlockLike[] = current.blocks.map((block) => ({ id: block.id, kind: block.kind, text: block.text, visualNeed: block.visualNeed }));
    const shots = assembleShotsFromPlans(blockLikes, shotPlans);
    const result = await window.desktop.createCaptureWorkflow({
      projectTitle: title,
      existingProjectId: current.projectId,
      existingScriptId: current.id,
      // emphasis 必须随行:create-capture-workflow 会落新脚本修订,不带就会把高亮清掉。
      blocks: current.blocks.map((block) => ({ kind: block.kind as "hook" | "claim" | "evidence" | "example" | "counterpoint" | "transition" | "conclusion" | "cta", text: block.text, emphasis: block.emphasis, visualNeed: block.visualNeed })),
      shots,
    });
    setGenerating(false);
    if (result.ok) {
      setHasStoryboard(true);
      setGateFeedback({ ok: true, text: `分镜已生成，${result.tasks?.length ?? 0} 个拍摄任务已就位。` });
      // 生成分镜会把脚本推进为新 revision(create-capture-workflow 里 revision+1),重载对齐。
      await reload();
      return;
    }
    setGateFeedback({ ok: false, text: result.message ?? "分镜没生成成功，检查每段是否都写了台词后再试。" });
  }, [generating, persist, reload, shotPlans, title]);

  const blockCount = script?.blocks.length ?? 0;
  const duration = useMemo(() => durationView(script?.estimatedDurationMs ?? 0), [script?.estimatedDurationMs]);
  const freshness = storyboardFreshness(script?.revision ?? 0, storyboardScriptRev);

  const saveLabel = saveState === "saving" ? "保存中…" : saveState === "error" ? "保存失败，点击重试" : "刚刚保存";

  // 阶段页签(过渡期):分镜/拍摄需要有 storyboard 才可点;剪辑同理。
  const stages: Array<{ id: StageId; label: string; current?: boolean; enabled: boolean; handoff?: boolean; title?: string }> = [
    { id: "script", label: "脚本", current: true, enabled: true },
    { id: "storyboard", label: "分镜", enabled: hasStoryboard, title: hasStoryboard ? undefined : "先在下方生成分镜，这里才会亮" },
    { id: "capture", label: "拍摄", enabled: hasStoryboard, handoff: true, title: "拍摄不是页面：手机扫码逐镜拍，这里看回流进度" },
    { id: "editing", label: "剪辑", enabled: hasStoryboard, title: hasStoryboard ? undefined : "先生成分镜、拍完素材，才进得了剪辑" },
  ];

  function onStageClick(stage: (typeof stages)[number]) {
    if (stage.current || !stage.enabled) return;
    if (stage.id === "storyboard" || stage.id === "capture") onOpenStage(stage.id === "capture" ? "capture" : "storyboard");
    else if (stage.id === "editing") onOpenStage("editing");
  }

  return (
    <div className="sp-root">
      <header className="sp-top">
        <button className="sp-back" onClick={onBackToWorkbench}>← 工作台</button>
        <span className="sp-ttl" title={title}>{title || "脚本"}</span>
        <nav className="sp-stages" aria-label="阶段">
          {stages.map((stage) => (
            <button
              key={stage.id}
              className={stage.handoff ? "sp-handoff" : undefined}
              aria-current={stage.current ? "page" : undefined}
              disabled={!stage.enabled && !stage.current}
              title={stage.title}
              onClick={() => onStageClick(stage)}
            >
              {stage.label}
            </button>
          ))}
        </nav>
        <div className="sp-top-r">
          <span className={`sp-save sp-save-${saveState}`} role="status" onClick={saveState === "error" ? flushSave : undefined}>
            {saveLabel}
          </span>
        </div>
      </header>

      <main className="sp-page">
        {loading ? (
          <p className="sp-loading">正在读取脚本…</p>
        ) : loadError ? (
          <div className="sp-error" role="alert">{loadError}</div>
        ) : script ? (
          <>
            <div className="sp-head">
              {stance ? (
                <section className="sp-stance">
                  <span className="sp-lb">核心立场 · 已确认</span>
                  <p>{stance}</p>
                </section>
              ) : null}
              <section className="sp-dur">
                <span className="sp-lb">时长</span>
                <span className="sp-v sp-num">
                  预计 {duration.estimatedSeconds}s{duration.targetSeconds ? <i> / 目标 {duration.targetSeconds}s</i> : null}
                </span>
                {typeof duration.ratio === "number" ? <span className="sp-bar"><i style={{ width: `${Math.round(duration.ratio * 100)}%` }} /></span> : null}
              </section>
            </div>

            <section className="sp-doc" aria-label="台词，右边是每段的画面需求">
              <div className="sp-doc-note">台词点进去直接改；右边的画面需求 AI 已标好，点一下换一档</div>

              {script.blocks.map((block) => {
                const why = block.visualNeed === "must_show" ? visualSuggestions[block.id] : undefined;
                return (
                  <div className="sp-blk" key={block.id}>
                    <div className="sp-rail">
                      <span className="sp-kind">{kindLabel(block.kind)}</span>
                      <span className="sp-t sp-num">{durationSecondsLabel(estimateBlockMsForDisplay(block.text))}</span>
                    </div>
                    <BlockEditor block={block} onTextChange={handleTextChange} onFlush={flushSave} />
                    <div className="sp-need">
                      <button
                        className={block.visualNeed === "must_show" ? "sp-chip sp-chip-must" : "sp-chip"}
                        onClick={() => cycleVisualNeed(block.id)}
                      >
                        {visualNeedLabel(block.visualNeed)}
                      </button>
                      {why ? <span className="sp-why">{why}</span> : null}
                    </div>
                  </div>
                );
              })}
            </section>

            <div className="sp-gate">
              <div className="sp-gate-text">
                <p>{gateSentence(blockCount)}</p>
                {freshness === "stale" ? (
                  <p className="sp-gate-warn">台词改过了，现有分镜还是按旧稿出的 —— 重新生成会替换分镜和拍摄任务。</p>
                ) : null}
              </div>
              {gateFeedback ? (
                <span className={gateFeedback.ok ? "sp-gate-note sp-gate-ok" : "sp-gate-note sp-gate-bad"} role={gateFeedback.ok ? "status" : "alert"}>
                  {gateFeedback.text}
                </span>
              ) : null}
              {hasStoryboard ? (
                <>
                  <button className="sp-cta-quiet" onClick={generateStoryboard} disabled={generating} title="会替换现有分镜和拍摄任务">
                    {generating ? "生成中…" : "重新生成分镜"}
                  </button>
                  <button className="sp-cta" onClick={() => onOpenStage("storyboard")}>去分镜看看拍法</button>
                </>
              ) : (
                <button className="sp-cta" onClick={generateStoryboard} disabled={generating}>
                  {generating ? "生成中…" : "生成分镜"}
                </button>
              )}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

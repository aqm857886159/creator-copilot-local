import { describe, expect, it } from "vitest";
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
} from "./script-page";

describe("视觉需求 chip 三档映射与轮换", () => {
  it("三档文案与蓝本一致", () => {
    expect(visualNeedLabel("none")).toBe("不配画面");
    expect(visualNeedLabel("support")).toBe("配画面更好");
    expect(visualNeedLabel("must_show")).toBe("必须配画面");
  });

  it("点击按 none → support → must_show → none 轮换", () => {
    expect(nextVisualNeed("none")).toBe("support");
    expect(nextVisualNeed("support")).toBe("must_show");
    expect(nextVisualNeed("must_show")).toBe("none");
    // 轮一整圈回到原点
    expect(nextVisualNeed(nextVisualNeed(nextVisualNeed("none")))).toBe("none");
  });

  it("三档文案都是三个之一(供 UI 断言)", () => {
    for (const need of ["none", "support", "must_show"] as const) {
      expect(["不配画面", "配画面更好", "必须配画面"]).toContain(visualNeedLabel(need));
    }
  });
});

describe("emphasis 高亮切段", () => {
  it("命中的完整子串被标记,其余为普通 run", () => {
    const runs = segmentEmphasis("越努力越没有记忆点", ["记忆点"]);
    expect(runs).toEqual([
      { text: "越努力越没有", mark: false },
      { text: "记忆点", mark: true },
    ]);
  });

  it("同一个词多次出现,每次都标", () => {
    const runs = segmentEmphasis("画面，还是画面", ["画面"]);
    expect(runs.filter((run) => run.mark).map((run) => run.text)).toEqual(["画面", "画面"]);
    // 拼回原文无损
    expect(runs.map((run) => run.text).join("")).toBe("画面，还是画面");
  });

  it("重叠词:合并为一个连续高亮区间,不重复包裹", () => {
    // "abcd" 里 "abc" 与 "bcd" 重叠 → 合并成整段 "abcd"
    const runs = segmentEmphasis("abcd", ["abc", "bcd"]);
    expect(runs).toEqual([{ text: "abcd", mark: true }]);
  });

  it("相邻词:端点相接也合并成一段", () => {
    const runs = segmentEmphasis("abcd", ["ab", "cd"]);
    expect(runs).toEqual([{ text: "abcd", mark: true }]);
  });

  it("匹配不到的词不硬造高亮", () => {
    const runs = segmentEmphasis("已经改了文案", ["记忆点"]);
    expect(runs).toEqual([{ text: "已经改了文案", mark: false }]);
  });

  it("空 emphasis 数组:整段一条普通 run", () => {
    expect(segmentEmphasis("一句台词", [])).toEqual([{ text: "一句台词", mark: false }]);
  });

  it("空字符串词与空文本:不崩,给合理结果", () => {
    expect(segmentEmphasis("有文本", [""])).toEqual([{ text: "有文本", mark: false }]);
    expect(segmentEmphasis("", ["任何词"])).toEqual([]);
  });

  it("拼回原文始终无损(重叠 + 命中 + 未命中混合)", () => {
    const text = "先想清楚要证明什么，再决定拍什么";
    const runs = segmentEmphasis(text, ["证明什么", "拍什么", "不存在的"]);
    expect(runs.map((run) => run.text).join("")).toBe(text);
    expect(runs.filter((run) => run.mark).map((run) => run.text)).toEqual(["证明什么", "拍什么"]);
  });
});

describe("闸门句自适应(例外恒 0)", () => {
  it("「N 段的…已全部标好」防歧义,不出现「等你拿主意」", () => {
    const sentence = gateSentence(6);
    expect(sentence).toContain("6 段的画面需求已全部标好");
    expect(sentence).not.toContain("拿主意");
    expect(sentence).not.toMatch(/\d+\s*段等你/);
    // UI 文案全角标点,不许混入半角逗号
    expect(sentence).not.toContain(",");
  });
});

describe("分镜新鲜度", () => {
  it("没有分镜 → none;修订一致 → fresh;脚本更新后 → stale", () => {
    expect(storyboardFreshness(3, null)).toBe("none");
    expect(storyboardFreshness(3, 3)).toBe("fresh");
    expect(storyboardFreshness(4, 3)).toBe("stale");
  });
});

describe("时长与轨道标注", () => {
  it("秒标注四舍五入,至少 1 秒", () => {
    expect(durationSecondsLabel(6_200)).toBe("~6s");
    expect(durationSecondsLabel(300)).toBe("~1s");
    expect(durationSecondsLabel(0)).toBe("~1s");
  });

  it("时长卡:预计秒数与进度比封顶 100%", () => {
    const view = durationView(46_000, 60);
    expect(view.estimatedSeconds).toBe(46);
    expect(view.targetSeconds).toBe(60);
    expect(view.ratio).toBeCloseTo(46 / 60, 5);
    // 超过目标封顶 1
    expect(durationView(90_000, 60).ratio).toBe(1);
  });

  it("没有目标时长:只给预计,不伪造目标与进度", () => {
    const view = durationView(19_000);
    expect(view.estimatedSeconds).toBe(19);
    expect(view.targetSeconds).toBeUndefined();
    expect(view.ratio).toBeUndefined();
  });

  it("显示估计公式与后端同构:260ms/字,1500ms 底垫", () => {
    expect(estimateBlockMsForDisplay("一二三四五六")).toBe(1_560);
    expect(estimateBlockMsForDisplay("短")).toBe(1_500);
    expect(estimateScriptMsForDisplay(["一二三四五六", "短"])).toBe(3_060);
  });

  it("kind 短标映射,未知 kind 原样返回", () => {
    expect(kindLabel("hook")).toBe("开头");
    expect(kindLabel("cta")).toBe("号召");
    expect(kindLabel("mystery")).toBe("mystery");
  });
});

describe("生成分镜:从 shotPlans 组装(与旧流同源)", () => {
  const blocks: ScriptBlockLike[] = [
    { id: "b1", kind: "hook", text: "为什么越努力越没记忆点？", visualNeed: "must_show" },
    { id: "b2", kind: "claim", text: "因为没有画面变化。", visualNeed: "none" },
    { id: "b3", kind: "evidence", text: "让观众看见桌面草稿。", visualNeed: "support" },
  ];

  it("每段一条口播主干;visualNeed≠none 的段补一条补充画面", () => {
    const shots = assembleShotsFromPlans(blocks, {});
    // b1(must_show)与 b3(support)各 2 条,b2(none)只 1 条 → 共 5 条
    expect(shots).toHaveLength(5);
    const primaries = shots.filter((shot) => shot.mode === "talking_head");
    expect(primaries).toHaveLength(3);
    // 每段都有且仅有一条口播主干
    expect(primaries.map((shot) => shot.scriptBlockIndex)).toEqual([0, 1, 2]);
    // none 段不补充画面
    expect(shots.filter((shot) => shot.scriptBlockIndex === 1)).toHaveLength(1);
    // 覆盖校验会要求补充镜头 mode≠talking_head
    for (const block of blocks) {
      const index = blocks.indexOf(block);
      const blockShots = shots.filter((shot) => shot.scriptBlockIndex === index);
      if (block.visualNeed !== "none") expect(blockShots.some((shot) => shot.mode !== "talking_head")).toBe(true);
    }
  });

  it("shotPlans 里给了非口播模式,即使 visualNeed=none 也补一条", () => {
    const shots = assembleShotsFromPlans(
      [{ id: "b2", kind: "claim", text: "只讲判断。", visualNeed: "none" }],
      { b2: { mode: "screen_recording", targetMs: 5_000 } },
    );
    expect(shots).toHaveLength(2);
    const supplemental = shots.find((shot) => shot.mode !== "talking_head");
    expect(supplemental?.mode).toBe("screen_recording");
    // 补充画面时长封顶 3s
    expect(supplemental?.targetMs).toBe(3_000);
    // 录屏走 screen 设备
    expect(supplemental?.deviceHint).toBe("screen");
  });

  it("shotPlans 为空/非对象:退化为默认组装,不崩", () => {
    expect(assembleShotsFromPlans(blocks, undefined)).toHaveLength(5);
    expect(assembleShotsFromPlans(blocks, null)).toHaveLength(5);
    expect(assembleShotsFromPlans(blocks, [1, 2, 3])).toHaveLength(5);
  });

  it("generated_asset 来源:不补现场拍摄的补充画面", () => {
    const shots = assembleShotsFromPlans(
      [{ id: "b1", kind: "evidence", text: "证据段。", visualNeed: "must_show" }],
      { b1: { sourceRequirement: "generated_asset" } },
    );
    // must_show 但来源是生成素材 → 只保留口播主干,不生成 shoot_task 补充镜头
    expect(shots).toHaveLength(1);
    expect(shots[0].mode).toBe("talking_head");
  });
});

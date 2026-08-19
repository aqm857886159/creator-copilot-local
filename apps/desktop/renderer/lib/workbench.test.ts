import { describe, expect, it } from "vitest";
import { deriveNextAction } from "./workbench";

describe("deriveNextAction", () => {
  it("script 阶段:第一段亮起,继续写脚本,不亮红点", () => {
    const action = deriveNextAction({ stage: "script", title: "先讲结论还是先讲故事？" });
    expect(action.stageLabel).toBe("脚本中");
    expect(action.actionLabel).toBe("继续写脚本");
    expect(action.target).toBe("script");
    expect(action.pulsing).toBe(false);
    expect(action.stages.map((cell) => cell.state)).toEqual(["now", "todo", "todo", "todo", "todo"]);
  });

  it("capture 阶段:前一段完成、当前点亮,看拍摄进度", () => {
    const action = deriveNextAction({ stage: "capture", title: "素材库不是仓库" });
    expect(action.stageLabel).toBe("拍摄中");
    expect(action.actionLabel).toBe("看拍摄进度");
    expect(action.target).toBe("capture");
    expect(action.stages.map((cell) => cell.state)).toEqual(["done", "now", "todo", "todo", "todo"]);
  });

  it("editing 阶段:继续剪辑,文案据阶段推进后已存粗剪(可回读)措辞,红点不亮", () => {
    const action = deriveNextAction({ stage: "editing", title: "越努力越没记忆点？" });
    expect(action.stageLabel).toBe("剪辑中");
    expect(action.actionLabel).toBe("继续剪辑");
    expect(action.target).toBe("editing");
    expect(action.nextLine).toBe("粗剪已备好，点开过一遍就能出片");
    expect(action.pulsing).toBe(false);
    expect(action.stages.map((cell) => cell.state)).toEqual(["done", "done", "now", "todo", "todo"]);
  });

  it("rendered 阶段:去发布", () => {
    const action = deriveNextAction({ stage: "rendered", title: "一条已经出片的项目" });
    expect(action.stageLabel).toBe("已出片");
    expect(action.actionLabel).toBe("去发布");
    expect(action.target).toBe("rendered");
    expect(action.stages.map((cell) => cell.state)).toEqual(["done", "done", "done", "now", "todo"]);
  });

  it("published 阶段:五段全亮到末段,看数据", () => {
    const action = deriveNextAction({ stage: "published", title: "已经发出去的项目" });
    expect(action.stageLabel).toBe("已发布");
    expect(action.actionLabel).toBe("看数据");
    expect(action.target).toBe("published");
    expect(action.stages.map((cell) => cell.state)).toEqual(["done", "done", "done", "done", "now"]);
  });

  it("未知 stage:兜底为整理中,不亮红点,不崩", () => {
    const action = deriveNextAction({ stage: "archived_unknown", title: "阶段枚举之外" });
    expect(action.stageLabel).toBe("整理中");
    expect(action.actionLabel).toBe("打开看看");
    expect(action.target).toBe("script");
    expect(action.pulsing).toBe(false);
    expect(action.stages.map((cell) => cell.state)).toEqual(["todo", "todo", "todo", "todo", "todo"]);
  });
});

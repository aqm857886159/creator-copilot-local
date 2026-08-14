import { describe, expect, it } from "vitest";
import { TopicSchema, createTopic } from "./index";

describe("Topic", () => {
  it("keeps a research opportunity as an evidence-linked candidate", () => {
    const topic = createTopic({
      id: "topic-1",
      workspaceId: "workspace-1",
      title: "把复杂观点讲成具体案例",
      audienceProblem: "观众想理解复杂观点，但缺少可验证的例子。",
      thesis: "用一个真实案例解释抽象判断。",
      angle: "先讲改变想法的瞬间，再展开判断。",
      evidenceIds: ["evidence-1"],
      benchmarkVideoIds: ["aweme-1"],
      visualOpportunities: ["展示案例中的原始材料"],
      riskNotes: ["对标样本只提供参考，不构成因果结论。"],
      source: { kind: "account_research", reportId: "report-1", opportunityId: "opportunity-1" },
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    });
    expect(TopicSchema.parse(topic)).toMatchObject({ status: "candidate", revision: 1, source: { reportId: "report-1" } });
  });

  it("rejects an invalid lifecycle status", () => {
    expect(() => TopicSchema.parse({
      schemaVersion: 1,
      id: "topic-1",
      workspaceId: "workspace-1",
      title: "无效",
      audienceProblem: "问题",
      thesis: "判断",
      angle: "角度",
      evidenceIds: [],
      benchmarkVideoIds: [],
      visualOpportunities: [],
      riskNotes: [],
      source: { kind: "topic_radar", reportId: "report-1", opportunityId: "opportunity-1" },
      status: "unknown",
      revision: 1,
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    })).toThrow();
  });
});

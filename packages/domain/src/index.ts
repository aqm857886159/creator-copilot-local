import { z } from "zod";

const id = z.string().min(1);
const isoDate = z.string().datetime({ offset: true });

export const TopicStatusSchema = z.enum(["candidate", "selected", "in_progress", "used", "archived"]);
export type TopicStatus = z.infer<typeof TopicStatusSchema>;

export const TopicSourceSchema = z.object({
  kind: z.enum(["account_research", "topic_radar"]),
  reportId: id,
  opportunityId: id,
}).strict();
export type TopicSource = z.infer<typeof TopicSourceSchema>;

/** A reviewable content direction; it is not a generated title. */
export const TopicSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  workspaceId: id,
  title: z.string().min(1).max(200),
  audienceProblem: z.string().min(1).max(500),
  thesis: z.string().min(1).max(500),
  angle: z.string().min(1).max(500),
  evidenceIds: z.array(id).max(30),
  benchmarkVideoIds: z.array(id).max(30),
  visualOpportunities: z.array(z.string().min(1).max(300)).max(20),
  riskNotes: z.array(z.string().min(1).max(500)).max(20),
  score: z.object({ value: z.number().min(0).max(1), rationale: z.string().min(1).max(300) }).strict().optional(),
  source: TopicSourceSchema,
  status: TopicStatusSchema,
  revision: z.number().int().positive(),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Topic = z.infer<typeof TopicSchema>;

export function createTopic(input: Omit<Topic, "schemaVersion" | "revision" | "status"> & { revision?: number; status?: TopicStatus }) {
  return TopicSchema.parse({ ...input, schemaVersion: 1, revision: input.revision ?? 1, status: input.status ?? "candidate" });
}

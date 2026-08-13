import { z } from "zod";

const id = z.string().min(1);
const isoDate = z.string().datetime({ offset: true });

export const CommandTargetSchema = z
  .object({
    type: id,
    id,
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();

export const ActorSchema = z
  .object({
    type: z.enum(["user", "agent", "mcp", "system", "provider"]),
    id,
    sessionId: id.optional(),
    permissionSnapshot: id.optional(),
  })
  .strict();

export const CommandEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    commandId: id,
    name: id,
    target: CommandTargetSchema,
    actor: ActorSchema,
    idempotencyKey: id,
    idempotencyScope: id,
    correlationId: id,
    causationId: id.optional(),
    deadlineAt: isoDate.optional(),
    input: z.record(z.unknown()),
    sourceRunId: id.optional(),
  })
  .strict();

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

/** Deterministic encoding for idempotency and replay comparisons. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const encode = (input: unknown): string => {
    if (input === null) return "null";
    if (input === undefined) throw new Error("命令输入不能包含 undefined");
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error("命令输入不能包含非有限数字");
      return JSON.stringify(input);
    }
    if (typeof input === "string" || typeof input === "boolean") return JSON.stringify(input);
    if (input instanceof Date) return JSON.stringify(input.toISOString());
    if (typeof input !== "object") throw new Error("命令输入必须是 JSON-safe 值");
    if (seen.has(input)) throw new Error("命令输入不能包含循环引用");
    seen.add(input);
    if (Array.isArray(input)) {
      const output = `[${input.map(encode).join(",")}]`;
      seen.delete(input);
      return output;
    }
    const record = input as Record<string, unknown>;
    const output = `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${encode(record[key])}`).join(",")}}`;
    seen.delete(input);
    return output;
  };
  return encode(value);
}

export const CommandReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    commandId: id,
    correlationId: id,
    status: z.enum(["accepted", "rejected", "pending", "duplicate", "conflict"]),
    target: CommandTargetSchema,
    newRevision: z.number().int().nonnegative().optional(),
    eventIds: z.array(id),
    jobIds: z.array(id),
    artifactIds: z.array(id),
    approvalRequired: z.boolean(),
    errorCode: id.optional(),
    errorDetails: z.record(z.unknown()).optional(),
  })
  .strict();

export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;

export const JobStateSchema = z.enum([
  "queued",
  "claimed",
  "running",
  "retry_wait",
  "succeeded",
  "cancelled",
  "timed_out",
  "submission_unknown",
  "needs_attention",
  "failed",
]);

export type JobState = z.infer<typeof JobStateSchema>;

export const JobRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: id,
    kind: id,
    inputHash: id,
    state: JobStateSchema,
    attempt: z.number().int().nonnegative(),
    idempotencyKey: id,
    idempotencyScope: id,
    providerKey: id.optional(),
    externalJobId: id.optional(),
    workerId: id.optional(),
    leaseToken: id.optional(),
    leaseExpiresAt: isoDate.optional(),
    heartbeatAt: isoDate.optional(),
    retryAfter: isoDate.optional(),
    checkpoint: z.record(z.unknown()).optional(),
    sourceRunId: id.optional(),
    correlationId: id,
    artifactIds: z.array(id),
    lastError: z
      .object({ code: id, message: id, retryable: z.boolean() })
      .strict()
      .optional(),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();

export type JobRecord = z.infer<typeof JobRecordSchema>;

export const ArtifactManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    artifactId: id,
    workspaceId: id,
    kind: id,
    relativePath: z
      .string()
      .min(1)
      .refine((value) => !value.startsWith("/") && !value.startsWith("\\") && !/^[A-Za-z]:[\\/]/.test(value) && !/^[A-Za-z]:/.test(value), "必须是工作区相对路径")
      .refine((value) => !value.split(/[\\/]+/).includes(".."), "路径不能越过工作区")
      .refine((value) => !value.includes("\0"), "路径不能包含空字节"),
    mimeType: id,
    contentHash: id,
    byteSize: z.number().int().nonnegative(),
    parentArtifactIds: z.array(id),
    sourceRevision: z.number().int().nonnegative().optional(),
    validationStatus: z.enum(["pending", "valid", "invalid"]),
  })
  .strict();

export type ArtifactManifest = z.infer<typeof ArtifactManifestSchema>;

const transitionTable: Record<JobState, readonly JobState[]> = {
  queued: ["claimed", "cancelled"],
  claimed: ["running", "queued", "cancelled", "timed_out"],
  running: ["succeeded", "retry_wait", "cancelled", "timed_out", "submission_unknown", "needs_attention", "failed"],
  retry_wait: ["queued", "cancelled", "failed"],
  succeeded: [],
  cancelled: [],
  timed_out: ["retry_wait", "needs_attention"],
  submission_unknown: ["needs_attention"],
  needs_attention: ["queued", "cancelled", "failed"],
  failed: ["retry_wait", "needs_attention"],
};

export function canTransitionJob(from: JobState, to: JobState) {
  return transitionTable[from].includes(to);
}

export function assertJobTransition(from: JobState, to: JobState) {
  if (!canTransitionJob(from, to)) {
    throw new Error(`非法任务状态迁移：${from} → ${to}`);
  }
}

export function isSafeWorkspaceRelativePath(value: string) {
  return ArtifactManifestSchema.shape.relativePath.safeParse(value).success && !value.startsWith("\\");
}

export type CommandHandler = (command: CommandEnvelope) => Promise<CommandReceipt> | CommandReceipt;

export class InMemoryCommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>();
  private readonly receipts = new Map<string, { inputHash: string; receipt: CommandReceipt }>();
  private readonly inFlight = new Map<string, { inputHash: string; promise: Promise<CommandReceipt> }>();

  register(name: string, handler: CommandHandler) {
    if (this.handlers.has(name)) throw new Error(`命令已注册：${name}`);
    this.handlers.set(name, handler);
  }

  async execute(raw: unknown): Promise<CommandReceipt> {
    const command = CommandEnvelopeSchema.parse(raw);
    const key = `${command.idempotencyScope}:${command.idempotencyKey}`;
    const inputHash = stableStringify({ actor: command.actor, name: command.name, target: command.target, input: command.input });
    const previous = this.receipts.get(key);
    if (previous) {
      if (previous.inputHash !== inputHash) throw new Error("幂等键对应了不同的命令输入");
      return { ...previous.receipt, status: "duplicate" };
    }
    const running = this.inFlight.get(key);
    if (running) {
      if (running.inputHash !== inputHash) throw new Error("幂等键对应了不同的命令输入");
      return { ...(await running.promise), status: "duplicate" };
    }
    const handler = this.handlers.get(command.name);
    if (!handler) throw new Error(`未注册的命令：${command.name}`);
    const execution = (async () => {
      const receipt = CommandReceiptSchema.parse(await handler(command));
      if (receipt.commandId !== command.commandId || receipt.correlationId !== command.correlationId || stableStringify(receipt.target) !== stableStringify(command.target)) {
        throw new Error("命令回执与请求的 commandId/correlationId 不一致");
      }
      this.receipts.set(key, { inputHash, receipt });
      return receipt;
    })();
    this.inFlight.set(key, { inputHash, promise: execution });
    try {
      return await execution;
    } finally {
      this.inFlight.delete(key);
    }
  }
}

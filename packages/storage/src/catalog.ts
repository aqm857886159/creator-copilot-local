import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import Database from "better-sqlite3";
import {
  ArtifactManifestSchema,
  CommandEnvelopeSchema,
  CommandReceiptSchema,
  JobRecordSchema,
  assertJobTransition,
  stableStringify,
  type ArtifactManifest,
  type CommandEnvelope,
  type CommandReceipt,
  type JobRecord,
  type JobState,
} from "../../contracts/src/index.js";
import {
  CapturePackageSchema,
  ScriptSchema,
  ShootTaskSchema,
  StoryboardSchema,
  TakeSchema,
  attachTake,
  selectTake,
  type CapturePackage,
  type Script,
  type ShootTask,
  type Storyboard,
  type Take,
} from "../../creation/src/index.js";

const CURRENT_SCHEMA_VERSION = 3;

type WorkspaceRecord = {
  id: string;
  name: string;
  rootPath: string;
  schemaVersion: number;
  defaultLocale: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectRecord = {
  id: string;
  workspaceId: string;
  title: string;
  stage: string;
  revision: number;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type StoredReceipt = {
  idempotencyScope: string;
  idempotencyKey: string;
  inputHash: string;
  receipt: CommandReceipt;
};

export type DomainEventRecord = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  aggregateRevision: number;
  type: string;
  payload: Record<string, unknown>;
  actorType: "user" | "agent" | "system" | "provider";
  idempotencyKey?: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
};

export type OutboxRecord = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  idempotencyScope: string;
  state: "queued" | "claimed" | "sent" | "failed";
  attempt: number;
  workerId?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CommandExecution = {
  receipt: CommandReceipt;
  events?: DomainEventRecord[];
  outbox?: OutboxRecord[];
};

const migrations: Record<number, string> = {
  1: `
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      default_locale TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      stage TEXT NOT NULL,
      revision INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects(workspace_id);

    CREATE TABLE IF NOT EXISTS command_receipts (
      idempotency_scope TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (idempotency_scope, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS domain_events (
      id TEXT PRIMARY KEY NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      aggregate_revision INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      idempotency_key TEXT,
      correlation_id TEXT NOT NULL,
      causation_id TEXT,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS domain_events_aggregate_idx
      ON domain_events(aggregate_type, aggregate_id, aggregate_revision);

    CREATE TABLE IF NOT EXISTS outbox_messages (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      idempotency_scope TEXT NOT NULL,
      state TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      worker_id TEXT,
      lease_token TEXT,
      lease_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (idempotency_scope, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS outbox_state_idx ON outbox_messages(state, lease_expires_at);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      state TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      idempotency_scope TEXT NOT NULL,
      provider_key TEXT,
      external_job_id TEXT,
      worker_id TEXT,
      lease_expires_at TEXT,
      heartbeat_at TEXT,
      retry_after TEXT,
      checkpoint_json TEXT,
      source_run_id TEXT,
      correlation_id TEXT NOT NULL,
      artifact_ids_json TEXT NOT NULL,
      last_error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (idempotency_scope, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS jobs_state_idx ON jobs(state, retry_after);

    CREATE TABLE IF NOT EXISTS artifacts (
      artifact_id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      parent_artifact_ids_json TEXT NOT NULL,
      source_revision INTEGER,
      validation_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, relative_path)
    );
  `,
  2: `
    CREATE TABLE IF NOT EXISTS outbox_messages (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      idempotency_scope TEXT NOT NULL,
      state TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      worker_id TEXT,
      lease_token TEXT,
      lease_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (idempotency_scope, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS outbox_state_idx ON outbox_messages(state, lease_expires_at);
  `,
  3: `
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL CHECK (revision > 0),
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS scripts_project_idx ON scripts(project_id, updated_at);

    CREATE TABLE IF NOT EXISTS storyboards (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE RESTRICT,
      script_revision INTEGER NOT NULL CHECK (script_revision > 0),
      revision INTEGER NOT NULL CHECK (revision > 0),
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS storyboards_project_idx ON storyboards(project_id, updated_at);

    CREATE TABLE IF NOT EXISTS shoot_tasks (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      shot_id TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS shoot_tasks_project_idx ON shoot_tasks(project_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS shoot_tasks_shot_idx ON shoot_tasks(shot_id);

    CREATE TABLE IF NOT EXISTS capture_packages (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      storyboard_revision INTEGER NOT NULL CHECK (storyboard_revision > 0),
      status TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS capture_packages_project_idx ON capture_packages(project_id, updated_at);

    CREATE TABLE IF NOT EXISTS takes (
      id TEXT PRIMARY KEY NOT NULL,
      shoot_task_id TEXT NOT NULL REFERENCES shoot_tasks(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE RESTRICT,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS takes_task_idx ON takes(shoot_task_id, status, created_at);
  `,
};

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`无法解析 ${label}`);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function toStoredJob(job: JobRecord) {
  return {
    id: job.id,
    kind: job.kind,
    inputHash: job.inputHash,
    state: job.state,
    attempt: job.attempt,
    idempotencyKey: job.idempotencyKey,
    idempotencyScope: job.idempotencyScope,
    providerKey: job.providerKey ?? null,
    externalJobId: job.externalJobId ?? null,
    workerId: job.workerId ?? null,
    leaseToken: job.leaseToken ?? null,
    leaseExpiresAt: job.leaseExpiresAt ?? null,
    heartbeatAt: job.heartbeatAt ?? null,
    retryAfter: job.retryAfter ?? null,
    checkpointJson: job.checkpoint ? JSON.stringify(job.checkpoint) : null,
    sourceRunId: job.sourceRunId ?? null,
    correlationId: job.correlationId,
    artifactIdsJson: JSON.stringify(job.artifactIds),
    lastErrorJson: job.lastError ? JSON.stringify(job.lastError) : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function fromStoredJob(row: Record<string, unknown>): JobRecord {
  return JobRecordSchema.parse({
    schemaVersion: 1,
    id: row.id,
    kind: row.kind,
    inputHash: row.input_hash,
    state: row.state,
    attempt: row.attempt,
    idempotencyKey: row.idempotency_key,
    idempotencyScope: row.idempotency_scope,
    providerKey: row.provider_key ?? undefined,
    externalJobId: row.external_job_id ?? undefined,
    workerId: row.worker_id ?? undefined,
    leaseToken: row.lease_token ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    heartbeatAt: row.heartbeat_at ?? undefined,
    retryAfter: row.retry_after ?? undefined,
    checkpoint: row.checkpoint_json ? parseJson(row.checkpoint_json as string, "job checkpoint") : undefined,
    sourceRunId: row.source_run_id ?? undefined,
    correlationId: row.correlation_id,
    artifactIds: parseJson<string[]>(row.artifact_ids_json as string, "job artifacts"),
    lastError: row.last_error_json ? parseJson(row.last_error_json as string, "job error") : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class SqliteCatalog {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path, { timeout: 5000 });
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.migrate();
  }

  close() {
    this.db.pragma("wal_checkpoint(TRUNCATE)");
    this.db.close();
  }

  migrate() {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
    const row = this.db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value?: string } | undefined;
    const current = Number(row?.value ?? 0);
    if (!Number.isInteger(current) || current > CURRENT_SCHEMA_VERSION) {
      throw new Error(`不支持的数据库 schema 版本：${current}`);
    }
    const apply = this.db.transaction(() => {
      for (let version = current + 1; version <= CURRENT_SCHEMA_VERSION; version += 1) {
        this.db.exec(migrations[version]);
        if (version === 2) {
          const jobColumns = this.db.pragma("table_info(jobs)") as Array<{ name: string }>;
          if (!jobColumns.some((column) => column.name === "lease_token")) {
            this.db.exec("ALTER TABLE jobs ADD COLUMN lease_token TEXT");
          }
          const outboxColumns = this.db.pragma("table_info(outbox_messages)") as Array<{ name: string }>;
          if (!outboxColumns.some((column) => column.name === "lease_token")) {
            this.db.exec("ALTER TABLE outbox_messages ADD COLUMN lease_token TEXT");
          }
        }
        this.db.prepare("INSERT INTO schema_meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(version));
      }
    });
    apply();
  }

  schemaVersion() {
    const row = this.db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value: string };
    return Number(row.value);
  }

  createWorkspace(workspace: WorkspaceRecord) {
    if (!isAbsolute(workspace.rootPath)) throw new Error("工作区根目录必须是绝对路径");
    const requestedRoot = resolve(workspace.rootPath);
    if (!existsSync(requestedRoot) || !statSync(requestedRoot).isDirectory()) throw new Error("工作区根目录必须是已存在的目录");
    workspace = { ...workspace, rootPath: realpathSync(requestedRoot) };
    this.db.prepare(`INSERT INTO workspaces(id, name, root_path, schema_version, default_locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(workspace.id, workspace.name, workspace.rootPath, workspace.schemaVersion, workspace.defaultLocale, workspace.createdAt, workspace.updatedAt);
  }

  getWorkspace(id: string): WorkspaceRecord | undefined {
    return this.db.prepare(`SELECT id, name, root_path AS rootPath, schema_version AS schemaVersion, default_locale AS defaultLocale, created_at AS createdAt, updated_at AS updatedAt FROM workspaces WHERE id = ?`).get(id) as WorkspaceRecord | undefined;
  }

  createProject(project: ProjectRecord) {
    this.db.prepare(`INSERT INTO projects(id, workspace_id, title, stage, revision, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(project.id, project.workspaceId, project.title, project.stage, project.revision, JSON.stringify(project.payload), project.createdAt, project.updatedAt);
  }

  getProject(id: string): ProjectRecord | undefined {
    const row = this.db.prepare(`SELECT id, workspace_id AS workspaceId, title, stage, revision, payload_json, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE id = ?`).get(id) as (Omit<ProjectRecord, "payload"> & { payload_json: string }) | undefined;
    if (!row) return undefined;
    return { ...row, payload: parseJson(row.payload_json, "project payload") } as ProjectRecord;
  }

  updateProject(id: string, expectedRevision: number, patch: { title?: string; stage?: string; payload?: Record<string, unknown> }) {
    const current = this.getProject(id);
    if (!current || current.revision !== expectedRevision) return false;
    const next = {
      title: patch.title ?? current.title,
      stage: patch.stage ?? current.stage,
      payload: patch.payload ?? current.payload,
      revision: current.revision + 1,
      updatedAt: nowIso(),
    };
    const result = this.db.prepare(`UPDATE projects SET title = ?, stage = ?, revision = ?, payload_json = ?, updated_at = ? WHERE id = ? AND revision = ?`)
      .run(next.title, next.stage, next.revision, JSON.stringify(next.payload), next.updatedAt, id, expectedRevision);
    return result.changes === 1;
  }

  saveScript(raw: Script) {
    const script = ScriptSchema.parse(raw);
    const current = this.db.prepare("SELECT revision FROM scripts WHERE id = ?").get(script.id) as { revision: number } | undefined;
    if (!current) {
      if (script.revision !== 1) return false;
      this.db.prepare("INSERT INTO scripts(id, project_id, revision, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(script.id, script.projectId, script.revision, script.status, JSON.stringify(script), script.createdAt, script.updatedAt);
      return true;
    }
    if (script.revision !== current.revision + 1) return false;
    const result = this.db.prepare("UPDATE scripts SET revision = ?, status = ?, payload_json = ?, updated_at = ? WHERE id = ? AND revision = ?")
      .run(script.revision, script.status, JSON.stringify(script), script.updatedAt, script.id, current.revision);
    return result.changes === 1;
  }

  getScript(id: string): Script | undefined {
    const row = this.db.prepare("SELECT payload_json FROM scripts WHERE id = ?").get(id) as { payload_json: string } | undefined;
    return row ? ScriptSchema.parse(parseJson(row.payload_json, "script")) : undefined;
  }

  saveStoryboard(raw: Storyboard) {
    const storyboard = StoryboardSchema.parse(raw);
    const current = this.db.prepare("SELECT revision FROM storyboards WHERE id = ?").get(storyboard.id) as { revision: number } | undefined;
    if (!current) {
      if (storyboard.revision !== 1) return false;
      this.db.prepare("INSERT INTO storyboards(id, project_id, script_id, script_revision, revision, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(storyboard.id, storyboard.projectId, storyboard.scriptId, storyboard.scriptRevision, storyboard.revision, storyboard.status, JSON.stringify(storyboard), storyboard.createdAt, storyboard.updatedAt);
      return true;
    }
    if (storyboard.revision !== current.revision + 1) return false;
    const result = this.db.prepare("UPDATE storyboards SET script_id = ?, script_revision = ?, revision = ?, status = ?, payload_json = ?, updated_at = ? WHERE id = ? AND revision = ?")
      .run(storyboard.scriptId, storyboard.scriptRevision, storyboard.revision, storyboard.status, JSON.stringify(storyboard), storyboard.updatedAt, storyboard.id, current.revision);
    return result.changes === 1;
  }

  getStoryboard(id: string): Storyboard | undefined {
    const row = this.db.prepare("SELECT payload_json FROM storyboards WHERE id = ?").get(id) as { payload_json: string } | undefined;
    return row ? StoryboardSchema.parse(parseJson(row.payload_json, "storyboard")) : undefined;
  }

  saveShootTask(raw: ShootTask) {
    const task = ShootTaskSchema.parse(raw);
    this.db.prepare(`INSERT INTO shoot_tasks(id, project_id, shot_id, status, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, payload_json = excluded.payload_json, updated_at = excluded.updated_at`)
      .run(task.id, task.projectId, task.shotId, task.status, JSON.stringify(task), task.createdAt, task.updatedAt);
    return task;
  }

  getShootTask(id: string): ShootTask | undefined {
    const row = this.db.prepare("SELECT payload_json FROM shoot_tasks WHERE id = ?").get(id) as { payload_json: string } | undefined;
    return row ? ShootTaskSchema.parse(parseJson(row.payload_json, "shoot task")) : undefined;
  }

  saveCapturePackage(raw: CapturePackage) {
    const capturePackage = CapturePackageSchema.parse(raw);
    this.db.prepare(`INSERT INTO capture_packages(id, project_id, storyboard_revision, status, relative_path, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET storyboard_revision = excluded.storyboard_revision, status = excluded.status, relative_path = excluded.relative_path, payload_json = excluded.payload_json, updated_at = excluded.updated_at`)
      .run(capturePackage.id, capturePackage.projectId, capturePackage.storyboardRevision, capturePackage.status, capturePackage.relativePath, JSON.stringify(capturePackage), capturePackage.createdAt, capturePackage.updatedAt);
    return capturePackage;
  }

  getCapturePackage(id: string): CapturePackage | undefined {
    const row = this.db.prepare("SELECT payload_json FROM capture_packages WHERE id = ?").get(id) as { payload_json: string } | undefined;
    return row ? CapturePackageSchema.parse(parseJson(row.payload_json, "capture package")) : undefined;
  }

  saveCaptureWorkflow(input: { project: ProjectRecord; script: Script; storyboard: Storyboard; tasks: ShootTask[]; capturePackage: CapturePackage }) {
    const transaction = this.db.transaction(() => {
      if (input.script.projectId !== input.project.id || input.storyboard.projectId !== input.project.id || input.capturePackage.projectId !== input.project.id) throw new Error("创作工作流的 projectId 不一致");
      if (input.storyboard.scriptId !== input.script.id || input.storyboard.scriptRevision !== input.script.revision) throw new Error("分镜没有引用当前脚本修订");
      const taskIds = new Set(input.tasks.map((task) => task.id));
      if (input.capturePackage.taskIds.some((taskId) => !taskIds.has(taskId))) throw new Error("拍摄包引用了不存在的任务");
      this.createProject(input.project);
      if (!this.saveScript(input.script)) throw new Error("脚本初始修订写入失败");
      if (!this.saveStoryboard(input.storyboard)) throw new Error("分镜初始修订写入失败");
      for (const task of input.tasks) this.saveShootTask(task);
      this.saveCapturePackage(input.capturePackage);
    }).immediate;
    transaction();
  }

  addTake(raw: Take) {
    const take = TakeSchema.parse(raw);
    const transaction = this.db.transaction(() => {
      if (this.getTake(take.id)) return false;
      const task = this.getShootTask(take.shootTaskId);
      if (!task) throw new Error("Take 对应的拍摄任务不存在");
      this.db.prepare("INSERT INTO takes(id, shoot_task_id, asset_id, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(take.id, take.shootTaskId, take.assetId, take.status, JSON.stringify(take), take.createdAt, take.updatedAt);
      this.saveShootTask(attachTake(task, take));
      return true;
    }).immediate;
    return transaction();
  }

  getTake(id: string): Take | undefined {
    const row = this.db.prepare("SELECT payload_json FROM takes WHERE id = ?").get(id) as { payload_json: string } | undefined;
    return row ? TakeSchema.parse(parseJson(row.payload_json, "take")) : undefined;
  }

  listTakes(shootTaskId: string): Take[] {
    const rows = this.db.prepare("SELECT payload_json FROM takes WHERE shoot_task_id = ? ORDER BY created_at, id").all(shootTaskId) as Array<{ payload_json: string }>;
    return rows.map((row) => TakeSchema.parse(parseJson(row.payload_json, "take")));
  }

  selectTakeForTask(shootTaskId: string, takeId: string) {
    const transaction = this.db.transaction(() => {
      const task = this.getShootTask(shootTaskId);
      if (!task) throw new Error("拍摄任务不存在");
      const selection = selectTake(task, this.listTakes(shootTaskId), takeId);
      this.saveShootTask(selection.task);
      const statement = this.db.prepare("UPDATE takes SET status = ?, payload_json = ?, updated_at = ? WHERE id = ? AND shoot_task_id = ?");
      for (const take of selection.takes) statement.run(take.status, JSON.stringify(take), take.updatedAt, take.id, shootTaskId);
      return selection;
    }).immediate;
    return transaction();
  }

  saveReceipt(input: StoredReceipt) {
    const receipt = CommandReceiptSchema.parse(input.receipt);
    const existing = this.getReceipt(input.idempotencyScope, input.idempotencyKey);
    if (existing && existing.inputHash !== input.inputHash) throw new Error("IDEMPOTENCY_KEY_REUSE");
    if (existing) return existing.receipt;
    this.db.prepare(`INSERT OR IGNORE INTO command_receipts(idempotency_scope, idempotency_key, input_hash, receipt_json, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(input.idempotencyScope, input.idempotencyKey, input.inputHash, JSON.stringify(receipt), nowIso());
    const saved = this.getReceipt(input.idempotencyScope, input.idempotencyKey);
    if (!saved) throw new Error("命令回执未能持久化");
    if (saved.inputHash !== input.inputHash) throw new Error("IDEMPOTENCY_KEY_REUSE");
    return saved.receipt;
  }

  getReceipt(scope: string, key: string): StoredReceipt | undefined {
    const row = this.db.prepare(`SELECT idempotency_scope AS idempotencyScope, idempotency_key AS idempotencyKey, input_hash AS inputHash, receipt_json AS receiptJson FROM command_receipts WHERE idempotency_scope = ? AND idempotency_key = ?`).get(scope, key) as (Omit<StoredReceipt, "receipt"> & { receiptJson: string }) | undefined;
    if (!row) return undefined;
    return { idempotencyScope: row.idempotencyScope, idempotencyKey: row.idempotencyKey, inputHash: row.inputHash, receipt: CommandReceiptSchema.parse(parseJson(row.receiptJson, "command receipt")) };
  }

  executeCommand(raw: unknown, handler: (command: CommandEnvelope) => CommandExecution): CommandReceipt {
    const command = CommandEnvelopeSchema.parse(raw);
    const inputHash = stableStringify({ actor: command.actor, name: command.name, target: command.target, input: command.input });
    const transaction = this.db.transaction(() => {
      const existing = this.getReceipt(command.idempotencyScope, command.idempotencyKey);
      if (existing) {
        if (existing.inputHash !== inputHash) throw new Error("IDEMPOTENCY_KEY_REUSE");
        return { ...existing.receipt, status: "duplicate" as const };
      }
      const execution = handler(command);
      const receipt = CommandReceiptSchema.parse(execution.receipt);
      if (receipt.commandId !== command.commandId || receipt.correlationId !== command.correlationId || stableStringify(receipt.target) !== stableStringify(command.target)) {
        throw new Error("命令回执与请求的 commandId/correlationId 不一致");
      }
      for (const event of execution.events ?? []) this.appendEvent(event);
      for (const outbox of execution.outbox ?? []) this.enqueueOutbox(outbox);
      this.saveReceipt({ idempotencyScope: command.idempotencyScope, idempotencyKey: command.idempotencyKey, inputHash, receipt });
      return receipt;
    }).immediate;
    return transaction();
  }

  appendEvent(event: DomainEventRecord) {
    this.db.prepare(`INSERT INTO domain_events(id, aggregate_type, aggregate_id, aggregate_revision, type, payload_json, actor_type, idempotency_key, correlation_id, causation_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(event.id, event.aggregateType, event.aggregateId, event.aggregateRevision, event.type, JSON.stringify(event.payload), event.actorType, event.idempotencyKey ?? null, event.correlationId, event.causationId ?? null, event.occurredAt);
  }

  enqueueOutbox(outbox: OutboxRecord) {
    this.db.prepare(`INSERT INTO outbox_messages(id, kind, payload_json, idempotency_key, idempotency_scope, state, attempt, worker_id, lease_token, lease_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_scope, idempotency_key) DO NOTHING`)
      .run(outbox.id, outbox.kind, JSON.stringify(outbox.payload), outbox.idempotencyKey, outbox.idempotencyScope, outbox.state, outbox.attempt, outbox.workerId ?? null, outbox.leaseToken ?? null, outbox.leaseExpiresAt ?? null, outbox.createdAt, outbox.updatedAt);
  }

  claimOutbox(id: string, workerId: string, now = new Date(), leaseMs = 30_000) {
    if (!workerId || !Number.isFinite(leaseMs) || leaseMs <= 0 || Number.isNaN(now.getTime())) throw new Error("无效的 outbox lease 参数");
    const timestamp = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const leaseToken = randomUUID();
    const result = this.db.prepare(`UPDATE outbox_messages SET state = 'claimed', worker_id = ?, lease_token = ?, lease_expires_at = ?, attempt = attempt + 1, updated_at = ? WHERE id = ? AND state = 'queued'`).run(workerId, leaseToken, leaseExpiresAt, timestamp, id);
    return result.changes === 1 ? leaseToken : null;
  }

  markOutboxSent(id: string, workerId: string, leaseToken: string, now = new Date()) {
    const result = this.db.prepare(`UPDATE outbox_messages SET state = 'sent', worker_id = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND state = 'claimed' AND worker_id = ? AND lease_token = ? AND lease_expires_at > ?`).run(now.toISOString(), id, workerId, leaseToken, now.toISOString());
    return result.changes === 1;
  }

  markOutboxFailed(id: string, workerId: string, leaseToken: string, retryable: boolean, now = new Date()) {
    const state = retryable ? "queued" : "failed";
    const result = this.db.prepare(`UPDATE outbox_messages SET state = ?, worker_id = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND state = 'claimed' AND worker_id = ? AND lease_token = ? AND lease_expires_at > ?`).run(state, now.toISOString(), id, workerId, leaseToken, now.toISOString());
    return result.changes === 1;
  }

  recoverExpiredOutboxClaims(now = new Date()) {
    const timestamp = now.toISOString();
    const result = this.db.prepare(`UPDATE outbox_messages SET state = 'queued', worker_id = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE state = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`).run(timestamp, timestamp);
    return result.changes;
  }

  insertArtifact(manifest: ArtifactManifest) {
    const artifact = ArtifactManifestSchema.parse(manifest);
    const workspace = this.getWorkspace(artifact.workspaceId);
    if (!workspace) throw new Error("资产所属工作区不存在");
    const resolved = resolve(workspace.rootPath, artifact.relativePath);
    const root = resolve(workspace.rootPath);
    if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) throw new Error("资产路径越过工作区");
    if (existsSync(root)) {
      const realRoot = realpathSync(root);
      let existingAncestor = resolved;
      while (!existsSync(existingAncestor)) {
        const parent = dirname(existingAncestor);
        if (parent === existingAncestor) break;
        existingAncestor = parent;
      }
      const realTarget = existsSync(existingAncestor) ? realpathSync(existingAncestor) : realRoot;
      if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${sep}`)) throw new Error("资产真实路径越过工作区");
    }
    this.db.prepare(`INSERT INTO artifacts(artifact_id, workspace_id, kind, relative_path, mime_type, content_hash, byte_size, parent_artifact_ids_json, source_revision, validation_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(artifact.artifactId, artifact.workspaceId, artifact.kind, artifact.relativePath, artifact.mimeType, artifact.contentHash, artifact.byteSize, JSON.stringify(artifact.parentArtifactIds), artifact.sourceRevision ?? null, artifact.validationStatus, nowIso());
  }

  insertArtifacts(manifests: ArtifactManifest[]) {
    const transaction = this.db.transaction(() => {
      for (const manifest of manifests) {
        const artifact = ArtifactManifestSchema.parse(manifest);
        const existing = this.getArtifact(artifact.artifactId);
        if (existing) {
          if (existing.contentHash !== artifact.contentHash || existing.relativePath !== artifact.relativePath) throw new Error(`Artifact ID 冲突：${artifact.artifactId}`);
          continue;
        }
        this.insertArtifact(artifact);
      }
    }).immediate;
    transaction();
  }

  getArtifact(id: string): ArtifactManifest | undefined {
    const row = this.db.prepare(`SELECT artifact_id AS artifactId, workspace_id AS workspaceId, kind, relative_path AS relativePath, mime_type AS mimeType, content_hash AS contentHash, byte_size AS byteSize, parent_artifact_ids_json, source_revision AS sourceRevision, validation_status AS validationStatus FROM artifacts WHERE artifact_id = ?`).get(id) as (Omit<ArtifactManifest, "parentArtifactIds"> & { parent_artifact_ids_json: string }) | undefined;
    if (!row) return undefined;
    return ArtifactManifestSchema.parse({
      schemaVersion: 1,
      artifactId: row.artifactId,
      workspaceId: row.workspaceId,
      kind: row.kind,
      relativePath: row.relativePath,
      mimeType: row.mimeType,
      contentHash: row.contentHash,
      byteSize: row.byteSize,
      parentArtifactIds: parseJson(row.parent_artifact_ids_json, "artifact parents"),
      sourceRevision: row.sourceRevision ?? undefined,
      validationStatus: row.validationStatus,
    });
  }

  insertJob(job: JobRecord) {
    const value = JobRecordSchema.parse(job);
    const stored = toStoredJob(value);
    this.db.prepare(`INSERT INTO jobs(id, kind, input_hash, state, attempt, idempotency_key, idempotency_scope, provider_key, external_job_id, worker_id, lease_token, lease_expires_at, heartbeat_at, retry_after, checkpoint_json, source_run_id, correlation_id, artifact_ids_json, last_error_json, created_at, updated_at) VALUES (@id, @kind, @inputHash, @state, @attempt, @idempotencyKey, @idempotencyScope, @providerKey, @externalJobId, @workerId, @leaseToken, @leaseExpiresAt, @heartbeatAt, @retryAfter, @checkpointJson, @sourceRunId, @correlationId, @artifactIdsJson, @lastErrorJson, @createdAt, @updatedAt)`).run(stored);
  }

  getJob(id: string) {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? fromStoredJob(row) : undefined;
  }

  claimJob(id: string, workerId: string, now = new Date(), leaseMs = 30_000) {
    if (!workerId || !Number.isFinite(leaseMs) || leaseMs <= 0 || Number.isNaN(now.getTime())) throw new Error("无效的 worker lease 参数");
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const timestamp = now.toISOString();
    const leaseToken = randomUUID();
    const result = this.db.prepare(`UPDATE jobs SET state = 'claimed', attempt = attempt + 1, worker_id = ?, lease_token = ?, lease_expires_at = ?, heartbeat_at = ?, retry_after = NULL, last_error_json = NULL, updated_at = ? WHERE id = ? AND state IN ('queued', 'retry_wait') AND (retry_after IS NULL OR retry_after <= ?)`)
      .run(workerId, leaseToken, leaseExpiresAt, timestamp, timestamp, id, timestamp);
    return result.changes === 1 ? leaseToken : null;
  }

  heartbeatJob(id: string, workerId: string, leaseToken: string, now = new Date(), leaseMs = 30_000) {
    if (!workerId || !leaseToken || !Number.isFinite(leaseMs) || leaseMs <= 0 || Number.isNaN(now.getTime())) throw new Error("无效的 worker heartbeat 参数");
    const timestamp = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const result = this.db.prepare(`UPDATE jobs SET state = CASE WHEN state = 'claimed' THEN 'running' ELSE state END, lease_expires_at = ?, heartbeat_at = ?, updated_at = ? WHERE id = ? AND worker_id = ? AND lease_token = ? AND state IN ('claimed', 'running') AND lease_expires_at > ?`).run(leaseExpiresAt, timestamp, timestamp, id, workerId, leaseToken, timestamp);
    return result.changes === 1;
  }

  transitionJob(id: string, from: JobState, to: JobState, leaseToken?: string, patch: Pick<Partial<JobRecord>, "externalJobId" | "artifactIds" | "checkpoint" | "retryAfter" | "lastError"> = {}) {
    assertJobTransition(from, to);
    const current = this.getJob(id);
    if (!current || current.state !== from) return false;
    const hasActiveLease = Boolean(current.leaseToken);
    if (hasActiveLease && (!leaseToken || current.leaseToken !== leaseToken)) return false;
    if (!hasActiveLease && leaseToken) return false;
    if (to === "running" && !hasActiveLease) throw new Error("任务进入 running 前必须先取得 worker lease");
    const clearsLease = ["retry_wait", "succeeded", "cancelled", "timed_out", "submission_unknown", "needs_attention", "failed"].includes(to);
    const next = JobRecordSchema.parse({
      ...current,
      ...patch,
      state: to,
      ...(clearsLease ? { workerId: undefined, leaseToken: undefined, leaseExpiresAt: undefined, heartbeatAt: undefined } : {}),
      updatedAt: nowIso(),
    });
    const stored = toStoredJob(next);
    const result = this.db.prepare(`UPDATE jobs SET state = @state, worker_id = @workerId, lease_token = @leaseToken, lease_expires_at = @leaseExpiresAt, heartbeat_at = @heartbeatAt, retry_after = @retryAfter, checkpoint_json = @checkpointJson, external_job_id = @externalJobId, artifact_ids_json = @artifactIdsJson, last_error_json = @lastErrorJson, updated_at = @updatedAt WHERE id = @id AND state = @from AND ((@whereLeaseToken IS NOT NULL AND lease_token = @whereLeaseToken AND lease_expires_at > @now) OR (@whereLeaseToken IS NULL AND lease_token IS NULL))`).run({ ...stored, from, whereLeaseToken: current.leaseToken ?? null, now: new Date().toISOString() });
    return result.changes === 1;
  }

  recoverExpiredLeases(now = new Date()) {
    const timestamp = now.toISOString();
    const result = this.db.prepare(`UPDATE jobs SET state = CASE WHEN external_job_id IS NULL THEN 'queued' ELSE 'needs_attention' END, worker_id = NULL, lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL, updated_at = ? WHERE state IN ('claimed', 'running') AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`).run(timestamp, timestamp);
    return result.changes;
  }

  checkpoint() {
    this.db.pragma("wal_checkpoint(TRUNCATE)");
  }

  async backup(destinationPath: string) {
    return this.db.backup(destinationPath);
  }
}

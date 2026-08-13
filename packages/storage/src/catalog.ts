import Database from "better-sqlite3";
import {
  ArtifactManifestSchema,
  CommandReceiptSchema,
  JobRecordSchema,
  assertJobTransition,
  type ArtifactManifest,
  type CommandReceipt,
  type JobRecord,
  type JobState,
} from "../../contracts/src/index";

const CURRENT_SCHEMA_VERSION = 1;

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
  readonly db: Database.Database;

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

  saveReceipt(input: StoredReceipt) {
    const receipt = CommandReceiptSchema.parse(input.receipt);
    this.db.prepare(`INSERT INTO command_receipts(idempotency_scope, idempotency_key, input_hash, receipt_json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(idempotency_scope, idempotency_key) DO NOTHING`)
      .run(input.idempotencyScope, input.idempotencyKey, input.inputHash, JSON.stringify(receipt), nowIso());
  }

  getReceipt(scope: string, key: string): StoredReceipt | undefined {
    const row = this.db.prepare(`SELECT idempotency_scope AS idempotencyScope, idempotency_key AS idempotencyKey, input_hash AS inputHash, receipt_json FROM command_receipts WHERE idempotency_scope = ? AND idempotency_key = ?`).get(scope, key) as (Omit<StoredReceipt, "receipt"> & { receipt_json: string }) | undefined;
    if (!row) return undefined;
    return { ...row, receipt: CommandReceiptSchema.parse(parseJson(row.receipt_json, "command receipt")) } as StoredReceipt;
  }

  insertArtifact(manifest: ArtifactManifest) {
    const artifact = ArtifactManifestSchema.parse(manifest);
    this.db.prepare(`INSERT INTO artifacts(artifact_id, workspace_id, kind, relative_path, mime_type, content_hash, byte_size, parent_artifact_ids_json, source_revision, validation_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(artifact.artifactId, artifact.workspaceId, artifact.kind, artifact.relativePath, artifact.mimeType, artifact.contentHash, artifact.byteSize, JSON.stringify(artifact.parentArtifactIds), artifact.sourceRevision ?? null, artifact.validationStatus, nowIso());
  }

  insertJob(job: JobRecord) {
    const value = JobRecordSchema.parse(job);
    const stored = toStoredJob(value);
    this.db.prepare(`INSERT INTO jobs(id, kind, input_hash, state, attempt, idempotency_key, idempotency_scope, provider_key, external_job_id, worker_id, lease_expires_at, heartbeat_at, retry_after, checkpoint_json, source_run_id, correlation_id, artifact_ids_json, last_error_json, created_at, updated_at) VALUES (@id, @kind, @inputHash, @state, @attempt, @idempotencyKey, @idempotencyScope, @providerKey, @externalJobId, @workerId, @leaseExpiresAt, @heartbeatAt, @retryAfter, @checkpointJson, @sourceRunId, @correlationId, @artifactIdsJson, @lastErrorJson, @createdAt, @updatedAt)`).run(stored);
  }

  getJob(id: string) {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? fromStoredJob(row) : undefined;
  }

  claimJob(id: string, workerId: string, now = new Date(), leaseMs = 30_000) {
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const timestamp = now.toISOString();
    const result = this.db.prepare(`UPDATE jobs SET state = 'claimed', worker_id = ?, lease_expires_at = ?, heartbeat_at = ?, updated_at = ? WHERE id = ? AND state IN ('queued', 'retry_wait') AND (retry_after IS NULL OR retry_after <= ?)`)
      .run(workerId, leaseExpiresAt, timestamp, timestamp, id, timestamp);
    return result.changes === 1;
  }

  heartbeatJob(id: string, workerId: string, now = new Date(), leaseMs = 30_000) {
    const timestamp = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const result = this.db.prepare(`UPDATE jobs SET state = CASE WHEN state = 'claimed' THEN 'running' ELSE state END, lease_expires_at = ?, heartbeat_at = ?, updated_at = ? WHERE id = ? AND worker_id = ? AND state IN ('claimed', 'running')`).run(leaseExpiresAt, timestamp, timestamp, id, workerId);
    return result.changes === 1;
  }

  transitionJob(id: string, from: JobState, to: JobState, patch: Partial<JobRecord> = {}) {
    assertJobTransition(from, to);
    const current = this.getJob(id);
    if (!current || current.state !== from) return false;
    const next = JobRecordSchema.parse({ ...current, ...patch, state: to, updatedAt: nowIso() });
    const stored = toStoredJob(next);
    const result = this.db.prepare(`UPDATE jobs SET state = @state, attempt = @attempt, worker_id = @workerId, lease_expires_at = @leaseExpiresAt, heartbeat_at = @heartbeatAt, retry_after = @retryAfter, checkpoint_json = @checkpointJson, external_job_id = @externalJobId, artifact_ids_json = @artifactIdsJson, last_error_json = @lastErrorJson, updated_at = @updatedAt WHERE id = @id AND state = @from`).run({ ...stored, from });
    return result.changes === 1;
  }

  recoverExpiredLeases(now = new Date()) {
    const timestamp = now.toISOString();
    const result = this.db.prepare(`UPDATE jobs SET state = CASE WHEN external_job_id IS NULL THEN 'queued' ELSE 'needs_attention' END, worker_id = NULL, lease_expires_at = NULL, heartbeat_at = NULL, updated_at = ? WHERE state IN ('claimed', 'running') AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`).run(timestamp, timestamp);
    return result.changes;
  }

  checkpoint() {
    this.db.pragma("wal_checkpoint(TRUNCATE)");
  }
}

/**
 * Research run persistence.
 *
 * SQLite, for the same reason as before: one user, small data, and a backup path
 * that already knows how to copy a file.
 *
 * Two things this store must get right:
 *
 * * **Events are persisted as they arrive.** The agent's event stream is
 *   in-memory and lives inside this process, so if this table is not written, a
 *   browser refresh loses the run.
 * * **Excerpts are write-once.** `spec.md` §6.3-F: verbatim degrades irreversibly
 *   the moment it is paraphrased, so the store refuses to change one rather than
 *   trusting callers not to.
 *
 * `CREATE TABLE IF NOT EXISTS` does not alter an existing table — new columns
 * need a migration, and the failure shows up at INSERT rather than at startup.
 * `migrate` exists for that and runs on every open.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import type { SourceKind, StagePacket } from "./schema.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS research_runs (
    id             TEXT PRIMARY KEY,
    agent_run_id   TEXT NOT NULL DEFAULT '',
    session_id     TEXT NOT NULL DEFAULT '',
    stage          INTEGER NOT NULL DEFAULT 1,
    status         TEXT NOT NULL,
    model          TEXT NOT NULL DEFAULT '',
    brief          TEXT NOT NULL DEFAULT '{}',
    reject_kinds   TEXT NOT NULL DEFAULT '[]',
    judgement_ids  TEXT NOT NULL DEFAULT '[]',
    packet         TEXT NOT NULL DEFAULT '',
    error          TEXT NOT NULL DEFAULT '',
    output         TEXT NOT NULL DEFAULT '',
    usage          TEXT NOT NULL DEFAULT '{}',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    ended_at       TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS research_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id     TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    payload    TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_events_run
    ON research_events(run_id, id);
CREATE TABLE IF NOT EXISTS research_judgements (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,
    text          TEXT NOT NULL,
    rejects_kinds TEXT NOT NULL DEFAULT '[]',
    active        INTEGER NOT NULL DEFAULT 1,
    applied_count INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);
`;

/**
 * A run is one of these. `invalid` is deliberately distinct from `failed`: the
 * agent finished and produced something, and what it produced broke the
 * contract. Collapsing the two would hide the most informative failure there is.
 */
export const RUN_STATUSES = [
  "queued",
  "running",
  "stopping",
  "completed",
  "invalid",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "invalid",
  "failed",
  "cancelled",
]);

export function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return randomUUID().replace(/-/g, "");
}

export interface ResearchRun {
  id: string;
  agent_run_id: string;
  session_id: string;
  stage: number;
  status: string;
  model: string;
  brief: Record<string, unknown>;
  reject_kinds: string[];
  judgement_ids: string[];
  packet: Record<string, unknown> | null;
  error: string;
  output: string;
  usage: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  ended_at: string;
}

export interface RunSummary {
  id: string;
  status: string;
  stage: number;
  model: string;
  brief: Record<string, unknown>;
  error: string;
  created_at: string;
  updated_at: string;
  ended_at: string;
  usage: Record<string, unknown>;
  counts: {
    sources: number;
    rejected: number;
    excerpts: number;
    measurements: number;
    attributes: number;
    gaps: number;
  };
}

/** The list view's row: enough to choose a run, not the whole packet. */
export function summary(run: ResearchRun): RunSummary {
  const packet = (run.packet ?? {}) as Record<string, any>;
  const sources: any[] = packet.sources ?? [];
  return {
    id: run.id,
    status: run.status,
    stage: run.stage,
    model: run.model,
    brief: run.brief,
    error: run.error,
    created_at: run.created_at,
    updated_at: run.updated_at,
    ended_at: run.ended_at,
    usage: run.usage,
    counts: {
      sources: sources.filter((s) => s.admitted ?? true).length,
      rejected: sources.filter((s) => !(s.admitted ?? true)).length,
      excerpts: (packet.excerpts ?? []).length,
      measurements: (packet.measurements ?? []).length,
      attributes: (packet.attributes ?? []).length,
      gaps: (packet.gaps ?? []).length,
    },
  };
}

export interface RunEvent {
  id: number;
  run_id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Judgement {
  id: string;
  kind: string;
  text: string;
  rejects_kinds: SourceKind[];
  active: boolean;
  applied_count: number;
  created_at: string;
}

/** Fields `updateRun` will write. Anything else is a caller bug, not a no-op. */
const RUN_FIELDS = new Set([
  "agent_run_id",
  "session_id",
  "stage",
  "status",
  "model",
  "brief",
  "reject_kinds",
  "judgement_ids",
  "packet",
  "error",
  "output",
  "usage",
  "ended_at",
]);

const JSON_FIELDS = new Set(["brief", "reject_kinds", "judgement_ids", "packet", "usage"]);

export interface RunUpdate {
  agent_run_id?: string;
  session_id?: string;
  stage?: number;
  status?: string;
  model?: string;
  brief?: unknown;
  reject_kinds?: unknown;
  judgement_ids?: unknown;
  packet?: StagePacket | Record<string, unknown> | string;
  error?: string;
  output?: string;
  usage?: unknown;
  ended_at?: string;
}

/** Persistence contract. One implementation today; the seam is the point. */
export interface ResearchStore {
  createRun(input: {
    brief: Record<string, unknown>;
    model: string;
    rejectKinds: string[];
    judgementIds: string[];
  }): ResearchRun;
  getRun(runId: string): ResearchRun | null;
  listRuns(limit?: number): ResearchRun[];
  updateRun(runId: string, fields: RunUpdate): void;
  addEvent(runId: string, kind: string, payload: Record<string, unknown>): RunEvent;
  listEvents(runId: string, afterId?: number): RunEvent[];
  listJudgements(activeOnly?: boolean): Judgement[];
  addJudgement(input: { kind: string; text: string; rejects_kinds: SourceKind[] }): Judgement;
  deleteJudgement(judgementId: string): void;
  bumpJudgement(judgementId: string, by?: number): void;
  close(): void;
}

export class SqliteResearchStore implements ResearchStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { timeout: 15000 });
    // WAL lets a second connection (a backup, a sqlite3 shell) read while this
    // one writes, and busy_timeout turns a lost race into a short wait instead
    // of an immediate "database is locked".
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 15000");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /**
   * Add columns a previous version of this schema did not have.
   *
   * `CREATE TABLE IF NOT EXISTS` above is a no-op against an existing table, so
   * anything added later has to arrive here or the first INSERT fails.
   */
  private migrate(): void {
    const have = new Set(
      (this.db.pragma("table_info(research_runs)") as Array<{ name: string }>).map((r) => r.name),
    );
    const columns: Array<[string, string]> = [
      ["output", "ALTER TABLE research_runs ADD COLUMN output TEXT NOT NULL DEFAULT ''"],
      [
        "judgement_ids",
        "ALTER TABLE research_runs ADD COLUMN judgement_ids TEXT NOT NULL DEFAULT '[]'",
      ],
      ["usage", "ALTER TABLE research_runs ADD COLUMN usage TEXT NOT NULL DEFAULT '{}'"],
      // Renamed from hermes_run_id when the harness became in-process. An older
      // database still carries the old column; adding the new one beside it is
      // the migration, and the old column is simply left alone.
      ["agent_run_id", "ALTER TABLE research_runs ADD COLUMN agent_run_id TEXT NOT NULL DEFAULT ''"],
    ];
    for (const [column, ddl] of columns) {
      if (!have.has(column)) this.db.exec(ddl);
    }
  }

  // -- runs -------------------------------------------------------------

  createRun(input: {
    brief: Record<string, unknown>;
    model: string;
    rejectKinds: string[];
    judgementIds: string[];
  }): ResearchRun {
    const now = nowIso();
    const runId = newId();
    this.db
      .prepare(
        "INSERT INTO research_runs (id, status, model, brief, reject_kinds," +
          " judgement_ids, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        runId,
        "queued",
        input.model,
        JSON.stringify(input.brief),
        JSON.stringify(input.rejectKinds),
        JSON.stringify(input.judgementIds),
        now,
        now,
      );
    const run = this.getRun(runId);
    if (!run) throw new Error("run vanished immediately after insert");
    return run;
  }

  getRun(runId: string): ResearchRun | null {
    const row = this.db.prepare("SELECT * FROM research_runs WHERE id = ?").get(runId);
    return row ? runFromRow(row as Record<string, any>) : null;
  }

  listRuns(limit = 50): ResearchRun[] {
    const rows = this.db
      .prepare("SELECT * FROM research_runs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, any>>;
    return rows.map(runFromRow);
  }

  updateRun(runId: string, fields: RunUpdate): void {
    const keys = Object.keys(fields) as Array<keyof RunUpdate>;
    const unknown = keys.filter((k) => !RUN_FIELDS.has(k as string));
    if (unknown.length > 0) {
      throw new Error(`not run columns: ${unknown.sort().join(", ")}`);
    }
    if (keys.length === 0) return;
    const values = keys.map((key) => {
      const value = fields[key];
      if (JSON_FIELDS.has(key as string) && typeof value !== "string") {
        return JSON.stringify(value ?? null);
      }
      return value as string | number;
    });
    const assignments = keys.map((k) => `${k} = ?`).join(", ");
    this.db
      .prepare(`UPDATE research_runs SET ${assignments}, updated_at = ? WHERE id = ?`)
      .run(...values, nowIso(), runId);
  }

  // -- events -----------------------------------------------------------

  addEvent(runId: string, kind: string, payload: Record<string, unknown>): RunEvent {
    const now = nowIso();
    const info = this.db
      .prepare(
        "INSERT INTO research_events (run_id, kind, payload, created_at) VALUES (?,?,?,?)",
      )
      .run(runId, kind, JSON.stringify(payload), now);
    return {
      id: Number(info.lastInsertRowid),
      run_id: runId,
      kind,
      payload,
      created_at: now,
    };
  }

  listEvents(runId: string, afterId = 0): RunEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM research_events WHERE run_id = ? AND id > ? ORDER BY id")
      .all(runId, afterId) as Array<Record<string, any>>;
    return rows.map((r) => ({
      id: r.id as number,
      run_id: r.run_id as string,
      kind: r.kind as string,
      payload: loads(r.payload, {}) as Record<string, unknown>,
      created_at: r.created_at as string,
    }));
  }

  // -- judgements -------------------------------------------------------

  listJudgements(activeOnly = false): Judgement[] {
    let sql = "SELECT * FROM research_judgements";
    if (activeOnly) sql += " WHERE active = 1";
    sql += " ORDER BY created_at";
    const rows = this.db.prepare(sql).all() as Array<Record<string, any>>;
    return rows.map((r) => ({
      id: r.id as string,
      kind: r.kind as string,
      text: r.text as string,
      rejects_kinds: loads(r.rejects_kinds, []) as SourceKind[],
      active: Boolean(r.active),
      applied_count: r.applied_count as number,
      created_at: r.created_at as string,
    }));
  }

  addJudgement(input: { kind: string; text: string; rejects_kinds: SourceKind[] }): Judgement {
    const judgement: Judgement = {
      id: newId(),
      kind: input.kind,
      text: input.text,
      rejects_kinds: [...input.rejects_kinds],
      active: true,
      applied_count: 0,
      created_at: nowIso(),
    };
    this.db
      .prepare(
        "INSERT INTO research_judgements (id, kind, text, rejects_kinds, active," +
          " applied_count, created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        judgement.id,
        judgement.kind,
        judgement.text,
        JSON.stringify(judgement.rejects_kinds),
        1,
        0,
        judgement.created_at,
      );
    return judgement;
  }

  deleteJudgement(judgementId: string): void {
    this.db.prepare("DELETE FROM research_judgements WHERE id = ?").run(judgementId);
  }

  /** "applied N times" has to be a count of real events, not a claim. */
  bumpJudgement(judgementId: string, by = 1): void {
    this.db
      .prepare("UPDATE research_judgements SET applied_count = applied_count + ? WHERE id = ?")
      .run(by, judgementId);
  }

  close(): void {
    this.db.close();
  }
}

function runFromRow(row: Record<string, any>): ResearchRun {
  return {
    id: row.id,
    agent_run_id: row.agent_run_id ?? "",
    session_id: row.session_id,
    stage: row.stage,
    status: row.status,
    model: row.model,
    brief: loads(row.brief, {}) as Record<string, unknown>,
    reject_kinds: loads(row.reject_kinds, []) as string[],
    judgement_ids: loads(row.judgement_ids, []) as string[],
    packet: row.packet ? (loads(row.packet, null) as Record<string, unknown> | null) : null,
    error: row.error,
    output: row.output,
    usage: loads(row.usage, {}) as Record<string, unknown>,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ended_at: row.ended_at,
  };
}

function loads(raw: string, fallback: unknown): unknown {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

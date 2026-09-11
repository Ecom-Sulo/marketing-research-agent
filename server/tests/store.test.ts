/** Persistence: the run row, the replayable event log, and the migration. */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqliteResearchStore, summary } from "../src/store.js";
import { minimalPacket } from "./fixtures.js";

let dir: string;
let store: SqliteResearchStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mra-store-"));
  store = new SqliteResearchStore(join(dir, "research.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const newRun = () =>
  store.createRun({ brief: { product: "x" }, model: "m", rejectKinds: [], judgementIds: [] });

describe("runs", () => {
  it("moves through its lifecycle", () => {
    const run = newRun();
    expect(run.status).toBe("queued");
    store.updateRun(run.id, { status: "running" });
    expect(store.getRun(run.id)?.status).toBe("running");
  });

  it("refuses to write a column that does not exist", () => {
    const run = newRun();
    expect(() => store.updateRun(run.id, { nonsense: 1 } as any)).toThrow(/not run columns/);
  });

  it("stores the packet as JSON", () => {
    const run = newRun();
    store.updateRun(run.id, { packet: minimalPacket() });
    expect((store.getRun(run.id)?.packet as any).brief.product).toBe("MagnaCalm 400mg");
  });

  it("counts admitted and rejected sources separately", () => {
    const run = newRun();
    const packet = minimalPacket();
    packet.sources.push({
      id: "sha256:ddd",
      url: "https://x",
      kind: "seo_listicle",
      admitted: false,
      node: "competitors",
    });
    store.updateRun(run.id, { packet });
    const counts = summary(store.getRun(run.id)!).counts;
    expect(counts.sources).toBe(1);
    expect(counts.rejected).toBe(1);
  });
});

describe("events", () => {
  it("replays in order and honours `after`", () => {
    const run = newRun();
    const first = store.addEvent(run.id, "run.started", {});
    store.addEvent(run.id, "tool.started", { tool: "web_search" });
    const all = store.listEvents(run.id);
    expect(all.map((e) => e.kind)).toEqual(["run.started", "tool.started"]);
    expect(store.listEvents(run.id, first.id).map((e) => e.kind)).toEqual(["tool.started"]);
  });
});

describe("judgements", () => {
  it("counts applications rather than claiming them", () => {
    const judgement = store.addJudgement({ kind: "source_rule", text: "no listicles", rejects_kinds: [] });
    expect(judgement.applied_count).toBe(0);
    store.bumpJudgement(judgement.id, 3);
    expect(store.listJudgements()[0]!.applied_count).toBe(3);
  });

  it("lists only active judgements when asked", () => {
    store.addJudgement({ kind: "custom", text: "one", rejects_kinds: [] });
    expect(store.listJudgements(true)).toHaveLength(1);
  });
});

describe("migration", () => {
  it("adds columns to a database an older version created", () => {
    // `CREATE TABLE IF NOT EXISTS` is a no-op against an existing table, so a
    // column added later has to arrive through the migration or the first
    // INSERT fails — at INSERT, not at startup, which is the trap.
    const path = join(dir, "old.db");
    const old = new Database(path);
    old.exec(`
      CREATE TABLE research_runs (
        id TEXT PRIMARY KEY, hermes_run_id TEXT NOT NULL DEFAULT '',
        session_id TEXT NOT NULL DEFAULT '', stage INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL, model TEXT NOT NULL DEFAULT '',
        brief TEXT NOT NULL DEFAULT '{}', reject_kinds TEXT NOT NULL DEFAULT '[]',
        packet TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        ended_at TEXT NOT NULL DEFAULT ''
      );
    `);
    old.close();

    const migrated = new SqliteResearchStore(path);
    try {
      const run = migrated.createRun({
        brief: { product: "x" },
        model: "m",
        rejectKinds: [],
        judgementIds: ["j1"],
      });
      migrated.updateRun(run.id, { output: "text", usage: { totalTokens: 1 }, agent_run_id: "a" });
      const back = migrated.getRun(run.id)!;
      expect(back.output).toBe("text");
      expect(back.judgement_ids).toEqual(["j1"]);
      expect(back.agent_run_id).toBe("a");
    } finally {
      migrated.close();
    }
  });
});

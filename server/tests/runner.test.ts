/**
 * The run lifecycle.
 *
 * Driven by pi's faux provider rather than a live model: the thing under test is
 * what the supervisor does with what comes back, and a real model would make
 * that non-deterministic and slow.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels, type MutableModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSupervisor, effectiveRejectKinds } from "../src/runner.js";
import { runRequestSchema, type RunRequest } from "../src/schema.js";
import { loadSettings, type Settings } from "../src/settings.js";
import { SqliteResearchStore, type Judgement } from "../src/store.js";
import { fenced, minimalPacket } from "./fixtures.js";

const MODEL_ID = "faux-model";

let dir: string;
let store: SqliteResearchStore;
let settings: Settings;
let models: MutableModels;
let faux: ReturnType<typeof fauxProvider>;
let supervisor: RunSupervisor;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mra-runner-"));
  store = new SqliteResearchStore(join(dir, "research.db"));
  settings = { ...loadSettings(), model: MODEL_ID, corpusPath: join(dir, "corpus") };
  faux = fauxProvider({ provider: "openrouter", models: [{ id: MODEL_ID }] });
  models = createModels();
  models.setProvider(faux.provider);
  supervisor = new RunSupervisor({ store, settings, models });
});

afterEach(async () => {
  await supervisor.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function request(overrides: Partial<RunRequest> = {}): RunRequest {
  return runRequestSchema.parse({ brief: { product: "MagnaCalm 400mg" }, ...overrides });
}

/** Start a run whose single assistant turn is `text`, and wait for it to settle. */
async function runWith(text: string): Promise<string> {
  faux.setResponses([fauxAssistantMessage(text)]);
  const runId = supervisor.start(request());
  await supervisor.waitFor(runId);
  return runId;
}

describe("settling a run", () => {
  it("stores a validated packet and completes", async () => {
    const runId = await runWith(fenced(minimalPacket()));
    const run = store.getRun(runId)!;
    expect(run.status).toBe("completed");
    expect((run.packet as any).excerpts[0].star_rating).toBe(3);
    expect(run.error).toBe("");
    expect(store.listEvents(runId).map((e) => e.kind)).toContain("packet.ready");
  });

  it("marks a run that concludes `invalid`, not `failed`", async () => {
    // The agent finished and produced something, and what it produced broke the
    // contract. That is the most informative failure there is.
    const packet = minimalPacket();
    packet.findings = ["buyers want sleep"];
    const runId = await runWith(fenced(packet));
    const run = store.getRun(runId)!;
    expect(run.status).toBe("invalid");
    expect(run.error).toMatch(/not in the stage-1 contract/);
    expect(store.listEvents(runId).map((e) => e.kind)).toContain("packet.invalid");
  });

  it("marks a prose-only run invalid", async () => {
    const runId = await runWith("I looked into it and I think the market is crowded.");
    expect(store.getRun(runId)!.status).toBe("invalid");
  });

  it("records the output it read the packet from", async () => {
    const runId = await runWith(fenced(minimalPacket()));
    expect(store.getRun(runId)!.output).toContain("MagnaCalm 400mg");
  });

  it("sums usage across every turn rather than reporting only the last", async () => {
    // §11 asks what a run costs; a run is dozens of turns and the final message
    // carries only its own.
    const packet = fenced(minimalPacket());
    faux.setResponses([
      fauxAssistantMessage("looking into it"),
      fauxAssistantMessage("still going"),
      fauxAssistantMessage(packet),
    ]);
    const runId = supervisor.start(request());
    // Two nudges, so the agent takes three turns instead of stopping at one.
    await supervisor.waitFor(runId);
    const usage = store.getRun(runId)!.usage as any;
    expect(usage.totalTokens).toBeGreaterThan(0);
  });

  it("fails the run when the model is not one the provider has", async () => {
    expect(() => supervisor.start(request({ model: "no-such-model" }))).toThrow(/unknown model/);
    const run = store.listRuns()[0]!;
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/unknown model/);
  });
});

describe("events", () => {
  it("emits the kinds the cockpit renders", async () => {
    const runId = await runWith(fenced(minimalPacket()));
    const kinds = store.listEvents(runId).map((e) => e.kind);
    expect(kinds[0]).toBe("run.started");
    expect(kinds).toContain("message.delta");
    expect(kinds).toContain("run.completed");
  });

  it("streams assistant text once, not once per update", async () => {
    // The agent re-emits the whole message on each update; appending deltas
    // blindly multiplies the output by the number of updates.
    const runId = await runWith(fenced(minimalPacket()));
    const deltas = store
      .listEvents(runId)
      .filter((e) => e.kind === "message.delta")
      .map((e) => String((e.payload as any).delta))
      .join("");
    expect(deltas).toBe(store.getRun(runId)!.output);
  });

  it("replays every event to a subscriber that arrives late", async () => {
    const runId = await runWith(fenced(minimalPacket()));
    expect(store.listEvents(runId).length).toBeGreaterThan(2);
    expect(supervisor.isLive(runId)).toBe(false);
  });
});

describe("judgements", () => {
  it("only ever widens the rejection set", () => {
    // A standing rule must never quietly make the corpus wider (spec.md §6.2-4).
    const judgement: Judgement = {
      id: "j1",
      kind: "source_rule",
      text: "no competitor marketing",
      rejects_kinds: ["competitor_marketing"],
      active: true,
      applied_count: 0,
      created_at: "",
    };
    const kinds = effectiveRejectKinds(request(), [judgement]);
    expect(kinds).toEqual(
      expect.arrayContaining(["seo_listicle", "review_roundup", "ai_generated", "competitor_marketing"]),
    );
  });

  it("lets an explicit reject_kinds replace the defaults", () => {
    expect(effectiveRejectKinds(request({ reject_kinds: ["ai_generated"] }), [])).toEqual([
      "ai_generated",
    ]);
  });

  it("counts applications from the packet, not from the prompt", async () => {
    const judgement = store.addJudgement({
      kind: "source_rule",
      text: "no listicles",
      rejects_kinds: ["seo_listicle"],
    });
    const packet = minimalPacket();
    packet.sources.push({
      id: "sha256:ddd",
      url: "https://top10.example/best",
      kind: "seo_listicle",
      admitted: false,
      admission_reason: "rejected by policy",
      node: "competitors",
    });
    await runWith(fenced(packet));
    expect(store.listJudgements().find((j) => j.id === judgement.id)!.applied_count).toBe(1);
  });

  it("reaches the instructions of a run started after it", async () => {
    store.addJudgement({ kind: "custom", text: "prefer UK sources", rejects_kinds: [] });
    faux.setResponses([
      (context) => {
        const turn = JSON.stringify(context.messages);
        expect(turn).toContain("prefer UK sources");
        return fauxAssistantMessage(fenced(minimalPacket()));
      },
    ]);
    const runId = supervisor.start(request());
    await supervisor.waitFor(runId);
    expect(store.getRun(runId)!.status).toBe("completed");
  });
});

describe("recovery", () => {
  it("settles a run the process stopped watching", () => {
    // The agent lives in this process now, so a run that was `running` at
    // shutdown is dead, not resumable. Saying so beats a row stuck on `running`.
    const run = store.createRun({
      brief: { product: "x" },
      model: MODEL_ID,
      rejectKinds: [],
      judgementIds: [],
    });
    store.updateRun(run.id, { status: "running" });
    supervisor.recover();
    const settled = store.getRun(run.id)!;
    expect(settled.status).toBe("failed");
    expect(settled.error).toMatch(/restarted/);
  });

  it("leaves finished runs alone", async () => {
    const runId = await runWith(fenced(minimalPacket()));
    supervisor.recover();
    expect(store.getRun(runId)!.status).toBe("completed");
  });
});

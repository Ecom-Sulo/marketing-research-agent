/**
 * Owns a research run for its whole life.
 *
 * One `Agent` per run, living in this process. Every event it emits is written
 * to SQLite and then fanned out to whichever browsers are watching. That
 * ordering is not decoration:
 *
 *     Agent   ──(in-memory, this process only)──────▶  supervisor
 *     supervisor ──(SQLite, replayable, many readers)──▶  browsers
 *
 * Reading the agent's stream directly from the HTTP handler would mean a browser
 * refresh loses everything that happened before it connected, and a second tab
 * sees a different run than the first.
 *
 * **Superseded:** under hermes a run outlived this process, so `recover()`
 * re-read the upstream run and settled it from what actually happened. In-process
 * that is no longer true — the agent dies with the process — so recovery can only
 * record the death honestly. See `recover()`.
 */

import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import { createModels, type Models, type Usage } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

import { PacketError, parse as parsePacket } from "./packet.js";
import { buildInstructions, steerText, systemPrompt } from "./prompt.js";
import {
  DEFAULT_REJECTED_KINDS,
  type RunRequest,
  type SourceKind,
  type StagePacket,
} from "./schema.js";
import type { Settings } from "./settings.js";
import { TERMINAL_STATUSES, nowIso, type Judgement, type ResearchStore } from "./store.js";
import { TOOL_LANES, createResearchTools } from "./tools.js";

/** Raised when a run cannot be started, steered or stopped. */
export class RunError extends Error {
  override readonly name = "RunError";
}

export interface EventFrame {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
}

/** A live subscriber. `null` pushed onto the queue means "no more live frames". */
type Subscriber = (frame: EventFrame | null) => void;

interface Live {
  agent: Agent;
  subscribers: Set<Subscriber>;
  done: Promise<void>;
}

/** The tool argument the cockpit should show in a lane. */
function preview(toolName: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  if (toolName === "web_search") return String(a.query ?? "");
  if (toolName === "web_fetch") return String(a.url ?? "");
  return "";
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * Sum usage across every turn.
 *
 * §11 asks what a stage-1 run costs. The final assistant message carries only
 * its own turn, and a run is dozens of turns, so reporting that number would
 * understate the cost by an order of magnitude.
 */
function addUsage(total: Usage, next: Usage | undefined): Usage {
  if (!next) return total;
  return {
    input: total.input + (next.input ?? 0),
    output: total.output + (next.output ?? 0),
    cacheRead: total.cacheRead + (next.cacheRead ?? 0),
    cacheWrite: total.cacheWrite + (next.cacheWrite ?? 0),
    reasoning: (total.reasoning ?? 0) + (next.reasoning ?? 0),
    totalTokens: total.totalTokens + (next.totalTokens ?? 0),
    cost: {
      input: total.cost.input + (next.cost?.input ?? 0),
      output: total.cost.output + (next.cost?.output ?? 0),
      cacheRead: total.cost.cacheRead + (next.cost?.cacheRead ?? 0),
      cacheWrite: total.cost.cacheWrite + (next.cost?.cacheWrite ?? 0),
      total: total.cost.total + (next.cost?.total ?? 0),
    },
  };
}

/** Starts runs and keeps them alive independently of any HTTP connection. */
export class RunSupervisor {
  private readonly store: ResearchStore;
  private readonly settings: Settings;
  private readonly models: Models;
  private readonly live = new Map<string, Live>();

  constructor(options: { store: ResearchStore; settings: Settings; models?: Models }) {
    this.store = options.store;
    this.settings = options.settings;
    if (options.models) {
      this.models = options.models;
    } else {
      const models = createModels();
      models.setProvider(openrouterProvider());
      this.models = models;
    }
  }

  // -- lifecycle --------------------------------------------------------

  /** Create the run record, build its agent, and start watching it. */
  start(request: RunRequest): string {
    const judgements = this.store.listJudgements(true);
    const rejectKinds = effectiveRejectKinds(request, judgements);
    const modelId = request.model || this.settings.model;

    const run = this.store.createRun({
      brief: request.brief as unknown as Record<string, unknown>,
      model: modelId,
      rejectKinds,
      judgementIds: judgements.map((j) => j.id),
    });

    const model = this.models.getModel("openrouter", modelId);
    if (!model) {
      const error = `unknown model ${JSON.stringify(modelId)} for provider openrouter`;
      this.store.updateRun(run.id, { status: "failed", error, ended_at: nowIso() });
      this.emit(run.id, "run.failed", { error });
      throw new RunError(error);
    }

    const instructions = buildInstructions({
      brief: request.brief,
      rejectKinds,
      judgements,
    });

    const agent = new Agent({
      streamFn: (m, c, o) => this.models.streamSimple(m, c, o),
      // One session id per run, so a cache-aware backend keeps the run's prefix
      // warm across its many turns rather than paying full price every time.
      sessionId: `research-${run.id}`,
      initialState: {
        systemPrompt: systemPrompt(),
        model,
        tools: createResearchTools({ settings: this.settings, runId: run.id }),
      },
    });

    this.store.updateRun(run.id, {
      agent_run_id: run.id,
      session_id: `research-${run.id}`,
      status: "running",
    });
    this.emit(run.id, "run.started", { model: modelId });

    const done = this.watch(run.id, agent, instructions);
    this.live.set(run.id, { agent, subscribers: new Set(), done });
    return run.id;
  }

  /**
   * Settle runs this process was watching when it stopped.
   *
   * Under hermes a run continued upstream and could be re-read. The agent now
   * lives here, so a process that stopped mid-run killed it: there is nothing to
   * reconcile against and pretending otherwise would invent an outcome. Marking
   * it failed with the reason is the honest record, and it is better than a row
   * that says `running` forever.
   */
  recover(): void {
    for (const run of this.store.listRuns(200)) {
      if (TERMINAL_STATUSES.has(run.status)) continue;
      this.store.updateRun(run.id, {
        status: "failed",
        error: "the server restarted while this run was in progress; the run did not survive it",
        ended_at: nowIso(),
      });
      this.emit(run.id, "run.failed", { error: "server restarted mid-run" });
    }
  }

  steer(runId: string, judgement: Judgement): void {
    const live = this.live.get(runId);
    if (!live) throw new RunError(`run ${runId} is not running here`);
    live.agent.steer({
      role: "user",
      content: [{ type: "text", text: steerText(judgement) }],
      timestamp: Date.now(),
    } as any);
    this.emit(runId, "run.steered", { judgement_id: judgement.id, text: judgement.text });
  }

  stop(runId: string): void {
    const live = this.live.get(runId);
    if (!live) throw new RunError(`run ${runId} is not running here`);
    this.store.updateRun(runId, { status: "stopping" });
    this.emit(runId, "run.stopping", {});
    live.agent.abort();
  }

  async close(): Promise<void> {
    for (const [, live] of this.live) live.agent.abort();
    await Promise.allSettled([...this.live.values()].map((l) => l.done));
    this.live.clear();
  }

  // -- watching ---------------------------------------------------------

  /** Run the agent to completion, recording everything it does on the way. */
  private async watch(runId: string, agent: Agent, instructions: string): Promise<void> {
    const output: string[] = [];
    let usage = emptyUsage();
    // Text is accumulated per assistant message rather than per delta: the
    // agent re-emits the whole message on each update, so appending deltas
    // would multiply the output by the number of updates.
    const messageText = new Map<string, string>();

    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      try {
        this.onAgentEvent(runId, event, messageText, output, (u) => {
          usage = addUsage(usage, u);
        });
      } catch (error) {
        // A listener that throws would abort the run. Losing one cockpit frame
        // is strictly better than losing the run that produced it.
        console.error(`research run ${runId}: event handling failed`, error);
      }
    });

    try {
      await agent.prompt(instructions);
      await agent.waitForIdle();
      this.settle(runId, output.join(""), usage, agent.state.errorMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`research run ${runId}: agent failed`, error);
      this.store.updateRun(runId, {
        status: "failed",
        error: `agent failed: ${message}`,
        output: output.join(""),
        usage,
        ended_at: nowIso(),
      });
      this.emit(runId, "run.failed", { error: message });
    } finally {
      unsubscribe();
      this.closeSubscribers(runId);
      this.live.delete(runId);
    }
  }

  private onAgentEvent(
    runId: string,
    event: AgentEvent,
    messageText: Map<string, string>,
    output: string[],
    addTurnUsage: (usage: Usage | undefined) => void,
  ): void {
    switch (event.type) {
      case "message_update":
      case "message_end": {
        const message = event.message as any;
        if (message?.role !== "assistant") return;
        const text: string = (message.content ?? [])
          .filter((c: any) => c?.type === "text")
          .map((c: any) => c.text ?? "")
          .join("");
        const key = String(message.responseId ?? message.timestamp ?? messageText.size);
        const already = messageText.get(key) ?? "";
        if (text.length > already.length) {
          const delta = text.slice(already.length);
          messageText.set(key, text);
          if (delta) this.emit(runId, "message.delta", { delta });
        }
        if (event.type === "message_end") {
          // The packet is read from the whole transcript's assistant text, so
          // each finished message contributes once, in order.
          output.push(messageText.get(key) ?? text);
          messageText.delete(key);
          addTurnUsage(message.usage);
          const thinking: string = (message.content ?? [])
            .filter((c: any) => c?.type === "thinking")
            .map((c: any) => c.thinking ?? c.text ?? "")
            .join("");
          if (thinking.trim()) this.emit(runId, "reasoning.available", { text: thinking });
        }
        return;
      }
      case "tool_execution_start":
        this.emit(runId, "tool.started", {
          tool: event.toolName,
          preview: preview(event.toolName, event.args),
          lane: TOOL_LANES[event.toolName] ?? "other",
        });
        return;
      case "tool_execution_end":
        this.emit(runId, "tool.completed", {
          tool: event.toolName,
          error: Boolean(event.isError),
          lane: TOOL_LANES[event.toolName] ?? "other",
        });
        return;
      default:
        return;
    }
  }

  /**
   * The agent finished: parse the packet or fail loudly.
   *
   * `invalid` is a distinct status from `failed` on purpose. The agent finished
   * and produced something, and what it produced broke the contract — that is
   * the most informative failure there is, and collapsing it into "failed" would
   * hide it.
   */
  private settle(runId: string, output: string, usage: Usage, errorMessage?: string): void {
    const run = this.store.getRun(runId);
    const stopping = run?.status === "stopping";

    this.store.updateRun(runId, { output, usage, ended_at: nowIso() });

    if (errorMessage) {
      // An abort the operator asked for is a cancellation, not a failure.
      const status = stopping ? "cancelled" : "failed";
      this.store.updateRun(runId, { status, error: errorMessage });
      this.emit(runId, `run.${status}`, { error: errorMessage });
      return;
    }
    if (stopping) {
      this.store.updateRun(runId, { status: "cancelled", error: "stopped by the operator" });
      this.emit(runId, "run.cancelled", {});
      return;
    }

    let parsed: StagePacket;
    try {
      parsed = parsePacket(output);
    } catch (error) {
      if (!(error instanceof PacketError)) throw error;
      this.store.updateRun(runId, { status: "invalid", error: error.message });
      this.emit(runId, "packet.invalid", { error: error.message });
      return;
    }
    this.store.updateRun(runId, { status: "completed", packet: parsed, error: "" });
    this.countJudgementApplications(runId, parsed);
    this.emit(runId, "run.completed", { usage });
    this.emit(runId, "packet.ready", {
      sources: parsed.sources.length,
      excerpts: parsed.excerpts.length,
      gaps: parsed.gaps.length,
    });
  }

  /** "Applied 4 times" must be a count of real rejections, not a claim. */
  private countJudgementApplications(runId: string, parsed: StagePacket): void {
    const run = this.store.getRun(runId);
    if (!run) return;
    const byId = new Map(this.store.listJudgements().map((j) => [j.id, j]));
    for (const judgementId of run.judgement_ids) {
      const judgement = byId.get(judgementId);
      if (!judgement || judgement.rejects_kinds.length === 0) continue;
      const hits = parsed.sources.filter(
        (s) => !s.admitted && judgement.rejects_kinds.includes(s.kind),
      ).length;
      if (hits > 0) this.store.bumpJudgement(judgementId, hits);
    }
  }

  // -- fan-out ----------------------------------------------------------

  /** Persist first, then fan out. Order matters on a crash. */
  private emit(runId: string, kind: string, payload: Record<string, unknown>): void {
    const event = this.store.addEvent(runId, kind, payload);
    const live = this.live.get(runId);
    if (!live) return;
    const frame: EventFrame = {
      id: event.id,
      kind,
      payload,
      created_at: event.created_at,
    };
    for (const subscriber of [...live.subscribers]) {
      try {
        subscriber(frame);
      } catch {
        // A browser that cannot keep up loses live frames, not events:
        // everything is in SQLite and it can reconnect with `after`.
      }
    }
  }

  /** A live feed, or null when the run is no longer running here. */
  subscribe(runId: string, subscriber: Subscriber): (() => void) | null {
    const live = this.live.get(runId);
    if (!live) return null;
    live.subscribers.add(subscriber);
    return () => live.subscribers.delete(subscriber);
  }

  isLive(runId: string): boolean {
    return this.live.has(runId);
  }

  /** Await a run's completion. Tests need it; nothing in the HTTP path does. */
  async waitFor(runId: string): Promise<void> {
    await this.live.get(runId)?.done;
  }

  private closeSubscribers(runId: string): void {
    const live = this.live.get(runId);
    if (!live) return;
    for (const subscriber of [...live.subscribers]) {
      try {
        subscriber(null); // sentinel: no more live frames
      } catch {
        // as above
      }
    }
  }
}

/**
 * Defaults, overridden by the request, widened by every source rule.
 *
 * A judgement only ever adds. Removing a default rejection is an explicit
 * `reject_kinds` on the request, so a standing rule can never quietly make the
 * corpus wider — which is the incentive §6.2-4 of `spec.md` warns about.
 */
export function effectiveRejectKinds(
  request: RunRequest,
  judgements: readonly Judgement[],
): SourceKind[] {
  const kinds: SourceKind[] =
    request.reject_kinds.length > 0 ? [...request.reject_kinds] : [...DEFAULT_REJECTED_KINDS];
  for (const judgement of judgements) {
    for (const kind of judgement.rejects_kinds) {
      if (!kinds.includes(kind)) kinds.push(kind);
    }
  }
  return kinds;
}

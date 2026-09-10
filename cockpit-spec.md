# Spec — Research cockpit

**Status:** design; stage 1 built · **Date:** 2026-09-09, §6 revised 2026-09-10 · **Surface:** ~~a tab in agentchat~~ its own service at `research.vanis.ai` (see §6) · **Engine:** hermes runs API

Companion to `spec.md` (what the researcher does). This is how you watch it work and change how it works.

---

## 1. The thing to get right first

**A cockpit can only render the structure the agent emits.** If the researcher returns prose, you have built a prose viewer with tabs.

So the first deliverable is not a UI. It is the **run contract**: a schema for what a stage produces, what a claim looks like, and what "done" means. Every view below is a rendering of that schema, and every hour spent on the UI before it exists is spent twice.

Concretely, before any React is written, the agent must emit — as JSON, not markdown:

```
stage        id, status, started/ended, inputs consumed, done-criterion met
claim        text, provenance (evidenced|inferred), source refs, node
source        id (content hash), url, fetched_at, kind, admitted (bool)
gate          the five criteria, each pass/fail with its evidence, plus a decision
angle cell    avatar × awareness × mechanism, the ten fields from spec.md §4.1
gap           what was missing, which node, what would need collecting
```

The angle map is already specified as a matrix "because it is machine-consumable and coverage-checkable". That property is what makes a cockpit possible at all — take it seriously and the UI is easy; ignore it and no amount of frontend work recovers it.

---

## 2. What the cockpit is for

Two jobs, and they want different screens.

**Observability** — what did the agent do, on what evidence, and where is it weak.
**Control** — approve the gate, stop a bad run, re-run one stage, and change how the agent works.

Chat cannot do either. A run is not a conversation: it has stages that complete, a gate that blocks, artifacts that accumulate, and a shape you want to see at a glance rather than scroll through.

**Not in scope:** replacing the chat tab. Chat stays the right surface for "what did you mean by that" against a finished dossier.

---

## 3. Why the runs API, not chat completions

agentchat currently speaks `/v1/chat/completions`, which returns one stream of text. hermes also exposes a **runs API** built for exactly this:

| Endpoint | Use |
|---|---|
| `POST /v1/runs` | start a run, get a `run_id` |
| `GET /v1/runs/{id}/events` | SSE — lifecycle, tool calls, deltas, completion |
| `POST /v1/runs/{id}/approval` | answer an approval the agent is blocked on |
| `POST /v1/runs/{id}/steer` | inject a correction mid-run without restarting |
| `POST /v1/runs/{id}/stop` | cancel |
| `GET /v1/runs/{id}` | status |

This is the whole reason a cockpit is worth building on hermes rather than around it. **Approval is the viability gate.** `spec.md` §8 requires a human decision after stage 3 — that is not a UI convention we invent, it maps onto a mechanism the harness already has.

A research run is long (hours, plausibly), so runs are also the right shape operationally: it survives a closed browser, whereas a chat stream does not.

---

## 4. Views

**Runs list** — every run: product, status, current stage, gate decision, started, cost. The daily surface.

**Run detail** — the stage timeline as a first-class object: five stages plus the gate, each with status, duration, node completion, and the done-criterion that was (or wasn't) met. Live via SSE while running. Clicking a node shows what it produced and what it consumed.

**Gate panel** — appears when the run blocks. The five criteria (size, margin, mechanism availability, claim room, structural churn), each with the evidence behind it, and three buttons: proceed, reposition, drop. Writing the decision down is the point — it "converts a decision people avoid making into one they have already agreed the terms of".

**Angle map** — the matrix, rendered as a matrix. Avatar rows, awareness columns, cells coloured by provenance (`evidenced` / `inferred` / not pursued). Coverage holes are visible as holes. Click a cell for the ten fields and the sources behind each.

**Evidence view** — the corpus: sources with kind, date, admission status; and per claim, the cited span with the entailment verdict (`supports` / `partial` / `does not support`) from `spec.md` §6.3. **This is the screen that decides whether the agent is trustworthy**, and the one to build carefully.

**Gap list** — what it couldn't find. Empty means the run failed; the UI should say so rather than showing a satisfying green tick.

---

## 5. Changing how it works

"Trigger changes to how it works" means editing the skill. The compartment already exists at `~/.hermes/skills/research/research-compartment/` in the book-to-skill layout — `SKILL.md`, five stage chapters, glossary, patterns, cheatsheet.

So the control surface is a **skill editor**:

- Browse and edit `SKILL.md` and each chapter
- Diff against the installed baseline (`hermes skills diff`, `list-modified` already do this on the CLI)
- Version every edit, with the run history that follows it — "the gate started failing after I changed stage 3" must be answerable
- Re-run a stage, or a whole run, against the edited skill

**The edit-run-grade loop is the actual product.** GRADE mode already exists in the skill: run it against a finished dossier, see what the framework says was skipped, change the chapter, re-run. That loop is the reason to build this rather than a dashboard.

Two rules for the editor:
1. **Never edit while a run is executing.** Pin each run to a skill version and record it on the run.
2. **Every edit is an audit-log entry.** Editing skills from a web UI is changing agent behaviour from a web UI, and it needs the same treatment as a deploy.

### A defect to fix first

The existing skill's front matter reads:

```yaml
description: "Run the 5-stage research framework for supplement subs."
```

That is a summary, and the setup guide is explicit that a summary gets ignored — the description is the *only* thing loaded before the model decides whether to pull the skill, and it must list the jobs in the phrasing you would actually type. Something closer to:

> *Use when researching a supplement or consumable before writing copy: build an angle map, work out who the product is for, size the market, set claim limits, or audit an existing research dossier. Triggers: "research this product", "who is this for", "build me an angle map", "grade this research".*

Worth fixing before building anything on top, because a skill that doesn't load is invisible in a way that looks like a model problem.

---

## 6. Architecture

> **Superseded 2026-09-10 — it is its own service, not a tab.**
>
> This section originally said *"same app, same auth, same deploy — a tab, not
> a second product"*, on the reasoning that a second deploy is overhead and one
> login is simpler. That was reversed once stage 1 was actually built, and the
> reversal is the more useful record:
>
> **The researcher's entire input is fetched from the open web, and a fetched
> page can contain instructions.** Sharing agentchat's process meant sharing its
> database with an agent whose input is attacker-influenceable; sharing one
> hermes gateway meant sharing `state.db`, long-term memory, sessions and the
> skills directory with it too. §8 already said as much about the corpus — the
> mistake was drawing the isolation boundary at the container and not at the
> product.
>
> The second argument is duller and just as real: a research run is measured in
> hours, and a chat deploy is measured in minutes. Coupling them means every UI
> tweak to the chat app risks a running research job.
>
> What actually shipped is `../marketing-research-agent/`: its own FastAPI app,
> its own React frontend, its own SQLite, its own login, and its own hermes —
> the whole stack in Docker, on-demand rather than always on, so it runs
> identically on a laptop and on the VPS. `spec-stage-1.md` §8 has the layout;
> `setup.md` §5a has the deployment.

The original plan, kept for the record:

```
frontend/src/
  App.tsx              tab shell: Chat | Research
  research/
    RunsList.tsx  RunDetail.tsx  StageTimeline.tsx
    GatePanel.tsx  AngleMap.tsx  EvidenceView.tsx  SkillEditor.tsx

backend/agentchat/
  providers/hermes_runs.py    HermesRunsClient — start, events, approve, steer, stop
  research/
    schema.py     the run contract (§1) as Pydantic models
    store.py      ResearchStore ABC + SqliteResearchStore
    skills.py     read/write/diff skill files
    api.py        /api/research/*
```

`HermesRunsClient` is a **new adapter, not an extension of `HermesProvider`** — different endpoint, different lifecycle, different failure modes. One adapter per boundary, per the project's conventions.

**Skill file access:** skills live at `~/.hermes/skills` on the host; agentchat is a container. Mount that directory into the container (read-only first, read-write only when the editor lands) rather than routing edits through the agent — an agent that can rewrite its own instructions is a much harder thing to reason about than a container with a bind mount.

---

## 7. Build order

The temptation is to start with the angle map because it is the satisfying screen. Don't.

1. **Run contract** (§1). Schema + persistence. No UI.
2. **`HermesRunsClient`** + one run started from a script, events persisted. Prove the runs API end to end before any React.
3. **Read-only cockpit**: runs list, run detail, stage timeline. Already useful — you can watch a run.
4. **Gate panel.** First control surface, and the one with real value: a blocked run that a human releases.
5. **Evidence view.** The trust screen.
6. **Angle map.** Now it has data worth rendering.
7. **Skill editor**, read-only diff first, then editing.
8. **Feedback loops** as scheduled work (the stage-3 ad-library cadence).

Steps 1–3 are the risky part; everything after is rendering. If step 2 is painful, that is the signal to reconsider the whole approach — not to push on into UI.

---

## 8. Security

- **SEC-001 applies with more force.** The researcher needs web fetch and shell; hermes runs on the VPS host as a user with passwordless sudo and Docker group membership. A cockpit makes runs easier to trigger and the corpus is fetched from the open web, which is untrusted input by definition. `terminal.backend: docker` before this agent does real work, not after.
- **Skill editing is privileged.** It changes what the agent does on every future run. Audit log, versioning, and no editing mid-run.
- **The corpus is attacker-influenceable.** A fetched page can contain instructions. Stage 1 stores raw material and stage 5 reasons over it — prompt injection has a natural home here. Treat corpus content as data, never as instruction, and keep the entailment checker on a separate call that sees only the claim and the span.

---

## 9. Decisions needed before starting

1. **Does the agent emit the schema, or does the cockpit parse prose?** The former. Confirm the agent can be made to, on a real run, before building on the assumption.
2. **Where do artifacts live** — agentchat's SQLite, or files on disk with the DB holding pointers? Leaning files: dossiers are large, and a content-addressed corpus is already required by `spec.md` §6.3-F.
3. **One run = one hermes session?** Probably, so `/steer` and the session history line up. Needs testing.
4. **Does a stage re-run resume or restart?** Restart is simpler and probably right for v1; resume needs the corpus to be genuinely immutable first.
5. **How much does a full run cost?** Unknown, and it changes the design — if a run costs $40, restart-on-edit is expensive and resume matters sooner. Measure on the first real run.

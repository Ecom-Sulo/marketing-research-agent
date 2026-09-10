# Spec — Stage 1: raw material collection

**Status:** built (stage 1) · **Date:** 2026-09-10 · **Parents:** `spec.md` (what the
researcher does), `cockpit-spec.md` (how you watch it) · **Engine:** hermes runs API

This is the first of five stage specs. It is deliberately the narrowest one, because
stage 1 is the only stage whose output is allowed to contain no thinking at all.

---

## 1. What stage 1 is

Four nodes: **product data**, **competitors**, **review mining**, **category data**.
Their job is to put material in a box. Not to read it, not to weigh it, not to notice
patterns in it.

`spec.md` §3 names the failure directly: *"Concluding while collecting is the single
most common failure."* Everything in this document exists to make that failure hard
rather than merely discouraged.

### 1.1 The one rule, made structural

> **The stage-1 packet has no field a judgement could be written into.**

There is no `claim`, no `finding`, no `summary`, no `insight`. A validator rejects
the packet if one appears. An agent that wants to conclude something in stage 1 has
nowhere to put it, which is a stronger guarantee than a prompt saying "don't".

Three things are *not* judgements and are allowed:

| Allowed | Why it isn't a judgement |
|---|---|
| **Excerpt** — a verbatim span copied from a source | Transcription, not interpretation |
| **Measurement** — a number stated by a source, with its unit and period | "1.9M searches/mo (Ahrefs, 2026-08)" is copied; "the category is growing" is not |
| **Attribute** — a field lifted off a page (dose, price, format, first-seen date) | Same: read off, not worked out |

The line is: *if a second person with the same source would write down a different
value, it is a judgement and does not belong in stage 1.*

**The one honest exception** is `theme` (§5). It is a clustering label over excerpts,
needed because the done-criterion is saturation and saturation is measured in themes.
It is marked as a working index, it may never be restated as a finding, and stage 2
may re-cluster the same excerpts differently without that being a contradiction.
This is the weakest joint in the design and it is written down rather than hidden.

---

## 2. The four nodes and when each is done

Done is **saturation**, never a count (`spec.md` §3, §6.3-D). Concretely for every
node: *done when three consecutive admitted sources produce no new theme, and the
node's mandatory attributes are either captured or gapped.*

Three is a threshold pulled from nowhere — it is a starting value to be tuned against
the logged saturation curve, not a finding. §9 says how we'll know if it's wrong.

### 2.1 product data

Mandatory attributes, each captured or gapped with a reason:

`name · brand · form · dose_per_serving · servings_per_container · full_ingredient_panel ·
price · subscription_terms · claims_made_on_own_site (verbatim) · coa_present`

Saturation does not apply — this node is a finite checklist. It completes when every
attribute has a value or a gap. **A missing COA is a gap, not a zero.**

### 2.2 competitors

Per competitor: `name · url · positioning_copy (verbatim) · price · format · ad_library_entries`.

Each ad-library entry **must carry `first_seen`**. `spec.md` §7 is blunt about why:
longevity is the only outside performance signal there is. An ad with no first-seen
date is captured, marked `first_seen: null`, and **counted as a gap** — not silently
dropped, because a competitor whose ad dates we couldn't get is a hole in the
sophistication read that stage 3 depends on.

Saturation applies to competitor *discovery*: three consecutive searches surfacing no
new brand.

### 2.3 review mining

The densest node and the one most likely to be faked, so it has the most structure.

Per excerpt: `text (verbatim) · star_rating · date · source_id · locator ·
axis ∈ {why_bought, why_stayed, why_quit}`.

Rules:

- **Verbatim is immutable.** Stored exactly as it appears, including typos. `spec.md`
  §6.2-6 — the moment "I wake up at 3am and can't get back to sleep" becomes "sleep
  maintenance issues", it is gone and cannot be recovered. Enforced in §4: excerpt
  text is content-hashed and the store rejects an update.
- **3★ is mandatory coverage.** A review-mining node with no 3★ excerpts fails its
  done-criterion regardless of saturation. This is the demo's "weight 3★" judgement
  promoted from a manual correction to a default, because it is right every time.
- Three-axis coding is a **label on an excerpt**, not a new sentence. The axis says
  which question the customer was answering, not what the answer means.

### 2.4 category data

Measurements only: search volume with a trend line over **≥3 years** (not a point
estimate — `spec.md` §7), category size figures, seasonality if published. Each
carries `metric · value · unit · period · source_id`. A point estimate where a trend
was needed is a gap.

---

## 3. Corpus admission — a stage-1 responsibility

`spec.md` §6.2-4 is the reason this section exists: when membership in the corpus is
the only gate, the cheapest way to pass it is to widen the corpus. So what may enter
is controlled *here*, at the only stage that adds to it.

Every source carries `kind`, `admitted`, and `admission_reason`. **Rejected sources
stay in the packet.** They are what the cockpit renders as `SKIPPED`, and deleting
them would hide the shape of what was searched.

| `kind` | Default | Note |
|---|---|---|
| `first_party` | admit | brand's own site, label, COA. Mark `marketing: true` if promotional |
| `coa` | admit | strongest evidence class in this category |
| `marketplace_review` | admit | Amazon, own store |
| `review_platform` | admit | Trustpilot and similar |
| `forum` | admit | Reddit, niche boards |
| `video_comments` | admit | YouTube, TikTok comments |
| `ad_library` | admit | `first_seen` required or gapped |
| `trial` | admit | needs dose, form and population — not the abstract |
| `reference` | admit | Examine and similar secondary compendia |
| `keyword_data` | admit | search-volume tooling |
| `competitor_marketing` | admit + `marketing: true` | evidence of what they *claim*, never of what is true |
| `seo_listicle` | **reject** | marketing dressed as review data |
| `review_roundup` | **reject** | same |
| `ai_generated` | **reject** | when detectable; a gap entry when suspected but unproven |

Rejection defaults are **configuration, not code** — a run's `admission_policy`
overrides them, and a standing judgement (§7) writes to that policy. The demo's
headline interaction ("reject SEO listicles" and later fetches visibly skip) is this
mechanism, with the rule pre-loaded instead of typed.

`marketing: true` is not a rejection. It is a weakening flag that stage 2 and the
entailment checker read: a claim resting only on marketing sources is visibly weaker
than one resting on a COA, and that has to be visible rather than argued.

---

## 4. The run contract for stage 1

One packet per run per stage. This is `cockpit-spec.md` §1's "the agent must emit the
schema, as JSON, not markdown" made concrete for stage 1.

```jsonc
{
  "contract_version": "1",
  "stage": 1,
  "run_id": "…",                     // echoed back; the service is the authority
  "brief": { "product": "…", "url": "…", "market": "UK" },

  "sources": [{
    "id": "sha256:…",                // over normalised captured text — the corpus key
    "url": "https://…",
    "title": "…",
    "kind": "forum",                 // §3 enum
    "publisher": "reddit.com",
    "fetched_at": "2026-09-10T09:14:22Z",
    "first_seen": null,              // ad_library only; null is a gap, not a zero
    "marketing": false,
    "admitted": true,
    "admission_reason": "forum — admitted by default policy",
    "archived": true,                // raw body written to the corpus volume (§6)
    "node": "review_mining"
  }],

  "excerpts": [{
    "id": "sha256:…",
    "source_id": "sha256:…",
    "text": "I wake up at 3am and can't get back to sleep. Every single night.",
    "locator": { "kind": "char_range", "start": 4120, "end": 4187 },
    "captured_at": "2026-09-10T09:14:25Z",
    "node": "review_mining",
    "star_rating": 3,                // review nodes only
    "posted_at": "2026-04-02",
    "axis": "why_quit",              // review nodes only
    "themes": ["3am waking"]
  }],

  "measurements": [{
    "id": "…", "node": "category_data",
    "metric": "search_volume", "value": 1900000, "unit": "searches/month",
    "period": "2026-08", "source_id": "sha256:…", "locator": {…}
  }],

  "attributes": [{
    "id": "…", "node": "product_data",
    "key": "dose_per_serving", "value": "400 mg",
    "source_id": "sha256:…", "locator": {…}
  }],

  "saturation": [{
    "node": "review_mining",
    "curve": [ { "source_id": "sha256:…", "new_themes": 4, "cumulative_themes": 4 },
               { "source_id": "sha256:…", "new_themes": 0, "cumulative_themes": 11 } ],
    "stopped_because": "three consecutive sources added no new theme"
  }],

  "nodes": [{
    "node": "product_data",
    "status": "complete",            // complete | incomplete
    "done_criterion_met": true,
    "why": "10 of 10 mandatory attributes captured; COA gapped"
  }],

  "gaps": [{
    "node": "competitors",
    "missing": "CalmWell ad library returns no UK creative",
    "would_need": "a UK-IP ad-library pull, or a manual capture",
    "blocking": false
  }]
}
```

`brief.url` stays in the contract but the UI never collects it: the operator's
brief is a product and a market, and finding the URLs — own site, reviews,
competitors, ad libraries — is the agent's job, via SearXNG (find) and
Firecrawl (fetch). When it is empty the prompt says so explicitly, or a careful
agent stalls asking for one.

### 4.1 Validation, which is where the rule is enforced

The packet is rejected — the run marked `invalid`, not `completed` — when:

1. Any object carries a key outside the schema. **This is what makes §1.1 real**: an
   agent that writes `"finding": "…"` gets a hard failure, not a warning. Strict
   rejection over silent stripping, because stripping teaches nothing.
2. An excerpt's `source_id` does not resolve to a source in the packet.
3. An admitted `ad_library` source has `first_seen: null` and no matching gap.
4. The `review_mining` node is `complete` with zero 3★ excerpts.
5. **`gaps` is empty.** `spec.md` §4.3: *if the gap list is empty, treat the run as
   failed*. Real research always has holes; a run claiming none is a run that stopped
   looking.
6. A node is `complete` with an empty saturation curve and no finite checklist.

Rule 1 is the load-bearing one and also the most likely to be annoying in practice.
It stays strict until a real run shows it rejecting something legitimate, and if that
happens the fix is to widen the schema deliberately — not to loosen the validator.

---

## 5. Themes

`theme` is a short label attached to excerpts, created by the agent, scoped to one
node and one run. It exists for one reason: the done-criterion is "new sources stop
producing new themes", so without themes there is no measurable done.

Constraints that keep it from becoming a finding:

- A theme has **no description field** — only a label and the excerpts under it.
- Themes do not appear in any stage-1 output the strategist reads. They appear in the
  saturation curve and the cockpit's evidence view, both of which are audit surfaces.
- Stage 2+ may re-cluster freely. A theme is not a commitment.

---

## 6. How the packet gets out of the agent

Two channels, because the two payloads have opposite shapes. Both constraints below
were checked against the running system, not assumed.

**Packet → the run's final output.** hermes's runs API streams `message.delta` and
finishes with `run.completed` carrying `output`
(`gateway/platforms/api_server_runs.py`). The packet is small, structured and
control-plane-ish, so it rides the channel that is guaranteed to be there. The
service extracts the last fenced ```json block from the output and validates it.

**Raw bodies → a shared corpus volume.** Bodies are large and must be stored as the
fetched artifact rather than a summary (`spec.md` §7). The agent writes them with the
shell tool to `/corpus/runs/<run_id>/sources/<sha256>`; the service mounts the same
host directory read-only and serves them for audit.

### 6.1 Why not the obvious alternatives

- **Not a callback into the service.** SEC-001 (setup.md) deliberately removed the
  agent sandbox's route back to the gateway. Giving the research agent — the one
  agent whose whole input is untrusted web content — a fresh write path into the
  app's database would undo the fix that was just made.
- **Not the sandbox's own persistence.** hermes's docker terminal backend does
  bind-mount `/workspace` to `~/.hermes/sandboxes/docker/<task_id>/workspace`
  (`tools/environments/docker.py`, `container_persistent` defaults true), so files
  *do* survive. But the path is keyed by task id, which the service does not control
  or reliably know. An explicit named volume is the same mechanism with a stable address.
- **Not parsing prose.** `cockpit-spec.md` §1: *"If the researcher returns prose, you
  have built a prose viewer with tabs."*

### 6.2 The infrastructure this needs

**Set on the VPS on 2026-09-10**, not aspirational:

A named Docker volume shared between the two containers of the same stack —
no host path, no permissions to get wrong, identical locally and on the VPS:

```yaml
# docker-compose.yaml
hermes:
  volumes: [hermes_home:/opt/data, corpus:/corpus]        # writes
mra:
  volumes: [mra_data:/data, "corpus:/corpus:ro"]          # reads only
```

Two notes, both in `setup.md` §5a:

1. Everything in that container can write to `/corpus`, which is survivable
   precisely because the container runs only the researcher. Nothing under
   `/corpus` may ever be executed or read as instruction — `mra` mounts it
   read-only and serves it as `text/plain` under a `default-src 'none'` CSP.
2. If the volume is absent, sources are emitted with `archived: false` and each one
   generates a gap. **The run still completes.** Degrading honestly beats blocking,
   and the gap list is exactly where "we did not keep the evidence" belongs.

---

## 7. Standing judgements

The demo's step-in loop, made real. A judgement is a persistent rule the human gives
once and the agent applies for the rest of the run *and every future run*.

```
judgement: id · kind · text · created_at · active · applied_count
kind ∈ { source_rule, weighting, avatar_rule, language_rule, custom }
```

Two application paths, and the difference matters:

- **At run start** — active judgements are rendered into the run's instructions, and
  `source_rule` judgements additionally mutate the run's `admission_policy` so
  rejection is mechanical rather than a matter of the model remembering.
- **Mid-run** — `POST /v1/runs/{id}/steer` injects the correction without restarting.
  The run's `applied_count` is incremented by the service when a source is rejected
  under that policy, so "applied 4 times" is a count of real events rather than a
  claim.

Stage 1's judgements are overwhelmingly `source_rule`, which is why admission policy
is a first-class run field rather than a prompt paragraph.

---

## 8. Surfaces

### 8.1 Its own service, not a tab

`cockpit-spec.md` §6 originally put this in agentchat as a second tab. That is
**superseded** — the reasoning is recorded there, and the short version is that
the researcher's whole input is fetched from the open web, so it gets its own
process, its own database, its own login and **its own hermes gateway**.

```
marketing-research-agent/
  backend/mra/
    settings.py    every env var, MRA_-prefixed
    schema.py      the contract in §4 as pydantic models, extra="forbid"
    packet.py      extract the fenced JSON from run output, validate, say why not
    prompt.py      brief + admission policy + judgements -> stage-1 instructions
    store.py       ResearchStore ABC + SqliteResearchStore
    runner.py      RunSupervisor — one task per run, owns the upstream stream
    hermes_runs.py HermesRunsClient — start, events(SSE), steer, stop, status
    api.py         /api/research/*
    app.py         auth + routes + the built SPA
  frontend/src/
    App.tsx        the header-bar shell: subject chip, run clock, step-in, start
    StartRun.tsx   the brief as a modal — product + market, no URL field
    RunView.tsx    the three demo columns: rail, now/lanes/trace, findings
    StageRail.tsx  five stages + the gate; stage 1 live, its four nodes, curves
    StepIn.tsx     standing judgements
  docker-compose.yaml   the whole stack, one file: cockpit, harness, search
                         (SearXNG), page-fetching (Firecrawl's cloud API), and
                         a one-shot `hermes-config` service that points
                         hermes at both — `docker compose up` and done
  searxng/settings.yml   JSON output is off by default upstream; this turns
                         it on, which is the one override SearXNG needs
  deploy/
    Caddyfile.snippet   research.vanis.ai
```

| Endpoint | Does |
|---|---|
| `GET /api/research/runs` | list |
| `POST /api/research/runs` | start a stage-1 run from a brief |
| `GET /api/research/runs/{id}` | run + packet + counts + usage |
| `GET /api/research/runs/{id}/events` | SSE, live; replays persisted events on reconnect |
| `POST /api/research/runs/{id}/steer` | inject a correction |
| `POST /api/research/runs/{id}/stop` | cancel |
| `GET /api/research/judgements` · `POST` · `DELETE /{id}` | standing rules |
| `GET /api/research/runs/{id}/sources/{sha}` | raw body from the corpus volume |
| `GET /api/research/config` | model, corpus path, and whether it is mounted |

**The service persists every event as it arrives.** hermes's SSE queue is
in-memory, single-consumer and not replayable (`_run_streams` is an
`asyncio.Queue`; a second subscriber splits the stream rather than duplicating
it, and a late one misses what came before). So one background task per run owns
the hermes stream and writes to SQLite; the browser reads the service's
replayable stream. Getting this backwards gives you a cockpit that loses the run
when you refresh the page.

**A run survives a restart.** `RunSupervisor.recover()` runs at startup and
reconciles anything left non-terminal against `GET /v1/runs/{id}`. Re-attaching
to the event stream is not an option — hermes drops a run's transport when its
subscriber disconnects — but the status endpoint still answers, which is enough
to record what happened instead of leaving a row that says `running` forever.

### 8.2 Two harnesses

**Same image, separate instance.** The assumption to correct: they are not one
harness with two routes.

| | agentchat | the researcher |
|---|---|---|
| Runs as | systemd user unit on the host | a container in this stack |
| Address | `172.28.0.1:8642` | `hermes:8642`, private compose network |
| `HERMES_HOME` | `~/.hermes` | its own volume |
| Memory key | `agentchat` | `research` |
| Skills, sessions, `state.db` | its own | its own |
| Agent shell runs in | a throwaway container (SEC-001) | its own container |
| Lifecycle | always on | up when you are using it |

This is the isolation that matters. `spec.md` §6.2 and `cockpit-spec.md` §8 both
say the corpus is attacker-influenceable; a shared gateway would put a poisoned
page one tool call away from the chat agent's long-term memory.

**`TERMINAL_ENV=local` inside that container**, which reads alarmingly and is
the right answer: in a container, "local" *is* the sandbox. The alternative
would need the host's Docker socket mounted in, and a Docker socket is a root
shell on the host — it would hand back exactly what SEC-001 took away.

### 8.3 Crawl lanes, and what they are honestly worth

`tool.started` carries `{tool, preview}` where preview is the primary argument,
**truncated** for display (`agent/display.py: build_tool_preview`). So a lane's URL
may be an ellipsis. Lanes are a liveness indicator; the packet is the record.
The cockpit must never count sources from tool events — `web_extract` takes a list
and previews only the first element.

Tool → lane mapping: `web_search` (query), `web_extract` / `browser_navigate` (fetch),
`terminal` (corpus write), `delegate_task` (subagent).

---

## 9. Verification

Stage 1 works when, on a product the agent has never seen:

1. The packet validates against §4 on the **first** run, with no schema loosening.
2. Every excerpt's `source_id` resolves, and every admitted source's body is in the
   corpus volume — or is gapped as unarchived.
3. Five excerpts pulled at random are **byte-identical** to the text on the page they
   claim to come from. This is the check that catches quote drift, and it is done by
   hand.
4. The gap list is non-empty and each entry names something collectable.
5. A rejected source appears in the packet with a reason, and a `source_rule`
   judgement measurably changes what is admitted on the next run.
6. The saturation curve for review mining is monotone-ish and flattens. If it flattens
   at source 3 every time, the threshold in §2 is wrong (too eager) — that is what the
   curve is logged for.
7. **Nothing in the packet reads as a conclusion.** Read it cold: every line should be
   boring. If it is interesting, stage 1 did stage 3's job.

Point 7 is subjective and stays that way. The validator catches the schema violation;
a person catches the sentence that technically fits `attributes` and is really an
opinion.

---

## 10. Not in scope

Stages 2–5, the viability gate, the angle map, the entailment checker, the skill
editor, and the GRADE mode. Each is a later spec. The gate in particular is
tempting because the demo makes it look nearly free — it is not, it needs stage 3
output to gate on.

Ad-library and review scraping are named in `spec.md` §7 as the hostile ones. This
build assumes **whatever hermes's existing web tools can reach**, and everything they
cannot becomes a gap entry. That is the design, not a shortfall: a stage 1 that fails
loudly on a source it cannot get is more useful than one that quietly returns less.

---

## 10a. What the first live runs measured

Written down because these were surprises, and `setup.md` carries the fixes.

**hermes's web tools were both dead.** `web_search` failed with `ddgs package is
not installed` and `web_extract` with *"DuckDuckGo is a search-only backend and
cannot extract URL content"*. Neither failed loudly: the gateway logged a
WARNING and **the agent silently fell back to `browser_exec`**, driving Bing one
page at a time. A run that should take minutes was still crawling after twenty,
and from the outside it looked like a bad agent rather than a broken tool.

Fixed by installing `ddgs` into hermes's venv — with the trap that hermes's venv
has no `pip` and `uv` is not on the non-interactive `PATH` (`~/.hermes/bin/uv`
is the one that exists). Verified live: `web_search` returned 5 results in 2.6s,
no gateway restart needed.

**`web_extract` is still unfixed.** ddgs is search-only, and every extract
backend (firecrawl, tavily, keenable, exa, parallel) wants an API key. Page
fetches go through the browser until that is settled. That is a real ceiling on
stage 1 and it belongs in the gap list of every run made before it is fixed.

**Session reuse silently poisons a run.** Reusing one `session_id` across two
runs made the second inherit the first's transcript — including its failed tool
calls — so it went straight back to the browser instead of retrying search.
hermes loads history from `state.db` when a session is named and *ignores the
request body*, which is the trap `CLAUDE.md` already warns about on the chat
path; it applies to runs too. `RunSupervisor` uses `research-{run_id}`, unique
per run, and §11's question about one-session-per-run is answered: yes,
and not by accident.

**The agent pulls the existing `product-research` skill** (`skill_view` calls in
the trace). Worth knowing, because that skill's methodology is not the
compartment's and nobody asked for it — a reason to build the
`research-compartment` skill sooner rather than later.

**Stage 1 is not a five-minute job.** The first fair run made 48 web searches
before it stopped gathering. `usage` is now recorded per run so cost stops being
a guess.

---

## 11. Open questions

- **Is three the right saturation threshold?** Instrumented, not assumed (§9.6).
- **What does a stage-1 run cost, and how long does it take?** Unknown until the first
  real run. It changes whether re-running a stage is cheap enough to be the default
  correction mechanism.
- ~~**One hermes session per run?**~~ **Answered: yes, and it is load-bearing.**
  A reused session id makes a run inherit the previous one's transcript. See
  §10a.
- **Does the agent reliably emit a valid packet?** The whole design rests on it. If
  the first three runs need hand-fixing, the answer is a stricter prompt or a
  post-run repair pass — **not** a lenient validator.
- **Where do themes live long-term?** In the packet for now. If stage 2 wants to
  re-cluster, they may want to be a separate mutable artifact keyed to immutable
  excerpts.

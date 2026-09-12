# Spec — Stage 1: raw material collection

**Status:** built (stage 1) · **Date:** 2026-09-11 · **Parents:** `spec.md` (what the
researcher does), `cockpit-spec.md` (how you watch it) · **Engine:**
`@earendil-works/pi-agent-core`, in-process (was: hermes runs API — see §6 and §8.2)

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

**Packet → the run's final output.** The agent's assistant text, accumulated across
every turn of the run. The packet is small, structured and control-plane-ish, so it
rides the channel that is guaranteed to be there. The service extracts the last
fenced ```json block from that text and validates it.

> **Superseded (2026-09-11):** this used to read hermes's runs API — `message.delta`
> and a `run.completed` carrying `output`. The harness is now in-process, so the
> channel is `Agent.subscribe()`'s `message_end` events rather than an HTTP stream.
> The *shape* of the contract is unchanged, deliberately: the packet is still the
> last fenced JSON block in what the model wrote, and `packet.ts` did not change when
> the engine did. One trap moved rather than disappearing — the agent re-emits the
> **whole** assistant message on each `message_update`, so a naive "append every
> delta" accumulates the output N times over. `runner.ts` tracks the text per message
> and emits only the growth.

**Raw bodies → a corpus directory.** Bodies are large and must be stored as the
fetched artifact rather than a summary (`spec.md` §7). Every `web_fetch` writes the
body it retrieved to `/corpus/runs/<run_id>/sources/<sha256>` and returns the id to
cite; the service serves them back for audit.

> **Superseded (2026-09-11):** the agent used to write these files itself, with the
> shell tool, and set `archived: true` to say it had. That put a mechanical step on
> the model's to-do list, and a model that skips it emits a packet claiming an
> archive that does not exist — an audit trail that lies. Archiving now happens
> inside the tool, before the agent sees the text, and the `sha256:` id it hands back
> is the hash of the **exact bytes written**. That is what makes
> `GET /api/research/runs/:id/sources/:sha` able to re-hash the file and report
> `X-Corpus-Digest-Matches`; an id computed over any normalised form of the text
> would make that check a permanent false negative.

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

A named Docker volume — no host path, no permissions to get wrong, identical
locally and on the VPS:

```yaml
# docker-compose.yaml
mra:
  volumes: [mra_data:/data, corpus:/corpus]               # writes and reads
```

> **Superseded (2026-09-11):** this was two containers, with `mra` mounting
> `corpus:/corpus:ro` because hermes owned the writes. One process owns both now, so
> the mount is read-write. The property that made read-only worth having is kept
> explicitly rather than by accident — see note 1.

Two notes:

1. Nothing under `/corpus` may ever be executed or read as instruction. The only
   writer is `web_fetch`, which writes a body and nothing else; the only reader is a
   route that serves it as `text/plain` under `Content-Security-Policy: default-src
   'none'` with `X-Content-Type-Options: nosniff`. The read-only mount used to be one
   of the things enforcing that. Now the two ends of the path are.
2. If the volume is absent, sources are emitted with `archived: false` and each one
   generates a gap. **The run still completes.** Degrading honestly beats blocking,
   and the gap list is exactly where "we did not keep the evidence" belongs. The tool
   catches the write failure and reports it in its own result, so the agent is told
   rather than left to infer it.

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
process, its own database and its own login.

> **Superseded (2026-09-11):** "and its own hermes gateway". The harness is now
> embedded in this process, so there is no second gateway. The isolation argument is
> unchanged and is met by narrowing instead: the agent has exactly two tools, both
> read-only against the web, and no shell. See §8.2.

```
marketing-research-agent/
  server/src/
    settings.ts    every env var, MRA_-prefixed
    schema.ts      the contract in §4 as zod objects, .strict()
    packet.ts      extract the fenced JSON from run output, validate, say why not
    prompt.ts      brief + admission policy + judgements -> stage-1 instructions
    tools.ts       web_search (SearXNG) + web_fetch (Firecrawl, auto-archiving)
    store.ts       ResearchStore interface + SqliteResearchStore
    runner.ts      RunSupervisor — one pi Agent per run, owns its event stream
    api.ts         /api/research/*
    app.ts         auth + routes + the built SPA
    main.ts        process entry: recover, then serve
  frontend/src/
    App.tsx        the header-bar shell: subject chip, run clock, step-in, start
    StartRun.tsx   the brief as a modal — product + market, no URL field
    RunView.tsx    the three demo columns: rail, now/lanes/trace, findings
    StageRail.tsx  five stages + the gate; stage 1 live, its four nodes, curves
    StepIn.tsx     standing judgements
  docker-compose.yaml   the whole stack, one file: cockpit (harness inside)
                         and search (SearXNG); page-fetching is Firecrawl's
                         cloud API, called directly — `docker compose up`
  searxng/settings.yml   JSON output is off by default upstream; this turns
                         it on, which is the one override SearXNG needs
  deploy/
    Caddyfile.snippet   marketing.vanis.ai (was research.vanis.ai — renamed at deploy)
    vps/                production compose, deploy.sh, change-password.sh,
                         mra-snapshot.sh — see ../setup.md §5a
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

**The service persists every event as it arrives.** `Agent.subscribe()` is an
in-memory, in-process callback: a listener that is not attached when an event fires
never sees it, and there is no replay. So the supervisor subscribes for the life of
the run and writes every event to SQLite before fanning it out; the browser reads
the service's replayable stream. Getting this backwards gives you a cockpit that
loses the run when you refresh the page. (Under hermes the same rule held for a
different reason — its SSE queue was single-consumer, so a second tab *split* the
stream rather than missing it. Same conclusion, and it is why `api.ts` subscribes
before it replays.)

**A run does not survive a restart.** `RunSupervisor.recover()` runs at startup and
marks anything left non-terminal as `failed`, saying so.

> **Superseded (2026-09-11):** this section previously read "**A run survives a
> restart**" and reconciled non-terminal runs against `GET /v1/runs/{id}`. That was
> true when the run executed inside a separate, longer-lived hermes container. The
> agent now lives in this process and dies with it, so there is nothing upstream to
> ask. Recording the death is the only honest option; inventing an outcome, or
> leaving the row on `running` forever, are both worse. The operational consequence
> is real and belongs in the README: **rebuild between runs, not during one.**

### 8.2 One harness, and a much smaller one

**Superseded (2026-09-11).** This section used to contrast agentchat's hermes with
the researcher's own second hermes instance. There is no second instance now — and
no hermes here at all.

| | agentchat | the researcher |
|---|---|---|
| Engine | hermes gateway, over HTTP | `pi-agent-core`, in-process |
| Runs as | systemd user unit on the host | a container in this stack |
| Model access | gateway's default route | a named OpenRouter model, always |
| Memory across runs | long-term, keyed `agentchat` | none — each run starts clean |
| Tools | shell, browser, files, memory | `web_search`, `web_fetch` |
| Agent shell runs in | a throwaway container (SEC-001) | there is no shell |
| Lifecycle | always on | up when you are using it |

The row that carries the isolation argument is now **Tools**, not the address. A
poisoned page reaching this agent finds two functions that read the web and a
directory it can only append fetched bodies to. It cannot run a command, cannot read
this service's database, and has no memory to persist an instruction into for the
next run — the transcript is discarded when the run ends.

This is the isolation that matters. `spec.md` §6.2 and `cockpit-spec.md` §8 both
say the corpus is attacker-influenceable; a shared gateway would put a poisoned
page one tool call away from the chat agent's long-term memory.

> **Superseded (2026-09-11):** what used to sit here was `TERMINAL_ENV=local` — the
> reasoning being that inside a container, "local" *is* the sandbox, and the
> alternative would need the host's Docker socket mounted in. Moot now: there is no
> terminal tool to configure. The strongest version of that argument is the one that
> survived, which is that the agent was never given a shell in the first place.

### 8.3 Crawl lanes, and what they are honestly worth

`tool.started` carries `{tool, preview, lane}`, where preview is the primary argument
— the query for `web_search`, the url for `web_fetch`. Lanes are a liveness
indicator; **the packet is the record.** The cockpit must never count sources from
tool events: a fetch that fails emits a lane and contributes no source, and one that
succeeds may still be rejected on admission.

Tool → lane mapping: `web_search` → `search`, `web_fetch` → `fetch`.

> **Superseded (2026-09-11):** the preview used to arrive already truncated by
> hermes (`agent/display.py: build_tool_preview`), so a lane's URL might be an
> ellipsis, and `web_extract` took a *list* while previewing only its first element —
> which is what made "never count sources from lanes" load-bearing rather than
> stylistic. Both quirks are gone: the preview is built here, from the real argument,
> and `web_fetch` takes exactly one url. The rule stays anyway, for the reason above.

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
build assumes **whatever SearXNG can find and Firecrawl can read**, and everything
they cannot becomes a gap entry. That is the design, not a shortfall: a stage 1 that
fails loudly on a source it cannot get is more useful than one that quietly returns
less.

> **Superseded (2026-09-11):** this read "whatever hermes's existing web tools can
> reach". The clause was doing more work than it looked like — under hermes, "what
> the tools can reach" depended on which backend the harness had auto-detected on
> that machine, which is exactly how the first live run ended up driving a browser
> (§10a). Naming the two services makes the boundary a property of this repo instead
> of a property of the deployment. The principle is unchanged, and it is the reason
> `web_fetch` throws on a Firecrawl error rather than returning an empty string: a
> tool that fails silently turns a reachability limit into a fabricated absence.

---

## 10a. What the first live runs measured

Written down because these were surprises, and `setup.md` carries the fixes.

> **Historical (2026-09-10), and kept deliberately.** The first three findings below
> are about the hermes stack and no longer describe how this runs — but they are the
> argument that produced the port, so deleting them would delete the reasoning. The
> pattern worth carrying forward: *every one of them was a silent degradation.* A
> dead search tool that logged a WARNING and fell back to a browser; an extract
> backend that did not exist; a reused session that inherited a poisoned transcript.
> None of them failed loudly, and all three looked like a bad agent from the outside.
> §10b records what the same run looks like now.

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

## 10b. What the port measured

First run on the in-process engine, 2026-09-11, `deepseek/deepseek-v4-flash-0731`,
brief "MagnaCalm magnesium glycinate 400mg / UK". Cancelled at ~9 minutes rather than
run to completion, so these are floor figures, not a full run:

| | |
|---|---|
| Tool calls | 14 in the first 75 seconds (searches and fetches interleaved) |
| Events persisted | 3,303 |
| Bodies archived | 14 |
| Tokens | 702,322 total — 288,918 input, 406,528 **cache reads**, 6,876 output |
| Cost | $0.0265 |

Three things this actually established, none of which were assumed:

1. **Cache reads dominate.** 406k of 702k tokens were cache hits, because the run is
   dozens of turns over a growing transcript and `Agent` is given a stable
   `sessionId` per run. Cache reads are priced at roughly a quarter of input here, so
   this is most of why a 700k-token run costs under three cents. A model without
   prompt caching would cost several times this for identical work.
2. **Usage must be summed across turns.** The final assistant message carries only its
   own turn — reporting that number would understate a run by an order of magnitude.
   `runner.ts` accumulates it, and §11's cost question is answerable because of that.
3. **Cancel settles cleanly.** `run.stopping` → `run.cancelled`, `live: false`, usage
   and partial output retained. The abort is distinguished from a failure by whether
   the operator asked for it, which is why a stopped run does not read as a crash.

The corpus audit was checked end to end on this run's real data:
`GET /api/research/runs/:id/sources/:sha` returned the archived body with
`X-Corpus-Digest-Matches: true`, `text/plain`, and `default-src 'none'`.

---

## 11. Open questions

- **Is three the right saturation threshold?** Instrumented, not assumed (§9.6).
- ~~**What does a stage-1 run cost?**~~ **Answered, and the answer changes the
  design.** ~700k tokens and $0.027 for nine minutes of gathering (§10b), most of it
  cache reads. Re-running a stage is cheap enough to be the default correction
  mechanism — which is the assumption the whole "correct it with a judgement and run
  it again" loop rested on. Still open: what a run that reaches saturation on all
  four nodes costs, since the measured run was cancelled.
- ~~**One hermes session per run?**~~ **Answered: yes, and it is load-bearing.**
  A reused session id made a run inherit the previous one's transcript (§10a). Moot
  in its original form — there is no hermes and no `state.db` to load history from,
  and each run builds a fresh `Agent` with an empty transcript, so isolation is now
  the default rather than something to get right. The `sessionId` is still unique per
  run, for a different reason: it is the prompt-cache key, and sharing it across runs
  would mean cache hits against an unrelated transcript.
- **Does the agent reliably emit a valid packet?** The whole design rests on it. If
  the first three runs need hand-fixing, the answer is a stricter prompt or a
  post-run repair pass — **not** a lenient validator.
- **Where do themes live long-term?** In the packet for now. If stage 2 wants to
  re-cluster, they may want to be a separate mutable artifact keyed to immutable
  excerpts.

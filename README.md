# marketing-research-agent

The researcher, and the cockpit you watch it from. Live at
**https://research.vanis.ai**.

Stage 1 of five is built. The rest is specified and not written.

## Read in this order

| File | What it is |
|---|---|
| `spec.md` | the researcher — what the compartment produces and why it is trustworthy |
| `spec-stage-1.md` | **stage 1**: the run contract, the four nodes, and how a packet is refused |
| `cockpit-spec.md` | how you watch it. §6 is superseded and says why |
| `cockpit-demo/` | the scripted UI demo of all five stages; still the clearest picture of where this goes |

The two PDFs are the sources: the compartment framework, and the book-to-skill
packaging method.

## The one idea

Stage 1 gathers raw material and **draws no conclusions**. `spec.md` names
concluding-while-collecting as the single most common failure in this
framework, so rather than instructing the agent not to:

> **The stage-1 output schema has no field a conclusion could be written into.**

No `claim`, no `finding`, no `summary`; `.strict()` on every object. An agent
that writes `"finding": …` gets a hard rejection naming the field and the run
ends `invalid` — a status kept distinct from `failed` because *the agent
finished and produced something wrong* is the most informative failure there is.

Three things are allowed, because they are transcription rather than judgement:
an **excerpt** (a verbatim span), a **measurement** (a number a source states),
and an **attribute** (a field read off a page). The test is: *if a second person
with the same source would write down a different value, it is a judgement.*

## Why it is its own service

`cockpit-spec.md` §6 first said this would be a tab in agentchat. It is not, and
the reversal is the more useful record:

**The researcher's entire input is fetched from the open web, and a fetched page
can contain instructions.** Sharing agentchat's process meant sharing a database
with an agent whose input is attacker-influenceable; sharing one hermes gateway
meant sharing `state.db`, long-term memory, sessions and the skills directory
with it too. So it gets its own everything, as its own stack.

The duller argument is just as real: a research run is measured in hours and a
chat deploy in minutes. Coupled, every UI tweak risks a running job.

**Superseded:** that used to mean *its own hermes container*, and it no longer
does. The harness runs inside this service now (`@earendil-works/pi-agent-core`,
in-process), so there is no second gateway to isolate against. The isolation
argument survives intact and is met more cheaply: the agent is handed exactly
two tools, `web_search` and `web_fetch`, and neither can run a command, read a
file, or reach another agent's memory. A poisoned page's best case is lying to
the packet, and the packet is validated.

That is a narrowing, not a loss. Under hermes the agent's web access depended on
which backend the harness had auto-detected, and the first live run fell back to
driving a browser because `ddgs` was missing on the VPS — a failure that looked
like an idle run. Two functions in this repo behave the same way on every
machine.

## Layout

```
docker-compose.yaml   the whole stack, one file: cockpit and search —
                       `docker compose up` and done
searxng/settings.yml  the one override SearXNG needs (JSON output is off by
                       default) — see the file for why
server/src/
  settings.ts     every env var, MRA_-prefixed
  schema.ts       the run contract; .strict() is the guarantee, not tidiness
  packet.ts       find the JSON in the output (forgiving), then validate (not)
  prompt.ts       brief + admission policy + judgements -> instructions
  tools.ts        web_search (SearXNG) + web_fetch (Firecrawl, auto-archiving)
  store.ts        ResearchStore interface + SqliteResearchStore
  runner.ts       RunSupervisor — one pi Agent per run, owns its event stream
  api.ts          /api/research/*
  app.ts          auth + routes + the built SPA
  main.ts         process entry: recover, then serve
server/tests/     vitest; most of it is about what the validator refuses
frontend/src/     React 18 + Vite, no UI framework
deploy/           the Caddy snippet for research.vanis.ai
```

The engine is `@earendil-works/pi-agent-core`, embedded in this process rather
than called over HTTP. `runner.ts` builds one `Agent` per run, subscribes to its
events, and writes every one to SQLite before fanning it out — so a browser
refresh replays the run instead of losing it.

## Run it

One file, one command. Everything is containerised, so none of it has to be up
when you are not using it.

### First time

```bash
cd marketing-research-agent
cp .env.example .env
```

Four values go in `.env`. Two are secrets you generate, two are API keys you
paste:

```bash
# generate these two
openssl rand -hex 32    # -> MRA_JWT_SECRET
openssl rand -hex 32    # -> SEARXNG_SECRET
```

| Key | Where from |
|---|---|
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys — inference |
| `FIRECRAWL_API_KEY` | https://www.firecrawl.dev/app/api-keys — page fetching, free tier |

`.env` is gitignored and should stay that way. `chmod 600 .env` is worth doing.

### Start it

```bash
docker compose up -d --build
open http://localhost:8080
```

First `up` pulls ~100 MB for SearXNG and builds the cockpit image, which
compiles `better-sqlite3` from source on alpine — a couple of minutes, once.

### Check it came up clean

Two things, because one of them fails quietly:

```bash
# 1. searxng and mra should both be Up.
docker compose ps

# 2. Should return JSON, not HTML and not a 403.
docker compose exec mra node -e \
  "fetch('http://searxng:8080/search?q=test&format=json').then(r=>r.text()).then(t=>console.log(t.slice(0,200)))"
```

Check 2 is the one worth doing: SearXNG ships with JSON output **disabled**, and
`searxng/settings.yml` is what turns it on. If that mount ever fails, every
`web_search` call throws on a 403 — loudly, which is the point, but the message
names SearXNG rather than the config file that caused it.

### Stop it

```bash
docker compose down      # volumes keep your runs and the corpus
```

`docker compose down -v` also deletes the volumes — your run history and every
archived page. Rarely what you want.

### When something breaks

```bash
docker compose logs -f            # everything, live
docker compose logs mra           # just the cockpit and the agent
docker compose up -d --build mra  # rebuild just the cockpit after a code change
```

| Symptom | Likely cause |
|---|---|
| Every `web_search` fails with a 403 | SearXNG JSON disabled — the `searxng/settings.yml` mount failed (check 2 above) |
| Every `web_fetch` fails | `FIRECRAWL_API_KEY` unset or out of quota; the error names Firecrawl and the status |
| A run says `failed` with "the server restarted" | exactly what it says — the agent runs in this process, so a rebuild or restart kills a run in flight |
| Login succeeds then immediately logs out | `MRA_COOKIE_SECURE=true` over plain `http://localhost`; `.env.example` sets it false for this reason |
| Cockpit unreachable | the stack is on-demand — `docker compose ps`, then `up -d` |
| Runs fail immediately with "unknown model" | `MRA_MODEL` is not an OpenRouter model id |
| Every source comes back `archived: false` | the `corpus` volume is not mounted; `GET /api/research/config` reports `corpus_mounted` |

**A restart ends a run.** Under hermes a run outlived the cockpit and could be
reconciled on the way back up. It cannot now, so `recover()` marks anything left
`running` as `failed` and says why, rather than leaving a row that never moves
again. Rebuild between runs, not during one.

### Two safety defaults worth knowing

Bound to `127.0.0.1` — with no `MRA_APP_PASSWORD_HASH` set, login is disabled,
and an unauthenticated agent with web access should not be listening on your
LAN. `.env.example` also sets `MRA_COOKIE_SECURE=false`: a browser silently
drops a `Secure` cookie over plain `http://localhost`, so without that, login
would appear to work and then immediately log you back out.

Set a password before this reaches any shared network:

```bash
docker compose run --rm --entrypoint sh mra -c "npm run hashpw"   # -> MRA_APP_PASSWORD_HASH
```

### What the agent can reach

Two functions, and nothing else. No shell, no filesystem, no second agent's
memory. `web_fetch` writes to one directory — this run's corpus — and the route
that serves those bytes back sends them as `text/plain` under
`Content-Security-Policy: default-src 'none'`, so a scraped page cannot become a
script on this origin.

That matters more here than in most services: stage 1 reasons over pages fetched
from the open web, which is the textbook setup for prompt injection. The blast
radius is a packet that lies, and the packet is validated.

### Search and page-fetching

Stage 1 is mostly a web-search agent, so what it searches and fetches with
matters. Two pieces, wired in as one container plus one API key:

- **SearXNG** — a free, self-hosted metasearch engine, one container
  (`searxng`, ~100 MB), no API key, no per-query cost. It aggregates several
  search engines without handing your queries to any one of them as the
  vendor of record.
- **Firecrawl** — fetches a found page's content, cleaned up for an LLM to
  read. Wired to their **cloud API** (`FIRECRAWL_API_KEY`, free tier
  available) rather than self-hosted: their own stack is 5+ containers (an
  API, a headless-browser service, Redis, RabbitMQ or FoundationDB, Postgres)
  built from source, not pulled as images — a project of its own, not a
  compose-file addition. Worth doing later if you want zero cloud
  dependency; not done here.

**No manual step required, and no auto-detect to get wrong.** `tools.ts` calls
SearXNG for search and Firecrawl for content, always, by name. The previous
stack had to correct hermes's own backend auto-detect with a one-shot
`hermes-config` container, because with both configured hermes preferred
Firecrawl for search too and silently skipped SearXNG. That whole service is
gone; there is no configuration step left to forget.

`web_fetch` also archives every body it retrieves, hashes it, and hands the
agent back the `sha256:…` id to cite. Under hermes the agent was told to write
those files itself with the terminal tool — a mechanical step on the model's
to-do list, and a model that skipped it produced a packet claiming
`archived: true` over a file that did not exist. The id is now the hash of the
exact bytes on disk, which is what makes
`GET /api/research/runs/:id/sources/:sha` able to re-hash the file and tell you
whether it still matches.

### Without Docker

```bash
cd server && npm install && npm test      # 88 tests
npm run dev                               # :8000, tsx watch
cd ../frontend && npm install && npm run dev   # :5173, proxies /api to :8000
```

You need `OPENROUTER_API_KEY` and `FIRECRAWL_API_KEY` in the environment, and a
SearXNG to point `SEARXNG_URL` at — `docker compose up -d searxng` is enough,
with `SEARXNG_URL=http://127.0.0.1:8080` once you publish its port.

Every behavioural fix here has a regression test; keep that true. Most of them
are about what the validator **refuses**, which is where the value is.

## Deploy

Not done yet, and not urgent — this runs locally for now. When it happens, the
one thing that changes is `mra`'s `ports:` line: a host-bound port makes sense
for one person on one laptop, but the VPS reaches everything through Caddy on
a private Docker network instead, the same as agentchat does. `../setup.md`
§5a has the fuller plan (DNS, Caddy, what changes) from when this was designed
to run that way; it will need a look once deployment is actually next.

## What is not built

Stages 2–5, the viability gate, the angle map, the entailment checker, the skill
editor and GRADE mode. The stage rail renders them as `not built` rather than
hiding them, because four fifths greyed out is an accurate picture.

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

No `claim`, no `finding`, no `summary`; `extra="forbid"` on every model. An
agent that writes `"finding": …` gets a hard rejection naming the field and the
run ends `invalid` — a status kept distinct from `failed` because *the agent
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
with it too. So it gets its own everything, **including its own hermes**, as a
container in this stack.

The duller argument is just as real: a research run is measured in hours and a
chat deploy in minutes. Coupled, every UI tweak risks a running job.

## Layout

```
docker-compose.yaml   the whole stack, one file: cockpit, its own harness,
                       search, page-fetching — `docker compose up` and done
searxng/settings.yml  the one override SearXNG needs (JSON output is off by
                       default) — see the file for why
backend/mra/
  settings.py     every env var, MRA_-prefixed
  schema.py       the run contract; extra="forbid" is the guarantee, not tidiness
  packet.py       find the JSON in the output (forgiving), then validate (not)
  prompt.py       brief + admission policy + judgements -> instructions
  store.py        ResearchStore ABC + SqliteResearchStore
  runner.py       RunSupervisor — one task per run, owns the upstream stream
  hermes_runs.py  the runs API; its own adapter, a different boundary
  api.py          /api/research/*
  app.py          auth + routes + the built SPA
frontend/src/     React 18 + Vite, no UI framework
deploy/           the Caddy snippet for research.vanis.ai
```

## Run it

One file, one command. Everything is containerised, including the harness, so
none of it has to be up when you are not using it.

### First time

```bash
cd marketing-research-agent
cp .env.example .env
```

Five values go in `.env`. Three are secrets you generate, two are API keys you
paste:

```bash
# generate these three
openssl rand -hex 24    # -> HERMES_API_KEY
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

First `up` pulls ~1 GB (about 3 GB on disk) for the hermes image, plus ~100 MB
for SearXNG — so give it a few minutes. Note Docker stores images under its
own root directory, which may be on a different partition than `/`; check with
`docker info --format '{{.DockerRootDir}}'` before blaming a full root disk.

### Check it came up clean

Three things, because two of them fail quietly:

```bash
# 1. searxng / hermes / mra should be Up.
#    hermes-config should be Exited (0) — that is SUCCESS, not a crash.
docker compose ps

# 2. Should print: [hermes-config] search=searxng extract=firecrawl — done
docker compose logs hermes-config

# 3. Should return JSON, not HTML and not a 403.
docker compose exec hermes curl -s "http://searxng:8080/search?q=test&format=json" | head -c 200
```

Check 3 is the one worth doing: SearXNG ships with JSON output **disabled**,
and `searxng/settings.yml` is what turns it on. If that mount ever fails, every
search returns HTML, hermes reports no results, and it reads as a hermes bug
rather than a config one.

### Stop it

```bash
docker compose down      # volumes keep your runs and the corpus
```

`docker compose down -v` also deletes the volumes — your run history, the
harness's memory, and every archived page. Rarely what you want.

### When something breaks

```bash
docker compose logs -f            # everything, live
docker compose logs hermes        # just the harness
docker compose logs mra           # just the cockpit
docker compose restart hermes     # bounce one service
docker compose up -d --build mra  # rebuild just the cockpit after a code change
```

| Symptom | Likely cause |
|---|---|
| `hermes-config` shows `Exited (0)` | Not a fault — it is a one-shot that ran and finished |
| Search returns nothing, agent falls back to a browser | SearXNG JSON disabled (check 3 above), or `hermes-config` failed before setting the backend |
| Login succeeds then immediately logs out | `MRA_COOKIE_SECURE=true` over plain `http://localhost`; `.env.example` sets it false for this reason |
| Cockpit unreachable | the stack is on-demand — `docker compose ps`, then `up -d` |
| Runs fail with a connection error | `HERMES_API_KEY` differs between services, or hermes is not up: `docker compose logs hermes` |
| Every source comes back `archived: false` | the `corpus` volume is not mounted; `GET /api/research/config` reports `corpus_mounted` |

### Two safety defaults worth knowing

Bound to `127.0.0.1` — with no `MRA_APP_PASSWORD_HASH` set, login is disabled,
and an unauthenticated agent with web access and a shell should not be
listening on your LAN. `.env.example` also sets `MRA_COOKIE_SECURE=false`: a
browser silently drops a `Secure` cookie over plain `http://localhost`, so
without that, login would appear to work and then immediately log you back out.

Set a password before this reaches any shared network:

```bash
docker compose run --rm --entrypoint python mra -m mra.hashpw   # -> MRA_APP_PASSWORD_HASH
```

### Two harnesses, same image

Worth being explicit because it is easy to assume otherwise: this stack runs
**its own hermes instance**, not agentchat's. Same image, separate container,
separate volume, separate `state.db`, memory, sessions and skills. That
separation is the reason it is a separate stack at all.

### Search and page-fetching

Stage 1 is mostly a web-search agent, so what it searches and fetches with
matters. Two pieces, wired in as a third container plus one API key:

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

**No manual step required.** hermes reads which backend to use for search vs.
extraction from its *own* config file, not from environment variables — so
setting `SEARXNG_URL`/`FIRECRAWL_API_KEY` is not enough by itself, and with
both configured hermes's auto-detect would otherwise prefer Firecrawl for
search too, silently skipping SearXNG. `docker-compose.yaml` has a fourth
service, `hermes-config`, that runs once, points each capability at the right
backend, and exits — `docker compose ps` showing it `Exited (0)` is success,
not a crash. It edits the shared `hermes_home` volume directly, so it survives
restarts without needing to run again.

### Without Docker

```bash
cd backend && pip install -e ".[dev]" && python -m pytest tests/ -q
python -m mra                                    # :8000
cd ../frontend && npm install && npm run dev      # :5173, proxies /api to :8000
```

You still need a hermes to point `MRA_HERMES_BASE_URL` at.

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

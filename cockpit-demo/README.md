# Research cockpit — demo UI

Front-end only. **No backend, no API keys, nothing to install** — every event is
scripted in `demo.js`. Built to show someone what the researcher agent would feel
like to supervise, before any of it exists.

## Run it

```bash
xdg-open index.html          # or just double-click it
```

Unattended demo screen (auto-starts and plays through the gate):

```
index.html?auto=1
```

## The demo, in order

1. **Press “Start run”.** Stage 1 begins and the agent fans out across sources —
   several fetches in flight at once, each showing the URL, a progress bar, and
   what kind of source it is. The reasoning trace names every link as it goes.
2. **Findings accumulate on the right** — sources, claims split by
   `evidenced` / `inferred`, gaps, the angle-map matrix, and verbatim customer
   language with a provenance pill on each quote.
3. **Press “Step in” at any point.** The run pauses and offers strategy
   corrections — reject SEO listicles, weight 3★ reviews, always check for proxy
   buyers, never paraphrase. Or type your own.
4. **Watch the correction take effect.** After rejecting listicles, later
   listicle fetches show `SKIPPED · per your rule`, the trace says
   *"skipped — your judgement: no SEO listicles"*, and the judgement card counts
   how many times it has been applied. **This is the moment worth demoing** —
   the agent visibly does not repeat the mistake.
5. **The viability gate blocks the run.** Five criteria with their evidence, four
   passing. Proceed, reposition, or drop. Stage 4 does not start until you decide,
   which is the framework's point — the expensive customer work never runs on a
   market you would have killed.
6. **Run completes** with the angle map populated, cells coloured by provenance,
   and a non-empty gap list.

## What is real and what is theatre

| Real | Theatre |
|---|---|
| The layout, the interaction model, the judgement loop | Every URL, quote and number |
| The stage order and the gate blocking stage 4 | Timings (compressed to ~40s) |
| Provenance marking, the gap list, coverage holes | The crawling — nothing is fetched |

The framework it dramatises is real: `../spec.md` and the two source PDFs. What
it would take to make it real is `../cockpit-spec.md` — and the honest headline
there is that **the cockpit can only render the structure the agent emits**, so
the run contract comes before any of this UI.

## Stage 1 is no longer theatre

`../spec-stage-1.md` is the run contract for stage 1, and it is built: the
**Research** tab in agentchat (`app/`) runs it against the real hermes runs API.
Real there and simulated here:

| Here (demo) | There (built) |
|---|---|
| Scripted fetches | hermes tool events over SSE, persisted and replayable |
| Findings appear on a timer | a validated JSON packet, or the run ends `invalid` |
| Judgements change later lanes | judgements mutate the admission policy and `/steer` a live run |
| All five stages animate | stage 1 only; 2–5 render as `not built` |
| The gate blocks | not built — it needs stage-3 output to gate on |

This demo stays because it is still the clearest picture of where the whole
compartment is going, and because the gate and the angle map do not exist yet.

## Files

```
index.html   markup + styles, self-contained
demo.js      the scripted run, the crawl lanes, and the judgement loop
```

No build step, no dependencies. `?auto=1` is the only option.

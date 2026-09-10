"""Build the stage-1 instructions handed to hermes.

The prompt has one job the validator cannot do for it: get the agent to gather
rather than conclude. The validator can only reject a packet that has already
been written, so the prompt states the rule and the schema removes the place to
break it. Both, or the failure mode is a run that costs money and fails at the
last step.

Kept in one module because the exact wording is a thing you tune against real
runs, and it should be diffable on its own.
"""

from __future__ import annotations

import json

from .schema import (
    DEFAULT_REJECTED_KINDS,
    PRODUCT_ATTRIBUTES,
    SOURCE_KIND_NOTES,
    Brief,
)
from .store import Judgement

# A worked miniature. Models follow an example far more reliably than a prose
# description of a schema, and a wrong-shaped packet costs a whole run.
_EXAMPLE = {
    "contract_version": "1",
    "stage": 1,
    "brief": {"product": "MagnaCalm glycinate 400mg", "url": "https://…", "market": "UK"},
    "sources": [
        {
            "id": "sha256:2f1a…", "url": "https://reddit.com/r/insomnia/comments/9d1x",
            "title": "Anyone else waking at 3am?", "kind": "forum",
            "publisher": "reddit.com", "fetched_at": "2026-09-10T09:14:22Z",
            "marketing": False, "admitted": True,
            "admission_reason": "forum — admitted by policy",
            "archived": True, "node": "review_mining",
        },
        {
            "id": "sha256:7d5b…", "url": "https://amazon.co.uk/product-reviews/B0C?filter=3star",
            "title": "MagnaCalm reviews, 3 star", "kind": "marketplace_review",
            "publisher": "amazon.co.uk", "fetched_at": "2026-09-10T09:20:11Z",
            "marketing": False, "admitted": True,
            "admission_reason": "marketplace_review — admitted by policy",
            "archived": True, "node": "review_mining",
        },
        {
            "id": "sha256:9c04…", "url": "https://top10supplementpicks.net/best-magnesium",
            "title": "Best magnesium 2026", "kind": "seo_listicle",
            "publisher": "top10supplementpicks.net",
            "fetched_at": "2026-09-10T09:15:02Z", "marketing": True,
            "admitted": False,
            "admission_reason": "seo_listicle — rejected by admission policy",
            "archived": False, "node": "competitors",
        },
    ],
    "excerpts": [
        {
            "id": "sha256:4b7e…", "source_id": "sha256:2f1a…",
            "text": "I wake up at 3am and can't get back to sleep. Every single night.",
            "locator": {"kind": "char_range", "start": 4120, "end": 4187},
            "captured_at": "2026-09-10T09:14:25Z", "node": "review_mining",
            "star_rating": None, "posted_at": "2026-04-02", "axis": "why_bought",
            "themes": ["3am waking"],
        },
        {
            "id": "sha256:e10c…", "source_id": "sha256:7d5b…",
            "text": "Took it for a week, felt nothing, cancelled. Turns out you need six weeks.",
            "locator": {"kind": "char_range", "start": 812, "end": 886},
            "captured_at": "2026-09-10T09:20:14Z", "node": "review_mining",
            "star_rating": 3, "posted_at": "2026-05-19", "axis": "why_quit",
            "themes": ["time to effect"],
        },
    ],
    "measurements": [
        {
            "id": "m1", "node": "category_data", "metric": "search_volume",
            "value": 1900000, "unit": "searches/month", "period": "2026-08",
            "source_id": "sha256:2f1a…",
        }
    ],
    "attributes": [
        {
            "id": "a1", "node": "product_data", "key": "dose_per_serving",
            "value": "400 mg", "source_id": "sha256:2f1a…",
        }
    ],
    "saturation": [
        {
            "node": "review_mining",
            "curve": [
                {"source_id": "sha256:2f1a…", "new_themes": 4, "cumulative_themes": 4},
                {"source_id": "sha256:7d5b…", "new_themes": 0, "cumulative_themes": 11},
            ],
            "stopped_because": "three consecutive sources added no new theme",
        }
    ],
    "nodes": [
        {
            "node": "review_mining", "status": "complete", "done_criterion_met": True,
            "why": "saturated at 14 sources; 3-star coverage present",
        }
    ],
    "gaps": [
        {
            "node": "competitors",
            "missing": "CalmWell ad library returns no UK creative",
            "would_need": "a UK-IP ad-library pull, or a manual capture",
            "blocking": False,
        }
    ],
}

_RULES = """\
## Stage 1 — raw material. Gather only.

You are running stage 1 of a five-stage marketing research compartment. Stage 1
collects material. It does not interpret it. Concluding while collecting is the
single most common failure in this framework, and the output schema has no field
a conclusion could be written into — if you find yourself wanting to write down
what the material *means*, that belongs to a later stage and there is nowhere to
put it here.

Three things are not conclusions and are what you are here for:

- **excerpts** — text copied verbatim from a source, character for character
- **measurements** — a number a source states, with its unit and period
- **attributes** — a field read off a page (dose, price, format, first-seen date)

The test: if a second person reading the same source would write down a
different value, it is a judgement and does not belong in stage 1.

### The four nodes

1. **product_data** — a finite checklist, not a search. Capture every one of:
   {attributes}. Anything you cannot find is a gap entry, not an omission and
   not a zero. A missing certificate of analysis is a gap.
2. **competitors** — name, url, verbatim positioning copy, price, format, and
   ad-library entries. **Every ad entry must carry `first_seen`**; ad longevity
   is the only outside performance signal that exists. An ad with no date is
   captured with `first_seen: null` AND recorded as a gap.
3. **review_mining** — verbatim customer language with star rating, date, and a
   three-axis code (`why_bought` / `why_stayed` / `why_quit`). **You must
   capture 3-star reviews specifically** — they are the most honest text in
   commerce. Never clean up, summarise or paraphrase a quote: "I wake up at 3am
   and can't get back to sleep" is usable and "sleep maintenance issues" is not,
   and the degradation is irreversible.
4. **category_data** — search volume as a trend over at least three years (a
   single point estimate is a gap), category size figures, seasonality. Numbers
   with their source, never your reading of them.

### Done is saturation, not a quota

A node is done when three consecutive admitted sources produce **no new theme**.
Do not aim for a number of sources or quotes: a quota you cannot honestly fill
is the thing that makes inventing citations the path of least resistance. Log
the curve — `new_themes` per source — so "it stopped yielding" is a number.

A **theme** is a short label over excerpts. It is a working index for measuring
saturation, not a finding. Give it a label and nothing else.

### Admission

Fetch what you like, but record every source you touched with `admitted` and
`admission_reason`. **Rejected sources stay in the packet** — they are evidence
of what was searched.

`kind` must be **exactly one of** these. There are no others, and inventing one
fails the whole packet — pick the closest:

{kinds}

These kinds are rejected by this run's policy:

{rejected}

Anything promotional gets `marketing: true`, including a brand's own site. That
is not a rejection; it marks a claim resting only on marketing as weaker than
one resting on a certificate of analysis.

### Archiving the raw material

For every admitted source, write the fetched body to
`{corpus}/runs/{run_id}/sources/<sha256>` using the terminal tool, where
`<sha256>` is the id you give the source, and set `archived: true`. If that
directory is not writable, set `archived: false` and add one gap entry saying
the corpus volume was unavailable — then carry on. The run is not blocked by it.

Use the sha256 of the captured text as the source id, prefixed `sha256:`.

### The gap list is a required output

What you could not find, per node, and what it would take to get it. A run that
reports no gaps is treated as failed, because real research always has holes and
an agent that cannot say "I could not find this" will invent it instead.

A run-level problem that is not one of the four nodes — a tool failing, the
corpus volume unavailable, a fetch path blocked — still goes in this list.
Attach it to the node it blocked; if it blocked nothing in particular, use
`node: "category_data"`. Never invent a fifth node name (`all`, `general`,
`run`): only `product_data`, `competitors`, `review_mining`, `category_data`
are accepted, and anything else fails the whole packet.
"""

_OUTPUT = """\
## Output

End your reply with exactly one fenced JSON block containing the stage-1 packet.
Everything outside the fence is ignored. The block must match this shape exactly
— **any key not in this schema is rejected and the run fails**:

```json
{example}
```

Field notes:

- `star_rating` and `axis` apply to review excerpts only; use `null` elsewhere.
  `posted_at` is a string: a date like "2026-05-18" when the source shows one,
  or "" when it does not. Never `null` — `null` fails validation.
- `locator` is optional but strongly preferred: `{{"kind": "char_range",
  "start": N, "end": N}}` so a span can be checked against the archived body.
- `nodes` must contain an entry for each of the four nodes, `complete` or
  `incomplete`, with `why` naming the criterion that was or was not met.
- `gaps` must not be empty.
"""


def build_instructions(
    *,
    brief: Brief,
    run_id: str,
    reject_kinds: list[str],
    judgements: list[Judgement],
    corpus_path: str,
) -> str:
    """Assemble the whole user turn for one stage-1 run."""
    rejected = reject_kinds or list(DEFAULT_REJECTED_KINDS)
    parts = [
        _RULES.format(
            attributes=", ".join(f"`{a}`" for a in PRODUCT_ATTRIBUTES),
            kinds="\n".join(f"- `{kind}` — {note}" for kind, note in SOURCE_KIND_NOTES),
            rejected="\n".join(f"- `{kind}`" for kind in rejected) or "- (none)",
            corpus=corpus_path.rstrip("/"),
            run_id=run_id,
        )
    ]
    if judgements:
        parts.append(_judgement_block(judgements))
    parts.append(_brief_block(brief))
    parts.append(_OUTPUT.format(example=json.dumps(_EXAMPLE, indent=2)))
    return "\n\n".join(parts)


def _judgement_block(judgements: list[Judgement]) -> str:
    """Standing corrections. These outrank the defaults above.

    A `source_rule` is also applied mechanically through the admission policy —
    this block exists so the agent knows *why* a kind is rejected, not so it has
    to remember to do it.
    """
    lines = [
        "## Standing judgements",
        "",
        "Corrections a human has given on previous runs. They apply to this run "
        "and outrank the defaults above. You should not need telling twice.",
        "",
    ]
    lines += [f"- **{j.kind}** — {j.text}" for j in judgements]
    return "\n".join(lines)


def _brief_block(brief: Brief) -> str:
    lines = ["## The brief", "", f"**Product:** {brief.product}"]
    if brief.url:
        lines.append(f"**Product URL:** {brief.url}")
    else:
        # The normal case: the operator names a product and a market, and the
        # agent finds everything. Saying so matters — without the line, a
        # careful agent stalls asking for a URL it was never going to get.
        lines.append(
            "No product URL was supplied — finding it is part of the job. Use "
            "web search to locate the product's own site first, then the "
            "reviews, competitors, ad-library entries and category data the "
            "four nodes need."
        )
    if brief.market:
        lines.append(f"**Market:** {brief.market}")
    if brief.notes:
        lines.append(f"**Notes:** {brief.notes}")
    return "\n".join(lines)


def steer_text(judgement: Judgement) -> str:
    """One correction, injected mid-run.

    Phrased as a rule rather than a request: the agent is mid-task and a polite
    suggestion competes with the instructions it already has.
    """
    rejects = ""
    if judgement.rejects_kinds:
        kinds = ", ".join(f"`{k}`" for k in judgement.rejects_kinds)
        rejects = (
            f" From now on, treat sources of kind {kinds} as rejected: still "
            "record them in the packet with `admitted: false` and this reason."
        )
    return (
        "Standing judgement from the human supervising this run — apply it for "
        f"the rest of the run: {judgement.text}{rejects}"
    )

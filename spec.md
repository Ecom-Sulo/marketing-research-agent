# Spec — Market research agent (the researcher)

**Status:** design, not built · **Date:** 2026-09-09 · **Runs on:** hermes harness (`spec-hermes-agent.md`), reachable from `chat.vanis.ai`

## 1. Scope

One agent: **the researcher**. It runs stage one of a marketing production cycle and produces artifacts a human strategist would use as-is. It is not part of a chain yet, and it has to earn its place alone — if the output needs re-verifying from scratch, it has saved nothing.

Everything else in `goal.md`'s marketing stack (competitor analyst, creative strategist, copywriter, designer, media buyer, media analyst) is **out of scope** and deliberately unspecified. Building the chain before one link works is how these projects die.

### Source documents

| Document | What it supplies |
|---|---|
| `research-compartment-supplement-mrr-v2.pdf` | The domain framework — five stages, twenty-one nodes, one gate, one output artifact. Read as the authority on *what* the agent produces. |
| `book-to-skill-setup-guide.pdf` (Bonanno) | The packaging method — SKILL.md with trigger-phrase description, chapters, glossary, patterns, cheatsheet, workflow modes. Read as the authority on *how* the framework gets loaded. |

Where they conflict, the compartment document wins on content and the setup guide wins on file layout.

---

## 2. The one property that matters

> Every factual claim traces to a source that exists **and says what the claim says it says**.

The second half is the part a corpus-membership check does not give you, and §6 is about that gap.

The failure this prevents is specific: fluent, confident findings about a customer nobody has ever met. Everything downstream treats research as fact, so an invented avatar does not surface as an error — it surfaces months later as a campaign that underperformed for reasons nobody can reconstruct.

---

## 3. The compartment as an execution contract

The framework is **a dependency graph, not a checklist**. Three edges run one way only, and running the nodes in a different order produces answers that look complete and are quietly wrong:

```
competitor landscape ──▶ sophistication      sophistication is read off the market, never intuited
sophistication + product truth ──▶ mechanism  a mechanism built before you know the stage is
                                              unnecessary or already used
claim limits ──▶ everything downstream        what is legally sayable is a ceiling set once,
                                              not a filter applied at review
```

The agent must enforce these as **hard ordering constraints**, not as guidance in a prompt. A stage cannot start until its inputs carry a completion mark.

### Stage structure

| Stage | Nodes | Character |
|---|---|---|
| **1 — Raw material** | product data, competitors, review mining, category data | Gather only. **Concluding while collecting is the single most common failure.** Nothing here may contain a judgement. |
| **2 — Product truth** | ingredients, dose vs study, claim limits, COGS & refills | The product in isolation. No market comparison yet. |
| **3 — Market truth** | TAM/SAM, offers, sophistication, breaking point | The product against the world. Produces the go/no-go inputs. |
| **⛔ Viability gate** | size, margin, mechanism availability, claim room, structural churn | Sits here, not at the end — the earliest point with enough information to kill the project. |
| **4 — Customer truth** | avatars (+ proxy buyers), awareness, language bank, identity layer | Most labour-intensive. **Only runs after the gate clears** — there is no reason to spend it on a market you will not enter. |
| **5 — Synthesis** | mechanism, LTV & CAC, claim ladder, positioning | Produces the artifacts that leave the compartment. |

**Two feedback loops** are part of the machine, not exception handling:

- New competitor creative **reopens stage 3** — sophistication is a snapshot and it moves. This wants a standing cadence (a periodic ad-library pull), not a one-time task.
- No available mechanism **sends you back to stage 4** — look for a segment with a different problem framing. It must never escalate the claim instead; escalation under pressure is precisely how markets reach stage five.

### Done-criteria are saturation tests, not quotas

Every node completes when **new sources stop producing new themes** — never at a fixed count. This is a load-bearing design decision, and §6.3 explains why a quota actively causes fabrication.

---

## 4. Output artifacts

Three things leave the compartment. Only the first is consumed directly by the next role.

### 4.1 The angle map (the handoff artifact)

A **matrix**, not a document: avatar × awareness level × mechanism. Machine-consumable and coverage-checkable — you can see at a glance which combinations have no angle and which are oversubscribed, and a creative strategist can pull one cell and brief from it without reading anything else.

Each populated cell carries:

| Field | Sourced from node |
|---|---|
| Avatar and sub-avatar | Avatars |
| Awareness level and channel | Awareness |
| Mechanism angle | Mechanism |
| Permitted claim rung | Claim ladder |
| Language to use | Language bank |
| Identity narrative engaged | Identity layer |
| Entry moment | Breaking point |
| Objections to clear | Review mining, Avatars |
| Offer and price context | Offers, LTV & CAC |
| **Provenance** | `evidenced` \| `inferred` |

**The provenance field is what keeps the artifact honest.** `evidenced` means every component traces to captured source material. `inferred` means some part is a hypothesis — a plausible avatar nobody has been observed to be. Inferred angles are legitimate and often the interesting ones; *losing track of which is which* is not. Downstream, an inferred angle should be tested before it is scaled.

**Done when:** every avatar-awareness pair is either populated or explicitly marked not-pursued with a reason, and every populated cell carries a provenance mark.

### 4.2 The dossier

Supporting evidence, organised by node, that stays available but does not need to be read.

### 4.3 The gap list — a first-class output

What the agent **could not find**, and what would need collecting: which forums were thin, which competitor's ad library was empty, which ingredient has no human trial at the product's dose, which avatar has no proxy-buyer evidence.

This is not an appendix. An agent that cannot say "I could not find this" will invent it, so the gap list is the pressure valve that makes honesty cheaper than fabrication. **If the gap list is empty, treat the run as failed** — real research always has holes.

---

## 5. Packaging

Following the book-to-skill layout, because progressive disclosure is what makes a large framework usable: only the name and description load every session; chapters load when the job matches.

```
research-compartment/
  SKILL.md        modes, the dependency graph, index of chapters
  chapters/
    stage-1-raw-material.md
    stage-2-product-truth.md
    stage-3-market-truth.md
    viability-gate.md
    stage-4-customer-truth.md
    stage-5-synthesis.md
  glossary.md     the framework's own terms, defined its way
  patterns.md     named techniques (three-axis review coding, proxy-buyer detection, …)
  cheatsheet.md   the decision rules, compressed — gate criteria, the three one-way edges
  sources.md      provenance of the skill itself
```

**The description is trigger phrases, not a summary.** It is the only thing loaded before the model decides whether to pull the skill, so it lists the jobs: *"research a supplement before writing copy", "build an angle map", "who is this product for", "audit this research dossier"* — not "knowledge from the research compartment framework."

**Two modes** (the guide's PREP/GRADE shape):

- **RUN** — execute the compartment from a product brief, stage by stage, citing the chapter each step comes from.
- **GRADE** — take an existing dossier or angle map and score it against the same framework, naming what was skipped, which claims are unsupported, and which cells are inferred but unmarked.

GRADE matters more than it looks. It is how the agent audits **its own prior output** and how you audit the mechanical scaffold you already built, without re-running the research.

---

## 6. Evidence integrity

> *Your question: the pipeline fails if an agent cites evidence not in the corpus. Is that enough, where will it be circumvented, and what else would you add?*

### 6.1 It is necessary and it is not sufficient

Corpus-membership answers **"does this source exist?"** It does not answer **"does this source support this claim?"** — and the second is where research goes wrong while looking right.

The check passes cleanly for a citation that is real, retrievable, in-corpus, and simply does not say what the sentence says. That is not an edge case; it is the most common form of the failure, because a model reaching for support finds a genuinely related document and the relationship degrades from *states* to *is consistent with* to *is about the same topic*.

### 6.2 Where it gets circumvented

Ranked by how likely I think each is to bite you, given the framework:

1. **Claim–source mismatch.** Real citation, unsupported claim. Invisible to membership checking. Most likely and most damaging.
2. **Inference laundering across stages.** Stage 5 cites stage 4's output, which was itself inferred. Each hop is "cited"; the chain bottoms out in nothing. The compartment's stage boundaries make this *detectable* — provenance must be transitive: any synthesis consuming an `inferred` input is itself `inferred`, no matter how many sources it cites.
3. **Aggregation without support.** "Most customers report X" from four quotes. No single source supports the quantifier. The claim is about a population; the evidence is about individuals.
4. **Corpus poisoning to satisfy the check.** When membership is the only gate, the cheapest way to pass is to widen the corpus — pull in a listicle, an AI-generated "review roundup", a competitor's own marketing. Then everything is cited and nothing is verified. **A membership check creates an incentive to lower corpus quality.**
5. **Selection bias.** Every quote real, every citation valid, the set unrepresentative — the five reviews that fit the thesis out of two hundred. Especially acute for three-star reviews, which is exactly where the framework says the honest text lives.
6. **Quote drift.** Verbatim degrades to cleaned-up paraphrase across stages. The framework is explicit that "I wake up at 3am and can't get back to sleep" is usable and "sleep maintenance issues" is not, and that this degrades **irreversibly** the moment it is paraphrased.
7. **Stale evidence.** A first-seen date from eight months ago presented as the current landscape. Sophistication moves; a valid citation can describe a market that no longer exists.
8. **Under-determined claims about absence.** "No competitor makes this claim" is a claim about the whole market, provable only by a documented search, not by the absence of a citation.

### 6.3 What I would add

**A. Claim–source entailment check.** For every factual line, a second pass answers: does this specific quoted span support this specific sentence — `supports` / `partially supports` / `does not support`? Run it as a separate model call with only the sentence and the cited span in context, so it cannot see the argument the sentence is serving. This is the single highest-value addition, and it is the one your current gate cannot do.

**B. Provenance as a required field, transitively enforced.** The framework already puts `evidenced | inferred` on every angle-map cell. Extend it to every claim, and enforce the rule mechanically: an output consuming an `inferred` input cannot be `evidenced`. Inference is not the problem — *unlabelled* inference is.

**C. Corpus admission rules, separate from citation rules.** Since membership creates pressure to widen the corpus, control what may enter: source type, first-party vs aggregator, date, and whether it is itself marketing. Poor-quality sources should be *admissible but marked*, so a claim resting only on marketing copy is visibly weaker than one resting on a COA.

**D. Saturation instead of quotas — and instrument it.** The framework's own point, and it is right: a quota of forty quotes where the material honestly holds twelve makes the path of least resistance producing plausible citations. Log the saturation curve (new themes per additional source) so "we stopped because it stopped yielding" is a number, not an assertion.

**E. Quantifier discipline.** Any claim with a quantifier ("most", "commonly", "the majority") must carry a count and a denominator, or be rewritten as an existence claim. Cheap to check, catches the aggregation failure.

**F. Verbatim immutability.** Stage-1 raw material is write-once and content-addressed. Downstream stages reference spans by id and may never rewrite them. This makes quote drift structurally impossible rather than discouraged.

**G. Adversarial self-audit before handoff.** GRADE mode run against the agent's own dossier, with the specific brief: find the three claims most likely to be wrong. Not a rubber stamp — a search for the weakest links, reported in the gap list.

**H. Sampled human verification.** Pull five claims at random per run and check them by hand. This is the only mechanism that detects a systematically miscalibrated checker, and it is how you find out whether A–G are actually working.

### 6.4 The honest limit

None of this makes the output true. It makes the output **auditable in less time than redoing it** — which is the real bar, and the difference between an agent that saves time and one that produces work you have to verify from scratch.

The residual risk sits in what nobody thought to check: an avatar that is well-evidenced, correctly cited, and irrelevant to the purchase decision. No mechanical gate catches that. The viability gate and a human strategist do.

---

## 7. Tools required

| Capability | Feeds | Note |
|---|---|---|
| Web search + page fetch | most of stage 1 | must store the fetched artifact, not a summary of it |
| Ad-library access (Meta, TikTok, Google) | competitors, sophistication | **first-seen dates are essential** — longevity is the only outside performance signal |
| Review scraping (Amazon, Trustpilot, own store) | review mining | verbatim + star rating + date, three-axis coded |
| Forum/social retrieval (Reddit, YouTube comments) | breaking point, identity layer | the densest source of trigger moments |
| Scientific literature lookup | ingredients, dose vs study | needs dose, form, and population, not abstracts |
| Keyword/search-volume data | category data, TAM/SAM | trend line over years, not a point estimate |
| Structured corpus store | everything | content-addressed, write-once, span-addressable |

Everything hermes cannot do natively is a tool to build. **Ad libraries and review sources are the hard ones** — they are the highest-value inputs and the most hostile to automated collection. Assume manual or semi-manual collection for v1 rather than blocking the whole agent on a scraper.

---

## 8. Human gates

Two, both mandatory:

1. **The viability gate** (after stage 3). The agent presents size, margin, mechanism availability, claim room, structural churn — and a recommendation. A human decides proceed / reposition / drop. The framework's point stands: writing it down converts a decision people avoid making into one whose terms were agreed in advance.
2. **Handoff review** (after stage 5). A human checks *citations*, not conclusions. If they find themselves re-running research, the agent has failed its acceptance test.

`claim limits` is research output, **not legal advice**. High-risk categories warrant counsel review before spend.

---

## 9. Acceptance criteria

The agent is working when, on a product it has never seen:

1. Every factual line in the dossier carries a source id resolving to captured material.
2. A 20-claim sample passes entailment check at ≥95%, verified by hand once.
3. Every angle-map cell carries a provenance mark, and inference is transitive.
4. The gap list is non-empty and specific enough to act on.
5. Stage ordering was enforced — no stage-4 output exists for a run that failed the gate.
6. Verbatim language survives to the language bank uncleaned (spot-check five phrases against raw material).
7. A human strategist briefs a campaign from one angle-map cell **without opening the dossier**.
8. Review time is materially less than doing the research — the actual test of whether it earns its place.

---

## 10. Open questions

- **Which corpus store?** Content-addressed files are enough for v1; a vector store is a later optimisation and shouldn't gate the build.
- **Where does the entailment checker run?** A cheaper model is fine and arguably better — it should not be persuaded by fluency. Needs measuring, not assuming.
- **Does the agent collect, or consume a collected corpus?** v1 should probably consume: collection is the brittle part, and separating them lets the reasoning be tested against a fixed corpus.
- **Standing cadence for the stage-3 loop** — how often to re-pull ad libraries before positioning is stale.
- **How much of this is one agent?** Stage 1 is gathering, stage 5 is judgement. They may want different models, different temperatures, possibly different agents. Do not split until a single agent demonstrably strains.

## 11. Build order

1. Corpus store + provenance schema (everything else depends on the shape of a claim)
2. `research-compartment` skill in book-to-skill layout, GRADE mode first — it can audit the scaffold that already exists, which is value before anything is built
3. Stage 1–3 with the viability gate, on one real product
4. Entailment checker + sampled human verification
5. Stage 4–5 and the angle map
6. The two feedback loops as scheduled work

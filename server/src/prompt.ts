/**
 * Build the stage-1 instructions handed to the agent.
 *
 * The prompt has one job the validator cannot do for it: get the agent to gather
 * rather than conclude. The validator can only reject a packet that has already
 * been written, so the prompt states the rule and the schema removes the place to
 * break it. Both, or the failure mode is a run that costs money and fails at the
 * last step.
 *
 * Kept in one module because the exact wording is a thing you tune against real
 * runs, and it should be diffable on its own.
 *
 * **Superseded:** under hermes the agent was told to archive each fetched body
 * itself, with the terminal tool, to `<corpus>/runs/<run_id>/sources/<sha256>`.
 * That put a mechanical step on the model's to-do list, and a model that forgets
 * it produces a packet claiming `archived: true` over a file that does not
 * exist — an audit trail that lies. `web_fetch` now archives and hashes the body
 * before the agent ever sees it, and hands back the id to cite. The prompt tells
 * the agent to *use* that id rather than to compute one.
 */

import {
  DEFAULT_REJECTED_KINDS,
  PRODUCT_ATTRIBUTES,
  SOURCE_KIND_NOTES,
  type Brief,
  type SourceKind,
} from "./schema.js";
import type { Judgement } from "./store.js";

/**
 * A worked miniature. Models follow an example far more reliably than a prose
 * description of a schema, and a wrong-shaped packet costs a whole run.
 */
const EXAMPLE = {
  contract_version: "1",
  stage: 1,
  brief: { product: "MagnaCalm glycinate 400mg", url: "https://…", market: "UK" },
  sources: [
    {
      id: "sha256:2f1a…",
      url: "https://reddit.com/r/insomnia/comments/9d1x",
      title: "Anyone else waking at 3am?",
      kind: "forum",
      publisher: "reddit.com",
      fetched_at: "2026-09-10T09:14:22Z",
      marketing: false,
      admitted: true,
      admission_reason: "forum — admitted by policy",
      archived: true,
      node: "review_mining",
    },
    {
      id: "sha256:7d5b…",
      url: "https://amazon.co.uk/product-reviews/B0C?filter=3star",
      title: "MagnaCalm reviews, 3 star",
      kind: "marketplace_review",
      publisher: "amazon.co.uk",
      fetched_at: "2026-09-10T09:20:11Z",
      marketing: false,
      admitted: true,
      admission_reason: "marketplace_review — admitted by policy",
      archived: true,
      node: "review_mining",
    },
    {
      id: "sha256:9c04…",
      url: "https://top10supplementpicks.net/best-magnesium",
      title: "Best magnesium 2026",
      kind: "seo_listicle",
      publisher: "top10supplementpicks.net",
      fetched_at: "2026-09-10T09:15:02Z",
      marketing: true,
      admitted: false,
      admission_reason: "seo_listicle — rejected by admission policy",
      archived: false,
      node: "competitors",
    },
  ],
  excerpts: [
    {
      id: "sha256:4b7e…",
      source_id: "sha256:2f1a…",
      text: "I wake up at 3am and can't get back to sleep. Every single night.",
      locator: { kind: "char_range", start: 4120, end: 4187 },
      captured_at: "2026-09-10T09:14:25Z",
      node: "review_mining",
      star_rating: null,
      posted_at: "2026-04-02",
      axis: "why_bought",
      themes: ["3am waking"],
    },
    {
      id: "sha256:e10c…",
      source_id: "sha256:7d5b…",
      text: "Took it for a week, felt nothing, cancelled. Turns out you need six weeks.",
      locator: { kind: "char_range", start: 812, end: 886 },
      captured_at: "2026-09-10T09:20:14Z",
      node: "review_mining",
      star_rating: 3,
      posted_at: "2026-05-19",
      axis: "why_quit",
      themes: ["time to effect"],
    },
  ],
  measurements: [
    {
      id: "m1",
      node: "category_data",
      metric: "search_volume",
      value: 1900000,
      unit: "searches/month",
      period: "2026-08",
      source_id: "sha256:2f1a…",
    },
  ],
  attributes: [
    {
      id: "a1",
      node: "product_data",
      key: "dose_per_serving",
      value: "400 mg",
      source_id: "sha256:2f1a…",
    },
  ],
  saturation: [
    {
      node: "review_mining",
      curve: [
        { source_id: "sha256:2f1a…", new_themes: 4, cumulative_themes: 4 },
        { source_id: "sha256:7d5b…", new_themes: 0, cumulative_themes: 11 },
      ],
      stopped_because: "three consecutive sources added no new theme",
    },
  ],
  nodes: [
    {
      node: "review_mining",
      status: "complete",
      done_criterion_met: true,
      why: "saturated at 14 sources; 3-star coverage present",
    },
  ],
  gaps: [
    {
      node: "competitors",
      missing: "CalmWell ad library returns no UK creative",
      would_need: "a UK-IP ad-library pull, or a manual capture",
      blocking: false,
    },
  ],
};

const SYSTEM_PROMPT = `You are the stage-1 researcher of a five-stage marketing research \
compartment. You gather raw material from the open web and record it verbatim. You do not \
interpret it, and the output schema has no field an interpretation could be written into.

You have two tools:

- \`web_search\` — search the web and get back titles, urls and snippets. Snippets are a \
way of choosing what to fetch, never a source in their own right: never quote one, and \
never cite a url you have only seen in search results.
- \`web_fetch\` — fetch one url and get back its readable text. Every fetch is archived and \
hashed before you see it, and the result carries the \`source_id\` to cite. Use that id \
exactly as given.

Work through the four nodes methodically. Fetch before you write anything down.`;

const RULES = `\
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
   ad-library entries. **Every ad entry must carry \`first_seen\`**; ad longevity
   is the only outside performance signal that exists. An ad with no date is
   captured with \`first_seen: null\` AND recorded as a gap.
3. **review_mining** — verbatim customer language with star rating, date, and a
   three-axis code (\`why_bought\` / \`why_stayed\` / \`why_quit\`). **You must
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
the curve — \`new_themes\` per source — so "it stopped yielding" is a number.

A **theme** is a short label over excerpts. It is a working index for measuring
saturation, not a finding. Give it a label and nothing else.

### Admission

Fetch what you like, but record every source you touched with \`admitted\` and
\`admission_reason\`. **Rejected sources stay in the packet** — they are evidence
of what was searched.

\`kind\` must be **exactly one of** these. There are no others, and inventing one
fails the whole packet — pick the closest:

{kinds}

These kinds are rejected by this run's policy:

{rejected}

Anything promotional gets \`marketing: true\`, including a brand's own site. That
is not a rejection; it marks a claim resting only on marketing as weaker than
one resting on a certificate of analysis.

### How to fetch, and what a source id is

\`web_search\` finds candidates; \`web_fetch\` is the only thing that makes one a
source. A search snippet is not material — never quote one, and never record a
source you did not fetch.

Every \`web_fetch\` archives the body it retrieved and returns a \`source_id\` of
the form \`sha256:<hash>\`. **Use that id verbatim** as the source's \`id\`, and set
\`archived: true\`. Do not invent, shorten or recompute a hash: the id is what
lets a span be checked against the archived body later, and one you made up
points at nothing.

If a fetch fails, or comes back with the body unarchived (the result says so),
record the source with \`archived: false\` and add a gap entry saying what could
not be retrieved — then carry on. The run is not blocked by it.

### The gap list is a required output

What you could not find, per node, and what it would take to get it. A run that
reports no gaps is treated as failed, because real research always has holes and
an agent that cannot say "I could not find this" will invent it instead.

A run-level problem that is not one of the four nodes — a tool failing, a fetch
path blocked, a site refusing to serve — still goes in this list. Attach it to
the node it blocked; if it blocked nothing in particular, use
\`node: "category_data"\`. Never invent a fifth node name (\`all\`, \`general\`,
\`run\`): only \`product_data\`, \`competitors\`, \`review_mining\`, \`category_data\`
are accepted, and anything else fails the whole packet.
`;

const OUTPUT = `\
## Output

End your reply with exactly one fenced JSON block containing the stage-1 packet.
Everything outside the fence is ignored. The block must match this shape exactly
— **any key not in this schema is rejected and the run fails**:

\`\`\`json
{example}
\`\`\`

Field notes:

- \`star_rating\` and \`axis\` apply to review excerpts only; use \`null\` elsewhere.
  \`posted_at\` is a string: a date like "2026-05-18" when the source shows one,
  or "" when it does not. Never \`null\` — \`null\` fails validation.
- \`locator\` is optional but strongly preferred: \`{"kind": "char_range",
  "start": N, "end": N}\` so a span can be checked against the archived body.
- \`nodes\` must contain an entry for each of the four nodes, \`complete\` or
  \`incomplete\`, with \`why\` naming the criterion that was or was not met.
- \`gaps\` must not be empty.
`;

/** The system prompt for a stage-1 run. Constant — the brief goes in the turn. */
export function systemPrompt(): string {
  return SYSTEM_PROMPT;
}

/**
 * Assemble the whole user turn for one stage-1 run.
 *
 * Takes no run id and no corpus path: both were only ever needed to tell the
 * agent where to write archives itself, and `web_fetch` does that now.
 */
export function buildInstructions(options: {
  brief: Brief;
  rejectKinds: readonly string[];
  judgements: readonly Judgement[];
}): string {
  const { brief, rejectKinds, judgements } = options;
  const rejected = rejectKinds.length > 0 ? rejectKinds : DEFAULT_REJECTED_KINDS;
  const parts = [
    RULES.replace("{attributes}", PRODUCT_ATTRIBUTES.map((a) => `\`${a}\``).join(", "))
      .replace("{kinds}", SOURCE_KIND_NOTES.map(([kind, note]) => `- \`${kind}\` — ${note}`).join("\n"))
      .replace("{rejected}", rejected.map((kind) => `- \`${kind}\``).join("\n") || "- (none)"),
  ];
  if (judgements.length > 0) parts.push(judgementBlock(judgements));
  parts.push(briefBlock(brief));
  parts.push(OUTPUT.replace("{example}", JSON.stringify(EXAMPLE, null, 2)));
  return parts.join("\n\n");
}

/**
 * Standing corrections. These outrank the defaults above.
 *
 * A `source_rule` is also applied mechanically through the admission policy —
 * this block exists so the agent knows *why* a kind is rejected, not so it has
 * to remember to do it.
 */
function judgementBlock(judgements: readonly Judgement[]): string {
  const lines = [
    "## Standing judgements",
    "",
    "Corrections a human has given on previous runs. They apply to this run " +
      "and outrank the defaults above. You should not need telling twice.",
    "",
  ];
  for (const j of judgements) lines.push(`- **${j.kind}** — ${j.text}`);
  return lines.join("\n");
}

function briefBlock(brief: Brief): string {
  const lines = ["## The brief", "", `**Product:** ${brief.product}`];
  if (brief.url) {
    lines.push(`**Product URL:** ${brief.url}`);
  } else {
    // The normal case: the operator names a product and a market, and the
    // agent finds everything. Saying so matters — without the line, a
    // careful agent stalls asking for a URL it was never going to get.
    lines.push(
      "No product URL was supplied — finding it is part of the job. Use " +
        "web search to locate the product's own site first, then the " +
        "reviews, competitors, ad-library entries and category data the " +
        "four nodes need.",
    );
  }
  if (brief.market) lines.push(`**Market:** ${brief.market}`);
  if (brief.notes) lines.push(`**Notes:** ${brief.notes}`);
  return lines.join("\n");
}

/**
 * One correction, injected mid-run.
 *
 * Phrased as a rule rather than a request: the agent is mid-task and a polite
 * suggestion competes with the instructions it already has.
 */
export function steerText(judgement: Judgement): string {
  let rejects = "";
  if (judgement.rejects_kinds.length > 0) {
    const kinds = judgement.rejects_kinds.map((k: SourceKind) => `\`${k}\``).join(", ");
    rejects =
      ` From now on, treat sources of kind ${kinds} as rejected: still ` +
      "record them in the packet with `admitted: false` and this reason.";
  }
  return (
    "Standing judgement from the human supervising this run — apply it for " +
    `the rest of the run: ${judgement.text}${rejects}`
  );
}

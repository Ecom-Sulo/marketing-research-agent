/**
 * The stage-1 run contract (`marketing-research-agent/spec-stage-1.md` §4).
 *
 * Every object is `.strict()`, and that is the point rather than tidiness.
 * Stage 1 is gather-only, so the schema deliberately has no field a judgement
 * could be written into — no `claim`, no `finding`, no `summary`. An agent that
 * wants to conclude something in stage 1 has nowhere to put it, which is a
 * stronger guarantee than a prompt asking it not to.
 *
 * If validation starts rejecting something legitimate, widen the schema on
 * purpose. Do not loosen the validator.
 */

import { z } from "zod";

export const CONTRACT_VERSION = "1";

export const NODES = [
  "product_data",
  "competitors",
  "review_mining",
  "category_data",
] as const;
export type Node = (typeof NODES)[number];

export const AXES = ["why_bought", "why_stayed", "why_quit"] as const;
export type Axis = (typeof AXES)[number];

export const SOURCE_KINDS = [
  "first_party",
  "coa",
  "marketplace_review",
  "review_platform",
  "forum",
  "video_comments",
  "ad_library",
  "trial",
  "reference",
  "keyword_data",
  "competitor_marketing",
  "seo_listicle",
  "review_roundup",
  "ai_generated",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * The enum has to reach the agent, not just the validator. The first live run
 * invented `product_page`, `marketplace_page`, `industry_report` and four others
 * — reasonable names, none of them in the enum, and the whole packet was
 * rejected for it. The prompt lists these verbatim, each with the note that
 * says which one a borderline source belongs to.
 */
export const SOURCE_KIND_NOTES: ReadonlyArray<readonly [SourceKind, string]> = [
  ["first_party", "the brand's own site, label or product page"],
  ["coa", "certificate of analysis — the strongest evidence class here"],
  ["marketplace_review", "Amazon, eBay, the brand's own store reviews"],
  ["review_platform", "Trustpilot and similar"],
  ["forum", "Reddit, niche boards, Q&A sites"],
  ["video_comments", "YouTube or TikTok comments"],
  ["ad_library", "Meta/TikTok/Google ad libraries — `first_seen` required"],
  ["trial", "a study or trial; needs dose, form and population"],
  ["reference", "Examine, NIH fact sheets, secondary compendia"],
  ["keyword_data", "search volume and trend tooling; also market-size reports"],
  ["competitor_marketing", "a competitor's own site or copy"],
  ["seo_listicle", "'best X of 2026' pages — marketing dressed as review data"],
  ["review_roundup", "aggregated review articles — same"],
  ["ai_generated", "machine-written filler, where you can tell"],
] as const;

/**
 * §3. Rejected by default: marketing dressed as review data. Not code — a run's
 * admission policy overrides this, and a `source_rule` judgement writes to it.
 */
export const DEFAULT_REJECTED_KINDS: readonly SourceKind[] = [
  "seo_listicle",
  "review_roundup",
  "ai_generated",
] as const;

/** §2.1. Each is captured or gapped with a reason; a missing COA is a gap, not a zero. */
export const PRODUCT_ATTRIBUTES: readonly string[] = [
  "name",
  "brand",
  "form",
  "dose_per_serving",
  "servings_per_container",
  "full_ingredient_panel",
  "price",
  "subscription_terms",
  "claims_made_on_own_site",
  "coa_present",
] as const;

const nodeSchema = z.enum(NODES);
const axisSchema = z.enum(AXES);
const sourceKindSchema = z.enum(SOURCE_KINDS);

export const briefSchema = z
  .object({
    product: z.string(),
    url: z.string().default(""),
    market: z.string().default(""),
    notes: z.string().default(""),
  })
  .strict();
export type Brief = z.infer<typeof briefSchema>;

/**
 * Where in the source the span was taken from.
 *
 * `char_range` is the honest default for fetched text. `selector` and `note`
 * exist for material that has no stable offsets (a PDF, a screenshot of an ad).
 */
export const locatorSchema = z
  .object({
    kind: z.enum(["char_range", "selector", "note"]),
    start: z.number().int().nullable().default(null),
    end: z.number().int().nullable().default(null),
    selector: z.string().default(""),
    note: z.string().default(""),
  })
  .strict();
export type Locator = z.infer<typeof locatorSchema>;

export const sourceSchema = z
  .object({
    id: z.string(), // sha256:… over the normalised captured text
    url: z.string(),
    title: z.string().default(""),
    kind: sourceKindSchema,
    publisher: z.string().default(""),
    fetched_at: z.string().default(""),
    // ad_library only. null is a gap, not a zero: longevity is the only outside
    // performance signal there is (spec.md §7).
    first_seen: z.string().nullable().default(null),
    marketing: z.boolean().default(false),
    admitted: z.boolean().default(true),
    admission_reason: z.string().default(""),
    // False when the raw body could not be written to the corpus volume. The run
    // still completes; the source becomes a gap.
    archived: z.boolean().default(false),
    node: nodeSchema,
  })
  .strict();
export type Source = z.infer<typeof sourceSchema>;

/** A verbatim span. Immutable by construction — see `store.ts`. */
export const excerptSchema = z
  .object({
    id: z.string(),
    source_id: z.string(),
    text: z.string(),
    locator: locatorSchema.nullable().default(null),
    captured_at: z.string().default(""),
    node: nodeSchema,
    star_rating: z.number().int().min(1).max(5).nullable().default(null),
    posted_at: z.string().default(""),
    axis: axisSchema.nullable().default(null),
    // A working index over excerpts, not a finding. Labels only, no descriptions
    // (§5) — a theme with prose attached is a conclusion wearing a hat.
    themes: z.array(z.string()).default([]),
  })
  .strict();
export type Excerpt = z.infer<typeof excerptSchema>;

/** A number a source states, copied with its unit and period. */
export const measurementSchema = z
  .object({
    id: z.string(),
    node: nodeSchema,
    metric: z.string(),
    value: z.union([z.number(), z.string()]),
    unit: z.string().default(""),
    period: z.string().default(""),
    source_id: z.string(),
    locator: locatorSchema.nullable().default(null),
  })
  .strict();
export type Measurement = z.infer<typeof measurementSchema>;

/** A field lifted off a page: dose, price, format, first-seen date. */
export const attributeSchema = z
  .object({
    id: z.string(),
    node: nodeSchema,
    key: z.string(),
    value: z.string(),
    source_id: z.string(),
    locator: locatorSchema.nullable().default(null),
  })
  .strict();
export type Attribute = z.infer<typeof attributeSchema>;

export const saturationPointSchema = z
  .object({
    source_id: z.string(),
    new_themes: z.number().int(),
    cumulative_themes: z.number().int(),
  })
  .strict();

export const saturationSchema = z
  .object({
    node: nodeSchema,
    curve: z.array(saturationPointSchema).default([]),
    stopped_because: z.string().default(""),
  })
  .strict();
export type Saturation = z.infer<typeof saturationSchema>;

export const nodeStatusSchema = z
  .object({
    node: nodeSchema,
    status: z.enum(["complete", "incomplete"]),
    done_criterion_met: z.boolean(),
    why: z.string().default(""),
  })
  .strict();

export const gapSchema = z
  .object({
    node: nodeSchema,
    missing: z.string(),
    would_need: z.string().default(""),
    blocking: z.boolean().default(false),
  })
  .strict();
export type Gap = z.infer<typeof gapSchema>;

/** What one stage-1 run emits. Nothing here may be a judgement. */
export const stagePacketSchema = z
  .object({
    contract_version: z.string().default(CONTRACT_VERSION),
    stage: z.literal(1).default(1),
    run_id: z.string().default(""), // echoed; agentchat is the authority on run ids
    brief: briefSchema,
    sources: z.array(sourceSchema).default([]),
    excerpts: z.array(excerptSchema).default([]),
    measurements: z.array(measurementSchema).default([]),
    attributes: z.array(attributeSchema).default([]),
    saturation: z.array(saturationSchema).default([]),
    nodes: z.array(nodeStatusSchema).default([]),
    gaps: z.array(gapSchema).default([]),
  })
  .strict();
export type StagePacket = z.infer<typeof stagePacketSchema>;

// -- standing judgements (§7) ------------------------------------------------

export const JUDGEMENT_KINDS = [
  "source_rule",
  "weighting",
  "avatar_rule",
  "language_rule",
  "custom",
] as const;
export type JudgementKind = (typeof JUDGEMENT_KINDS)[number];

export const judgementInSchema = z
  .object({
    kind: z.enum(JUDGEMENT_KINDS).default("custom"),
    text: z.string(),
    // `source_rule` only: kinds this rule rejects. Mutating the admission policy
    // is what makes the rule mechanical rather than a matter of the model
    // remembering it.
    rejects_kinds: z.array(sourceKindSchema).default([]),
  })
  .strict();
export type JudgementIn = z.infer<typeof judgementInSchema>;

export const runRequestSchema = z
  .object({
    brief: briefSchema,
    model: z.string().default(""),
    // Overrides DEFAULT_REJECTED_KINDS when set (empty means "use the default").
    reject_kinds: z.array(sourceKindSchema).default([]),
  })
  .strict();
export type RunRequest = z.infer<typeof runRequestSchema>;

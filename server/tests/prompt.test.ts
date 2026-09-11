/**
 * The instructions.
 *
 * The prompt is the half of the contract the validator cannot enforce, so the
 * tests here are about what it *says*: a rule that quietly stops being stated is
 * a rule the model stops following, and the failure only shows up as a rejected
 * packet at the end of an expensive run.
 */

import { describe, expect, it } from "vitest";

import { parse, validate } from "../src/packet.js";
import { buildInstructions, steerText, systemPrompt } from "../src/prompt.js";
import { SOURCE_KINDS, briefSchema } from "../src/schema.js";
import type { Judgement } from "../src/store.js";

const brief = (overrides: Record<string, unknown> = {}) =>
  briefSchema.parse({ product: "MagnaCalm", ...overrides });

const build = (overrides: Parameters<typeof buildInstructions>[0] | Record<string, unknown> = {}) =>
  buildInstructions({
    brief: brief(),
    rejectKinds: [],
    judgements: [],
    ...(overrides as Record<string, never>),
  });

describe("the worked example", () => {
  it("is itself a valid packet", () => {
    // If the example drifts out of the contract, every run copies the drift.
    const parsed = parse(build());
    expect(parsed.sources.length).toBeGreaterThan(0);
    expect(parsed.gaps.length).toBeGreaterThan(0);
  });

  it("shows a 3-star excerpt, which is the coverage the validator demands", () => {
    expect(parse(build()).excerpts.some((e) => e.star_rating === 3)).toBe(true);
  });
});

describe("what the instructions must state", () => {
  it("names every source kind the validator accepts", () => {
    // The first live run invented seven kinds that were not in the enum and the
    // whole packet was rejected for it.
    const text = build();
    for (const kind of SOURCE_KINDS) expect(text).toContain(`\`${kind}\``);
  });

  it("tells the agent to cite the source_id web_fetch hands back", () => {
    const text = build();
    expect(text).toMatch(/source_id/);
    expect(text).toMatch(/verbatim/);
  });

  it("says an empty posted_at is a string, never null", () => {
    expect(build()).toMatch(/Never `null`/);
  });

  it("refuses a fifth gap node by naming the only four there are", () => {
    const text = build();
    expect(text).toMatch(/Never invent a fifth node name/);
    expect(text).toMatch(/`all`, `general`,\s*\n?`run`/);
  });

  it("states that the gap list may not be empty", () => {
    expect(build()).toMatch(/`gaps` must not be empty/);
  });

  it("lists this run's rejected kinds", () => {
    expect(build({ rejectKinds: ["ai_generated"] })).toContain("- `ai_generated`");
  });
});

describe("the brief block", () => {
  it("sends the agent searching when no url was supplied", () => {
    // Without this line a careful agent stalls asking for a URL it was never
    // going to get.
    expect(build()).toMatch(/No product URL was supplied/);
  });

  it("skips the search instruction when a url was supplied", () => {
    const text = build({ brief: brief({ url: "https://magnacalm.example" }) });
    expect(text).toContain("https://magnacalm.example");
    expect(text).not.toMatch(/No product URL was supplied/);
  });

  it("carries the market and notes when given", () => {
    const text = build({ brief: brief({ market: "UK", notes: "focus on sleep" }) });
    expect(text).toContain("**Market:** UK");
    expect(text).toContain("focus on sleep");
  });
});

describe("standing judgements", () => {
  const judgement: Judgement = {
    id: "j1",
    kind: "source_rule",
    text: "reject anything from top10supplementpicks",
    rejects_kinds: ["seo_listicle"],
    active: true,
    applied_count: 0,
    created_at: "",
  };

  it("reaches the instructions", () => {
    const text = build({ judgements: [judgement] });
    expect(text).toContain("## Standing judgements");
    expect(text).toContain("reject anything from top10supplementpicks");
  });

  it("is absent when there are none", () => {
    expect(build()).not.toContain("## Standing judgements");
  });

  it("becomes a rule, not a request, when steered mid-run", () => {
    const text = steerText(judgement);
    expect(text).toMatch(/apply it for the rest of the run/);
    expect(text).toContain("`seo_listicle`");
    expect(text).toMatch(/admitted: false/);
  });
});

describe("the system prompt", () => {
  it("names both tools and says a snippet is not a source", () => {
    const text = systemPrompt();
    expect(text).toContain("web_search");
    expect(text).toContain("web_fetch");
    expect(text).toMatch(/never cite a url you have only seen in search results/);
  });
});

describe("the example survives the validator's cross-object rules", () => {
  it("passes validate() directly, not just extract()", () => {
    expect(() => validate(parse(build()))).not.toThrow();
  });
});

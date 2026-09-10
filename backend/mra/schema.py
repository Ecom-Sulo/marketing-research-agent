"""The stage-1 run contract (`marketing-research-agent/spec-stage-1.md` §4).

Every model is `extra="forbid"`, and that is the point rather than tidiness.
Stage 1 is gather-only, so the schema deliberately has no field a judgement
could be written into — no `claim`, no `finding`, no `summary`. An agent that
wants to conclude something in stage 1 has nowhere to put it, which is a
stronger guarantee than a prompt asking it not to.

If validation starts rejecting something legitimate, widen the schema on
purpose. Do not loosen the validator.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CONTRACT_VERSION = "1"

Node = Literal["product_data", "competitors", "review_mining", "category_data"]
Axis = Literal["why_bought", "why_stayed", "why_quit"]

SourceKind = Literal[
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
]

# The enum has to reach the agent, not just the validator. The first live run
# invented `product_page`, `marketplace_page`, `industry_report` and four others
# — reasonable names, none of them in the enum, and the whole packet was
# rejected for it. The prompt now lists these verbatim, each with the note that
# says which one a borderline source belongs to.
SOURCE_KIND_NOTES: tuple[tuple[str, str], ...] = (
    ("first_party", "the brand's own site, label or product page"),
    ("coa", "certificate of analysis — the strongest evidence class here"),
    ("marketplace_review", "Amazon, eBay, the brand's own store reviews"),
    ("review_platform", "Trustpilot and similar"),
    ("forum", "Reddit, niche boards, Q&A sites"),
    ("video_comments", "YouTube or TikTok comments"),
    ("ad_library", "Meta/TikTok/Google ad libraries — `first_seen` required"),
    ("trial", "a study or trial; needs dose, form and population"),
    ("reference", "Examine, NIH fact sheets, secondary compendia"),
    ("keyword_data", "search volume and trend tooling; also market-size reports"),
    ("competitor_marketing", "a competitor's own site or copy"),
    ("seo_listicle", "'best X of 2026' pages — marketing dressed as review data"),
    ("review_roundup", "aggregated review articles — same"),
    ("ai_generated", "machine-written filler, where you can tell"),
)

# §3. Rejected by default: marketing dressed as review data. Not code — a run's
# admission policy overrides this, and a `source_rule` judgement writes to it.
DEFAULT_REJECTED_KINDS: tuple[SourceKind, ...] = (
    "seo_listicle",
    "review_roundup",
    "ai_generated",
)

# §2.1. Each is captured or gapped with a reason; a missing COA is a gap, not a zero.
PRODUCT_ATTRIBUTES: tuple[str, ...] = (
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
)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Brief(Strict):
    product: str
    url: str = ""
    market: str = ""
    notes: str = ""


class Locator(Strict):
    """Where in the source the span was taken from.

    `char_range` is the honest default for fetched text. `selector` and `note`
    exist for material that has no stable offsets (a PDF, a screenshot of an ad).
    """

    kind: Literal["char_range", "selector", "note"]
    start: int | None = None
    end: int | None = None
    selector: str = ""
    note: str = ""


class Source(Strict):
    id: str                       # sha256:… over the normalised captured text
    url: str
    title: str = ""
    kind: SourceKind
    publisher: str = ""
    fetched_at: str = ""
    # ad_library only. null is a gap, not a zero: longevity is the only outside
    # performance signal there is (spec.md §7).
    first_seen: str | None = None
    marketing: bool = False
    admitted: bool = True
    admission_reason: str = ""
    # False when the raw body could not be written to the corpus volume. The run
    # still completes; the source becomes a gap.
    archived: bool = False
    node: Node


class Excerpt(Strict):
    """A verbatim span. Immutable by construction — see `store.py`."""

    id: str
    source_id: str
    text: str
    locator: Locator | None = None
    captured_at: str = ""
    node: Node
    star_rating: int | None = Field(default=None, ge=1, le=5)
    posted_at: str = ""
    axis: Axis | None = None
    # A working index over excerpts, not a finding. Labels only, no descriptions
    # (§5) — a theme with prose attached is a conclusion wearing a hat.
    themes: list[str] = Field(default_factory=list)


class Measurement(Strict):
    """A number a source states, copied with its unit and period."""

    id: str
    node: Node
    metric: str
    value: float | str
    unit: str = ""
    period: str = ""
    source_id: str
    locator: Locator | None = None


class Attribute(Strict):
    """A field lifted off a page: dose, price, format, first-seen date."""

    id: str
    node: Node
    key: str
    value: str
    source_id: str
    locator: Locator | None = None


class SaturationPoint(Strict):
    source_id: str
    new_themes: int
    cumulative_themes: int


class Saturation(Strict):
    node: Node
    curve: list[SaturationPoint] = Field(default_factory=list)
    stopped_because: str = ""


class NodeStatus(Strict):
    node: Node
    status: Literal["complete", "incomplete"]
    done_criterion_met: bool
    why: str = ""


class Gap(Strict):
    node: Node
    missing: str
    would_need: str = ""
    blocking: bool = False


class StagePacket(Strict):
    """What one stage-1 run emits. Nothing here may be a judgement."""

    contract_version: str = CONTRACT_VERSION
    stage: Literal[1] = 1
    run_id: str = ""            # echoed; agentchat is the authority on run ids
    brief: Brief
    sources: list[Source] = Field(default_factory=list)
    excerpts: list[Excerpt] = Field(default_factory=list)
    measurements: list[Measurement] = Field(default_factory=list)
    attributes: list[Attribute] = Field(default_factory=list)
    saturation: list[Saturation] = Field(default_factory=list)
    nodes: list[NodeStatus] = Field(default_factory=list)
    gaps: list[Gap] = Field(default_factory=list)


# -- standing judgements (§7) ------------------------------------------------

JudgementKind = Literal[
    "source_rule", "weighting", "avatar_rule", "language_rule", "custom"
]


class JudgementIn(Strict):
    kind: JudgementKind = "custom"
    text: str
    # `source_rule` only: kinds this rule rejects. Mutating the admission policy
    # is what makes the rule mechanical rather than a matter of the model
    # remembering it.
    rejects_kinds: list[SourceKind] = Field(default_factory=list)


class RunRequest(Strict):
    brief: Brief
    model: str = ""
    # Overrides DEFAULT_REJECTED_KINDS when set (empty means "use the default").
    reject_kinds: list[SourceKind] = Field(default_factory=list)

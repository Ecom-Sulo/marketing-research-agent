"""Get the stage-1 packet out of a run's output, and refuse it if it is wrong.

Two jobs, kept separate because they fail for different reasons:

* **extract** — find the JSON in whatever prose the agent wrapped it in.
  Forgiving, because the model's formatting is not the contract.
* **validate** — check it against `spec-stage-1.md` §4.1. Unforgiving, because
  the *shape* is the contract, and a lenient validator here quietly re-permits
  the exact failure stage 1 exists to prevent.
"""

from __future__ import annotations

import json

from pydantic import ValidationError

from .schema import StagePacket


class PacketError(ValueError):
    """The output carried no packet, or one that violates the contract."""


def _fenced_blocks(text: str) -> list[str]:
    """Every ``` … ``` block, in order, by scanning lines.

    A regex is the obvious tool and gets this wrong: with a non-greedy body it
    happily treats one block's *closing* fence as the next block's opening one,
    so a reply that contains a ```python block before the packet yields one
    garbage candidate and no packet. Line-at-a-time is longer and correct.
    """
    blocks: list[str] = []
    body: list[str] | None = None
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            if body is None:
                body = []
            else:
                blocks.append("\n".join(body))
                body = None
            continue
        if body is not None:
            body.append(line)
    if body is not None:  # unterminated fence — the model ran out of room
        blocks.append("\n".join(body))
    return blocks


def extract(output: str) -> dict:
    """Pull the packet object out of a run's final output.

    The *last* decodable block wins: an agent that shows its working writes an
    example first and the real packet last.
    """
    if not output or not output.strip():
        raise PacketError("run produced no output to read a packet from")

    candidates = _fenced_blocks(output)
    # An output that is nothing but JSON is fine too — some models skip fences.
    stripped = output.strip()
    if stripped.startswith("{"):
        candidates.append(stripped)

    for raw in reversed(candidates):
        try:
            decoded = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(decoded, dict) and "stage" in decoded:
            return decoded

    if not candidates:
        raise PacketError(
            "no fenced JSON block in the run output — the packet must be emitted "
            "as ```json … ```"
        )
    raise PacketError(
        "found fenced blocks but none decoded to a stage packet object"
    )


def validate(data: dict) -> StagePacket:
    """Parse into the contract, then apply the §4.1 rules pydantic cannot.

    The `extra="forbid"` models already reject an unknown key — which is what
    makes "stage 1 contains no judgements" structural rather than advisory.
    Everything below is a cross-object rule.
    """
    try:
        packet = StagePacket.model_validate(data)
    except ValidationError as exc:
        raise PacketError(_readable(exc)) from exc

    problems: list[str] = []
    source_ids = {s.id for s in packet.sources}

    # 2. Every reference resolves. A dangling source_id is an excerpt from nowhere.
    for excerpt in packet.excerpts:
        if excerpt.source_id not in source_ids:
            problems.append(
                f"excerpt {excerpt.id!r} cites source {excerpt.source_id!r}, "
                "which is not in the packet"
            )
    for item in (*packet.measurements, *packet.attributes):
        if item.source_id not in source_ids:
            problems.append(
                f"{type(item).__name__.lower()} {item.id!r} cites source "
                f"{item.source_id!r}, which is not in the packet"
            )
    for entry in packet.saturation:
        for point in entry.curve:
            if point.source_id not in source_ids:
                problems.append(
                    f"saturation curve for {entry.node} cites source "
                    f"{point.source_id!r}, which is not in the packet"
                )

    gapped_nodes = {g.node for g in packet.gaps}

    # 3. An ad with no first-seen date is a hole in the sophistication read that
    #    stage 3 depends on. Capture it, but say so.
    for source in packet.sources:
        if source.kind == "ad_library" and source.admitted and not source.first_seen:
            if "competitors" not in gapped_nodes:
                problems.append(
                    f"ad-library source {source.url!r} has no first_seen and no gap "
                    "records the missing dates"
                )
                break

    complete = {n.node for n in packet.nodes if n.status == "complete"}

    # 4. 3★ is mandatory coverage, not a preference — it is where the honest
    #    text lives, so a review node without it has not mined reviews.
    if "review_mining" in complete:
        if not any(e.star_rating == 3 for e in packet.excerpts):
            problems.append(
                "review_mining is complete but no 3-star excerpt was captured"
            )

    # 5. spec.md §4.3 — an empty gap list means the run stopped looking.
    if not packet.gaps:
        problems.append(
            "gap list is empty; real research always has holes, so the run is "
            "treated as failed"
        )

    # 6. Saturation is the done-criterion for everything except the finite
    #    product-data checklist.
    curves = {s.node for s in packet.saturation if s.curve}
    for node in complete - {"product_data"}:
        if node not in curves:
            problems.append(
                f"node {node} is complete with no saturation curve — 'done' has "
                "to be a measurement, not an assertion"
            )

    if problems:
        raise PacketError("; ".join(problems))
    return packet


def parse(output: str) -> StagePacket:
    return validate(extract(output))


def _readable(exc: ValidationError) -> str:
    """pydantic's report, trimmed to the part that says what to fix.

    `extra_forbidden` gets its own wording: the agent wrote a field that does
    not exist, and nine times out of ten that field is a conclusion.
    """
    lines: list[str] = []
    for error in exc.errors()[:8]:
        where = ".".join(str(p) for p in error["loc"]) or "(root)"
        if error["type"] == "extra_forbidden":
            lines.append(
                f"{where}: field not in the stage-1 contract. Stage 1 gathers "
                "material and records nothing else — a conclusion has no field "
                "to live in"
            )
        else:
            lines.append(f"{where}: {error['msg']}")
    remaining = len(exc.errors()) - len(lines)
    if remaining > 0:
        lines.append(f"(+{remaining} more)")
    return "; ".join(lines)

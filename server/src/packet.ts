/**
 * Get the stage-1 packet out of a run's output, and refuse it if it is wrong.
 *
 * Two jobs, kept separate because they fail for different reasons:
 *
 * * **extract** — find the JSON in whatever prose the agent wrapped it in.
 *   Forgiving, because the model's formatting is not the contract.
 * * **validate** — check it against `spec-stage-1.md` §4.1. Unforgiving, because
 *   the *shape* is the contract, and a lenient validator here quietly re-permits
 *   the exact failure stage 1 exists to prevent.
 */

import { z } from "zod";

import { stagePacketSchema, type StagePacket } from "./schema.js";

/** The output carried no packet, or one that violates the contract. */
export class PacketError extends Error {
  override readonly name = "PacketError";
}

/**
 * Every ``` … ``` block, in order, by scanning lines.
 *
 * A regex is the obvious tool and gets this wrong: with a non-greedy body it
 * happily treats one block's *closing* fence as the next block's opening one,
 * so a reply that contains a ```python block before the packet yields one
 * garbage candidate and no packet. Line-at-a-time is longer and correct.
 */
function fencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  let body: string[] | null = null;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      if (body === null) {
        body = [];
      } else {
        blocks.push(body.join("\n"));
        body = null;
      }
      continue;
    }
    if (body !== null) body.push(line);
  }
  if (body !== null) blocks.push(body.join("\n")); // unterminated fence — the model ran out of room
  return blocks;
}

/**
 * Pull the packet object out of a run's final output.
 *
 * The *last* decodable block wins: an agent that shows its working writes an
 * example first and the real packet last.
 */
export function extract(output: string): Record<string, unknown> {
  if (!output || !output.trim()) {
    throw new PacketError("run produced no output to read a packet from");
  }

  const candidates = fencedBlocks(output);
  // An output that is nothing but JSON is fine too — some models skip fences.
  const stripped = output.trim();
  if (stripped.startsWith("{")) candidates.push(stripped);

  for (let i = candidates.length - 1; i >= 0; i--) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(candidates[i]!);
    } catch {
      continue;
    }
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded) && "stage" in decoded) {
      return decoded as Record<string, unknown>;
    }
  }

  if (candidates.length === 0) {
    throw new PacketError(
      "no fenced JSON block in the run output — the packet must be emitted as ```json … ```",
    );
  }
  throw new PacketError("found fenced blocks but none decoded to a stage packet object");
}

/**
 * Parse into the contract, then apply the §4.1 rules the schema cannot.
 *
 * The `.strict()` objects already reject an unknown key — which is what makes
 * "stage 1 contains no judgements" structural rather than advisory. Everything
 * below is a cross-object rule.
 */
export function validate(data: unknown): StagePacket {
  const parsed = stagePacketSchema.safeParse(data);
  if (!parsed.success) throw new PacketError(readable(parsed.error));
  const packet = parsed.data;

  const problems: string[] = [];
  const sourceIds = new Set(packet.sources.map((s) => s.id));

  // 2. Every reference resolves. A dangling source_id is an excerpt from nowhere.
  for (const excerpt of packet.excerpts) {
    if (!sourceIds.has(excerpt.source_id)) {
      problems.push(
        `excerpt '${excerpt.id}' cites source '${excerpt.source_id}', which is not in the packet`,
      );
    }
  }
  for (const [label, items] of [
    ["measurement", packet.measurements],
    ["attribute", packet.attributes],
  ] as const) {
    for (const item of items) {
      if (!sourceIds.has(item.source_id)) {
        problems.push(
          `${label} '${item.id}' cites source '${item.source_id}', which is not in the packet`,
        );
      }
    }
  }
  for (const entry of packet.saturation) {
    for (const point of entry.curve) {
      if (!sourceIds.has(point.source_id)) {
        problems.push(
          `saturation curve for ${entry.node} cites source '${point.source_id}', ` +
            "which is not in the packet",
        );
      }
    }
  }

  const gappedNodes = new Set(packet.gaps.map((g) => g.node));

  // 3. An ad with no first-seen date is a hole in the sophistication read that
  //    stage 3 depends on. Capture it, but say so.
  for (const source of packet.sources) {
    if (source.kind === "ad_library" && source.admitted && !source.first_seen) {
      if (!gappedNodes.has("competitors")) {
        problems.push(
          `ad-library source '${source.url}' has no first_seen and no gap records the missing dates`,
        );
        break;
      }
    }
  }

  const complete = new Set(packet.nodes.filter((n) => n.status === "complete").map((n) => n.node));

  // 4. 3★ is mandatory coverage, not a preference — it is where the honest
  //    text lives, so a review node without it has not mined reviews.
  if (complete.has("review_mining")) {
    if (!packet.excerpts.some((e) => e.star_rating === 3)) {
      problems.push("review_mining is complete but no 3-star excerpt was captured");
    }
  }

  // 5. spec.md §4.3 — an empty gap list means the run stopped looking.
  if (packet.gaps.length === 0) {
    problems.push(
      "gap list is empty; real research always has holes, so the run is treated as failed",
    );
  }

  // 6. Saturation is the done-criterion for everything except the finite
  //    product-data checklist.
  const curves = new Set(packet.saturation.filter((s) => s.curve.length > 0).map((s) => s.node));
  for (const node of complete) {
    if (node === "product_data") continue;
    if (!curves.has(node)) {
      problems.push(
        `node ${node} is complete with no saturation curve — 'done' has to be a ` +
          "measurement, not an assertion",
      );
    }
  }

  if (problems.length > 0) throw new PacketError(problems.join("; "));
  return packet;
}

export function parse(output: string): StagePacket {
  return validate(extract(output));
}

/**
 * zod's report, trimmed to the part that says what to fix.
 *
 * `unrecognized_keys` gets its own wording: the agent wrote a field that does
 * not exist, and nine times out of ten that field is a conclusion.
 */
function readable(error: z.ZodError): string {
  const all: string[] = [];
  for (const issue of error.issues) {
    const where = issue.path.join(".") || "(root)";
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        all.push(
          `${where === "(root)" ? key : `${where}.${key}`}: field not in the stage-1 ` +
            "contract. Stage 1 gathers material and records nothing else — a " +
            "conclusion has no field to live in",
        );
      }
    } else {
      all.push(`${where}: ${issue.message}`);
    }
  }
  const lines = all.slice(0, 8);
  const remaining = all.length - lines.length;
  if (remaining > 0) lines.push(`(+${remaining} more)`);
  return lines.join("; ");
}

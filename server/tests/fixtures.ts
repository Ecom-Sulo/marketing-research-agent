/** A packet that validates. Tests mutate one thing and assert the failure. */
export function minimalPacket(overrides: Record<string, unknown> = {}): Record<string, any> {
  const data: Record<string, any> = {
    contract_version: "1",
    stage: 1,
    brief: { product: "MagnaCalm 400mg", url: "https://x", market: "UK" },
    sources: [
      {
        id: "sha256:aaa",
        url: "https://reddit.com/r/insomnia/1",
        kind: "forum",
        publisher: "reddit.com",
        fetched_at: "2026-09-10T09:00:00Z",
        admitted: true,
        admission_reason: "forum — default policy",
        archived: true,
        node: "review_mining",
      },
    ],
    excerpts: [
      {
        id: "sha256:bbb",
        source_id: "sha256:aaa",
        text: "I wake up at 3am and can't get back to sleep.",
        captured_at: "2026-09-10T09:00:01Z",
        node: "review_mining",
        star_rating: 3,
        axis: "why_quit",
        themes: ["3am waking"],
      },
    ],
    saturation: [
      {
        node: "review_mining",
        curve: [{ source_id: "sha256:aaa", new_themes: 1, cumulative_themes: 1 }],
        stopped_because: "three consecutive sources added no new theme",
      },
    ],
    nodes: [
      {
        node: "review_mining",
        status: "complete",
        done_criterion_met: true,
        why: "saturated",
      },
    ],
    gaps: [
      {
        node: "competitors",
        missing: "CalmWell UK ad library empty",
        would_need: "a UK-IP pull",
        blocking: false,
      },
    ],
  };
  return { ...data, ...overrides };
}

export function fenced(data: unknown, prose = "Here is the packet."): string {
  return `${prose}\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`;
}

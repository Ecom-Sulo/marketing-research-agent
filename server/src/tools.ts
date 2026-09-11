/**
 * The agent's two tools: find pages, and read one.
 *
 * **Superseded:** hermes supplied `web_search` / `web_extract` / a terminal / a
 * browser, and the run depended on which of those the harness happened to have
 * configured — the first live run fell back to driving a browser because `ddgs`
 * was missing on the VPS, and the cockpit showed a run that looked idle while it
 * worked. In-process there is no harness to configure: these two functions are
 * the entire surface the agent has, and they are the same two on every machine.
 *
 * The narrowing is also the security story. Stage 1 reasons over pages fetched
 * from the open web, which is the textbook setup for prompt injection. Neither
 * tool can run a command, read a file, or write anywhere except the corpus
 * directory this run owns, so the worst a poisoned page can do is lie to the
 * packet — and the packet is validated.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import type { Settings } from "./settings.js";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface FetchRecord {
  source_id: string;
  url: string;
  title: string;
  archived: boolean;
  chars: number;
  truncated: boolean;
}

/** What the runner needs to know about a tool call, for the cockpit's lanes. */
export type ToolLane = "search" | "fetch" | "other";

export const TOOL_LANES: Record<string, ToolLane> = {
  web_search: "search",
  web_fetch: "fetch",
};

/** Fetch with a deadline. `AbortSignal.timeout` alone loses the caller's own signal. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutSeconds * 1000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return await fetch(url, { ...init, signal: combined });
}

/**
 * SearXNG search.
 *
 * `format=json` is refused by a stock SearXNG — the instance in this stack adds
 * it in `searxng/settings.yml`, and without that every search fails with a 403
 * that reads like a bug in this code.
 */
export async function searxngSearch(
  settings: Settings,
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const url = new URL("/search", settings.searxngUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");

  const response = await fetchWithTimeout(
    url.toString(),
    { headers: { Accept: "application/json" } },
    settings.webTimeoutSeconds,
    signal,
  );
  if (!response.ok) {
    throw new Error(
      `SearXNG returned ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
  }
  const body = (await response.json()) as { results?: Array<Record<string, unknown>> };
  return (body.results ?? []).slice(0, maxResults).map((r) => ({
    title: String(r.title ?? ""),
    url: String(r.url ?? ""),
    snippet: String(r.content ?? ""),
  }));
}

/** Firecrawl scrape, returning readable markdown plus whatever title it found. */
export async function firecrawlScrape(
  settings: Settings,
  url: string,
  signal?: AbortSignal,
): Promise<{ text: string; title: string }> {
  if (!settings.firecrawlApiKey) {
    throw new Error("FIRECRAWL_API_KEY is not set — web_fetch cannot read pages");
  }
  const response = await fetchWithTimeout(
    `${settings.firecrawlBaseUrl.replace(/\/$/, "")}/v2/scrape`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    },
    settings.webTimeoutSeconds,
    signal,
  );
  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    data?: { markdown?: string; metadata?: { title?: string } };
  };
  if (!response.ok || payload.success === false) {
    throw new Error(
      `Firecrawl returned ${response.status}: ${payload.error ?? "no body"}`.slice(0, 300),
    );
  }
  const text = payload.data?.markdown ?? "";
  if (!text.trim()) throw new Error("Firecrawl returned an empty body for this url");
  return { text, title: payload.data?.metadata?.title ?? "" };
}

/**
 * Write the fetched body to this run's corpus and return its id.
 *
 * The id is the sha256 of the **exact bytes written**, not of some normalised
 * form of them: `GET /api/research/runs/:id/sources/:sha` re-hashes the file and
 * reports whether it still matches. Hashing anything other than what lands on
 * disk turns that audit into a permanent false negative.
 *
 * A failed write is not a failed fetch. The agent still gets the text, the
 * source is recorded `archived: false`, and the prompt tells it to gap that.
 */
export async function archive(
  corpusPath: string,
  runId: string,
  text: string,
): Promise<{ sourceId: string; archived: boolean }> {
  const body = Buffer.from(text, "utf-8");
  const digest = createHash("sha256").update(body).digest("hex");
  const sourceId = `sha256:${digest}`;
  try {
    const dir = join(corpusPath, "runs", runId, "sources");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, digest), body);
    return { sourceId, archived: true };
  } catch {
    return { sourceId, archived: false };
  }
}

const searchParameters = Type.Object({
  query: Type.String({ description: "The search query." }),
  max_results: Type.Optional(
    Type.Number({ description: "How many results to return (default 10, max 25)." }),
  ),
});

const fetchParameters = Type.Object({
  url: Type.String({ description: "The absolute url to fetch." }),
});

/**
 * The tools for one run. Bound to a run id because the corpus is per-run — a
 * tool that could be pointed at another run's directory is a tool that can
 * forge another run's audit trail.
 */
export function createResearchTools(options: {
  settings: Settings;
  runId: string;
  onFetch?: (record: FetchRecord) => void;
}): AgentTool<any>[] {
  const { settings, runId, onFetch } = options;

  const webSearch: AgentTool<typeof searchParameters> = {
    name: "web_search",
    label: "Web search",
    description:
      "Search the web and return titles, urls and snippets. Snippets are for " +
      "choosing what to fetch — they are not sources. Never quote a snippet and " +
      "never record a source you have not fetched with web_fetch.",
    parameters: searchParameters,
    async execute(_id, params, signal) {
      const max = Math.min(Math.max(Math.trunc(params.max_results ?? 10), 1), 25);
      const hits = await searxngSearch(settings, params.query, max, signal);
      if (hits.length === 0) {
        return {
          content: [{ type: "text", text: `No results for ${JSON.stringify(params.query)}.` }],
          details: { query: params.query, hits: [] },
        };
      }
      const rendered = hits
        .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
        .join("\n\n");
      return {
        content: [{ type: "text", text: rendered }],
        details: { query: params.query, hits },
      };
    },
  };

  const webFetch: AgentTool<typeof fetchParameters> = {
    name: "web_fetch",
    label: "Fetch page",
    description:
      "Fetch one url and return its readable text. The body is archived and " +
      "hashed before you see it; the result carries the source_id to cite. Use " +
      "that id verbatim as the source's `id` and set `archived` to what the " +
      "result reports.",
    parameters: fetchParameters,
    async execute(_id, params, signal) {
      const { text, title } = await firecrawlScrape(settings, params.url, signal);
      const { sourceId, archived } = await archive(settings.corpusPath, runId, text);
      const truncated = text.length > settings.fetchCharLimit;
      const shown = truncated ? text.slice(0, settings.fetchCharLimit) : text;

      const record: FetchRecord = {
        source_id: sourceId,
        url: params.url,
        title,
        archived,
        chars: text.length,
        truncated,
      };
      onFetch?.(record);

      const header = [
        `source_id: ${sourceId}`,
        `url: ${params.url}`,
        title ? `title: ${title}` : "",
        `archived: ${archived}`,
        archived
          ? ""
          : "NOTE: the corpus volume could not be written. Record this source " +
            "with archived: false and add a gap entry saying so.",
        truncated
          ? `NOTE: showing the first ${settings.fetchCharLimit} of ${text.length} characters. ` +
            "The archived copy is complete; character offsets in a locator still refer to it."
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text", text: `${header}\n\n---\n\n${shown}` }],
        details: record,
      };
    },
  };

  return [webSearch, webFetch];
}

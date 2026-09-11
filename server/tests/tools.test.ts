/**
 * The agent's two tools.
 *
 * `fetch` is stubbed, so these test our handling of the two services rather than
 * the services themselves. The one thing that must be exactly right is the
 * source id: `GET /runs/:id/sources/:sha` re-hashes the archived file and
 * reports whether it still matches, so an id computed over anything other than
 * the bytes written turns that audit into a permanent false negative.
 */

import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSettings, type Settings } from "../src/settings.js";
import { archive, createResearchTools } from "../src/tools.js";

let dir: string;
let settings: Settings;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mra-tools-"));
  settings = {
    ...loadSettings(),
    corpusPath: join(dir, "corpus"),
    searxngUrl: "http://searxng.test",
    firecrawlApiKey: "test-key",
    firecrawlBaseUrl: "https://firecrawl.test",
    fetchCharLimit: 100,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const tools = (runId = "run-1") => {
  const list = createResearchTools({ settings, runId });
  return {
    search: list.find((t) => t.name === "web_search")!,
    fetch: list.find((t) => t.name === "web_fetch")!,
  };
};

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: RequestInit) => handler(String(input), init)));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("web_search", () => {
  it("reads SearXNG's json results", async () => {
    stubFetch((url) => {
      expect(url).toContain("format=json");
      expect(url).toContain("q=magnesium");
      return json({
        results: [
          { title: "A", url: "https://a.example", content: "snippet a" },
          { title: "B", url: "https://b.example", content: "snippet b" },
        ],
      });
    });
    const result = await tools().search.execute("1", { query: "magnesium" });
    expect(result.details.hits).toHaveLength(2);
    expect((result.content[0] as any).text).toContain("https://a.example");
  });

  it("honours max_results and clamps it", async () => {
    stubFetch(() =>
      json({ results: Array.from({ length: 40 }, (_, i) => ({ title: `${i}`, url: `https://${i}.example`, content: "" })) }),
    );
    expect((await tools().search.execute("1", { query: "x", max_results: 3 })).details.hits).toHaveLength(3);
    expect((await tools().search.execute("1", { query: "x", max_results: 99 })).details.hits).toHaveLength(25);
  });

  it("says so plainly when there are no results", async () => {
    stubFetch(() => json({ results: [] }));
    const result = await tools().search.execute("1", { query: "nothing" });
    expect((result.content[0] as any).text).toMatch(/No results/);
  });

  it("throws on a SearXNG error rather than returning an empty page", async () => {
    // A stock SearXNG refuses format=json with a 403, and swallowing that makes
    // it look like the web simply has nothing to say about the product.
    stubFetch(() => new Response("forbidden", { status: 403 }));
    await expect(tools().search.execute("1", { query: "x" })).rejects.toThrow(/403/);
  });
});

describe("web_fetch", () => {
  const page = (markdown: string, title = "A page") =>
    json({ success: true, data: { markdown, metadata: { title } } });

  it("archives the body and hands back an id that still hashes to it", async () => {
    const body = "the readable text of the page";
    stubFetch(() => page(body));
    const result = await tools("run-7").fetch.execute("1", { url: "https://a.example" });

    expect(result.details.archived).toBe(true);
    const digest = result.details.source_id.replace("sha256:", "");
    const written = readFileSync(join(settings.corpusPath, "runs", "run-7", "sources", digest));
    expect(createHash("sha256").update(written).digest("hex")).toBe(digest);
    expect(written.toString("utf-8")).toBe(body);
  });

  it("puts the id and the archived flag where the agent will read them", async () => {
    stubFetch(() => page("text"));
    const text = (await tools().fetch.execute("1", { url: "https://a.example" }))
      .content[0] as any;
    expect(text.text).toMatch(/^source_id: sha256:[0-9a-f]{64}$/m);
    expect(text.text).toMatch(/^archived: true$/m);
  });

  it("truncates what the model reads but never what is archived", async () => {
    const body = "x".repeat(500);
    stubFetch(() => page(body));
    const result = await tools("run-8").fetch.execute("1", { url: "https://a.example" });

    expect(result.details.truncated).toBe(true);
    expect(result.details.chars).toBe(500);
    expect((result.content[0] as any).text).toMatch(/showing the first 100 of 500 characters/);
    const digest = result.details.source_id.replace("sha256:", "");
    const written = readFileSync(join(settings.corpusPath, "runs", "run-8", "sources", digest));
    expect(written.length).toBe(500);
  });

  it("reports archived: false rather than failing when the corpus is unwritable", async () => {
    // The run is not blocked by a missing corpus volume — the source becomes a gap.
    stubFetch(() => page("text"));
    // A regular file where the corpus directory should be: mkdir under it fails
    // with ENOTDIR, which is the same shape as the volume simply not being there.
    const blocked = join(dir, "not-a-directory");
    writeFileSync(blocked, "");
    settings = { ...settings, corpusPath: blocked };
    const result = await tools().fetch.execute("1", { url: "https://a.example" });
    expect(result.details.archived).toBe(false);
    expect((result.content[0] as any).text).toMatch(/corpus volume could not be written/);
  });

  it("refuses to run without a Firecrawl key instead of returning nothing", async () => {
    settings = { ...settings, firecrawlApiKey: "" };
    await expect(tools().fetch.execute("1", { url: "https://a.example" })).rejects.toThrow(
      /FIRECRAWL_API_KEY/,
    );
  });

  it("treats an empty body as a failure", async () => {
    stubFetch(() => page("   "));
    await expect(tools().fetch.execute("1", { url: "https://a.example" })).rejects.toThrow(
      /empty body/,
    );
  });

  it("surfaces a Firecrawl error", async () => {
    stubFetch(() => json({ success: false, error: "rate limited" }, 429));
    await expect(tools().fetch.execute("1", { url: "https://a.example" })).rejects.toThrow(
      /rate limited/,
    );
  });
});

describe("archive", () => {
  it("hashes the exact bytes written, not a normalised form", async () => {
    const text = "  leading and trailing whitespace matters  \r\n";
    const { sourceId, archived } = await archive(join(dir, "corpus"), "run-9", text);
    expect(archived).toBe(true);
    const expected = createHash("sha256").update(Buffer.from(text, "utf-8")).digest("hex");
    expect(sourceId).toBe(`sha256:${expected}`);
  });
});

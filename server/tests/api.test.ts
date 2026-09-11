/**
 * The HTTP surface.
 *
 * Exercised through `app.fetch` rather than a live socket. The corpus route gets
 * the most attention here: it serves bytes fetched from the open web back to a
 * browser on our own origin, and it is the one place where getting a header
 * wrong turns a scraped page into a script.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels, type MutableModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp, type App } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { RunSupervisor } from "../src/runner.js";
import { loadSettings, type Settings } from "../src/settings.js";
import { SqliteResearchStore } from "../src/store.js";
import { fenced, minimalPacket } from "./fixtures.js";

const MODEL_ID = "faux-model";

let dir: string;
let app: App;
let store: SqliteResearchStore;
let settings: Settings;
let faux: ReturnType<typeof fauxProvider>;
let models: MutableModels;

function build(settingsOverrides: Partial<Settings> = {}): App {
  settings = {
    ...loadSettings(),
    model: MODEL_ID,
    corpusPath: join(dir, "corpus"),
    staticDir: join(dir, "static"),
    appPasswordHash: "",
    ...settingsOverrides,
  };
  store = new SqliteResearchStore(join(dir, "research.db"));
  faux = fauxProvider({ provider: "openrouter", models: [{ id: MODEL_ID }] });
  models = createModels();
  models.setProvider(faux.provider);
  const supervisor = new RunSupervisor({ store, settings, models });
  return createApp({ settings, store, supervisor });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mra-api-"));
  app = build();
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (path: string, init?: RequestInit) =>
  app.fetch(new Request(`http://test${path}`, init));
const post = (path: string, body: unknown, init: RequestInit = {}) =>
  app.fetch(
    new Request(`http://test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...init,
    }),
  );

describe("runs", () => {
  it("starts a run and reads it back", async () => {
    faux.setResponses([fauxAssistantMessage(fenced(minimalPacket()))]);
    const created = await post("/api/research/runs", { brief: { product: "MagnaCalm" } });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };

    await app.supervisor.waitFor(id);
    const read = (await (await get(`/api/research/runs/${id}`)).json()) as any;
    expect(read.status).toBe("completed");
    expect(read.packet.excerpts).toHaveLength(1);
    expect(read.live).toBe(false);
  });

  it("refuses a run without a product", async () => {
    const response = await post("/api/research/runs", { brief: { product: "  " } });
    expect(response.status).toBe(400);
  });

  it("refuses a request carrying a field the contract has no room for", async () => {
    const response = await post("/api/research/runs", {
      brief: { product: "x" },
      conclude: true,
    });
    expect(response.status).toBe(400);
  });

  it("404s an unknown run", async () => {
    expect((await get("/api/research/runs/nope")).status).toBe(404);
  });

  it("replays the whole run over SSE", async () => {
    faux.setResponses([fauxAssistantMessage(fenced(minimalPacket()))]);
    const { id } = (await (
      await post("/api/research/runs", { brief: { product: "MagnaCalm" } })
    ).json()) as { id: string };
    await app.supervisor.waitFor(id);

    const body = await (await get(`/api/research/runs/${id}/events`)).text();
    expect(body).toContain("event: event");
    expect(body).toContain("run.started");
    expect(body).toContain("packet.ready");
    expect(body).toContain('"reason":"not live"');
  });
});

describe("the corpus route", () => {
  const write = (runId: string, text: string) => {
    const digest = createHash("sha256").update(Buffer.from(text, "utf-8")).digest("hex");
    const dirPath = join(settings.corpusPath, "runs", runId, "sources");
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(join(dirPath, digest), text);
    return digest;
  };

  const runId = async () =>
    store.createRun({ brief: {}, model: MODEL_ID, rejectKinds: [], judgementIds: [] }).id;

  it("rejects anything that is not a bare hash", async () => {
    const id = await runId();
    for (const sha of ["../../etc/passwd", "nope", "AAAA"]) {
      const response = await get(
        `/api/research/runs/${id}/sources/${encodeURIComponent(sha)}`,
      );
      expect([400, 404]).toContain(response.status);
    }
  });

  it("serves the archived body as inert text with its digest", async () => {
    const id = await runId();
    const digest = write(id, "<script>alert(1)</script> the page text");
    const response = await get(`/api/research/runs/${id}/sources/${digest}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/text\/plain/);
    expect(response.headers.get("X-Corpus-Digest")).toBe(digest);
    expect(response.headers.get("X-Corpus-Digest-Matches")).toBe("true");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toContain("<script>");
  });

  it("says so when the archived file no longer hashes to its id", async () => {
    // The whole point of storing the hash as the id is that this is checkable.
    const id = await runId();
    const digest = write(id, "original");
    writeFileSync(join(settings.corpusPath, "runs", id, "sources", digest), "tampered");
    const response = await get(`/api/research/runs/${id}/sources/${digest}`);
    expect(response.headers.get("X-Corpus-Digest-Matches")).toBe("false");
  });

  it("404s a hash that was never archived", async () => {
    const id = await runId();
    expect((await get(`/api/research/runs/${id}/sources/${"a".repeat(64)}`)).status).toBe(404);
  });
});

describe("config", () => {
  it("reports whether the corpus is actually mounted", async () => {
    const missing = (await (await get("/api/research/config")).json()) as any;
    expect(missing.corpus_mounted).toBe(false);
    expect(missing.default_reject_kinds).toContain("seo_listicle");
    expect(missing.model).toBe(MODEL_ID);

    mkdirSync(settings.corpusPath, { recursive: true });
    const present = (await (await get("/api/research/config")).json()) as any;
    expect(present.corpus_mounted).toBe(true);
  });
});

describe("judgements", () => {
  it("stores one and lists it", async () => {
    const created = await post("/api/research/judgements", {
      kind: "source_rule",
      text: "no listicles",
      rejects_kinds: ["seo_listicle"],
    });
    expect(created.status).toBe(200);
    const listed = (await (await get("/api/research/judgements")).json()) as any;
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0].text).toBe("no listicles");
  });

  it("refuses an empty judgement", async () => {
    expect((await post("/api/research/judgements", { text: "   " })).status).toBe(400);
  });

  it("409s a steer at a run that is not running here", async () => {
    const id = store.createRun({
      brief: {},
      model: MODEL_ID,
      rejectKinds: [],
      judgementIds: [],
    }).id;
    const response = await post(`/api/research/runs/${id}/steer`, { text: "prefer UK" });
    expect(response.status).toBe(409);
    // Stored anyway: a correction is worth keeping even if its run has ended.
    expect(store.listJudgements()).toHaveLength(1);
  });
});

describe("auth", () => {
  it("is disabled, loudly, when no password hash is set", async () => {
    const session = (await (await get("/api/auth/session")).json()) as any;
    expect(session).toMatchObject({ authenticated: true, auth_required: false });
  });

  it("guards the research routes when a hash is set", async () => {
    await app.close();
    app = build({ appPasswordHash: await hashPassword("hunter2"), jwtSecret: "s".repeat(32) });

    expect((await get("/api/research/runs")).status).toBe(401);

    const bad = await post("/api/auth/login", { username: "ash", password: "wrong" });
    expect(bad.status).toBe(401);

    const good = await post("/api/auth/login", { username: "ash", password: "hunter2" });
    expect(good.status).toBe(200);
    const cookie = good.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");

    const allowed = await get("/api/research/runs", {
      headers: { Cookie: cookie.split(";")[0]! },
    });
    expect(allowed.status).toBe(200);
  });
});

describe("the SPA mount", () => {
  it("404s a missing api path instead of answering with the shell", async () => {
    // Falling back to index.html here answers a failed API call with HTML and a
    // 200, which clients then try to parse as JSON.
    const response = await get("/api/nope");
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toMatch(/json/);
  });

  it("serves index.html for a client route", async () => {
    mkdirSync(settings.staticDir, { recursive: true });
    writeFileSync(join(settings.staticDir, "index.html"), "<h1>cockpit</h1>");
    const response = await get("/runs/abc");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("cockpit");
    expect(response.headers.get("Cache-Control")).toMatch(/no-store/);
  });

  it("refuses to serve a file outside the static root", async () => {
    mkdirSync(settings.staticDir, { recursive: true });
    writeFileSync(join(dir, "secret.txt"), "nope");
    const response = await get("/../secret.txt");
    expect(response.status).toBe(404);
  });
});

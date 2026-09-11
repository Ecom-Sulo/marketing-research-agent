/**
 * The service: auth, the research routes, and the built SPA.
 *
 * Deliberately small. Everything interesting lives in `api.ts` (the routes),
 * `runner.ts` (the run lifecycle), `tools.ts` (what the agent can reach) and
 * `packet.ts` (what a valid stage-1 output is). This file wires them together
 * and puts a login in front.
 */

import { readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { TokenService, verifyPassword } from "./auth.js";
import { buildRouter } from "./api.js";
import { RunSupervisor } from "./runner.js";
import { loadSettings, type Settings } from "./settings.js";
import { SqliteResearchStore, type ResearchStore } from "./store.js";

export const SESSION_COOKIE = "mra_session";

export interface App {
  fetch: Hono["fetch"];
  supervisor: RunSupervisor;
  store: ResearchStore;
  settings: Settings;
  close(): Promise<void>;
}

export function createApp(overrides?: {
  settings?: Settings;
  store?: ResearchStore;
  supervisor?: RunSupervisor;
}): App {
  const settings = overrides?.settings ?? loadSettings();
  const store = overrides?.store ?? new SqliteResearchStore(settings.databasePath);
  const supervisor = overrides?.supervisor ?? new RunSupervisor({ store, settings });

  const authRequired = Boolean(settings.appPasswordHash);
  if (!authRequired) {
    console.warn("MRA_APP_PASSWORD_HASH is empty — authentication is DISABLED");
  }
  // TokenService throws on an empty secret, which is correct in production and
  // wrong for a local run with auth switched off entirely.
  const tokens = authRequired
    ? new TokenService(settings.jwtSecret, { sessionHours: settings.sessionHours })
    : null;

  const app = new Hono();

  const currentUser = async (token: string | undefined): Promise<string | null> => {
    if (!authRequired) return settings.appUser;
    if (!token || !tokens) return null;
    return await tokens.verify(token);
  };

  app.get("/api/auth/session", async (c) => {
    if (!authRequired) {
      return c.json({ authenticated: true, user: settings.appUser, auth_required: false });
    }
    const subject = await currentUser(getCookie(c, SESSION_COOKIE));
    return c.json({ authenticated: Boolean(subject), user: subject, auth_required: true });
  });

  app.post("/api/auth/login", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      username?: unknown;
      password?: unknown;
    };
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const ok =
      username === settings.appUser &&
      Boolean(settings.appPasswordHash) &&
      (await verifyPassword(password, settings.appPasswordHash));
    if (!ok || !tokens) return c.json({ detail: "invalid credentials" }, 401);
    setCookie(c, SESSION_COOKIE, await tokens.issue(username), {
      httpOnly: true,
      secure: settings.cookieSecure,
      sameSite: "Lax",
      maxAge: settings.sessionHours * 3600,
      path: "/",
    });
    return c.json({ user: username });
  });

  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  // Everything under /api/research needs a session.
  app.use("/api/research/*", async (c, next) => {
    const subject = await currentUser(getCookie(c, SESSION_COOKIE));
    if (!subject) return c.json({ detail: "not authenticated" }, 401);
    await next();
  });
  app.route("/api/research", buildRouter({ store, supervisor, settings }));

  mountFrontend(app, settings.staticDir);

  return {
    fetch: app.fetch,
    supervisor,
    store,
    settings,
    async close() {
      await supervisor.close();
      store.close();
    },
  };
}

/**
 * Anything under these prefixes is a real resource or nothing at all. Falling
 * back to index.html here answers a failed API call with HTML and a 200, which
 * clients then try to parse as JSON — a clean 404 turned into a confusing crash.
 */
const NON_SPA_PREFIXES = ["api/", "assets/"];

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function contentType(path: string): string {
  const dot = path.lastIndexOf(".");
  return (dot === -1 ? undefined : CONTENT_TYPES[path.slice(dot)]) ?? "application/octet-stream";
}

function mountFrontend(app: Hono, staticDir: string): void {
  const root = resolve(staticDir);

  app.get("/*", async (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+/, "");

    if (path) {
      const candidate = resolve(join(root, path));
      if (candidate.startsWith(root + sep)) {
        try {
          if ((await stat(candidate)).isFile()) {
            return c.body(await readFile(candidate), 200, {
              "Content-Type": contentType(candidate),
            });
          }
        } catch {
          // fall through to the SPA shell or a 404
        }
      }
    }

    if (NON_SPA_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return c.json({ detail: `no such resource: /${path}` }, 404);
    }
    if (path.split("/").pop()?.includes(".")) {
      return c.json({ detail: `no such file: /${path}` }, 404);
    }

    try {
      // Never cache the shell, or a browser holding an older build keeps asking
      // for assets that no longer exist.
      return c.html(await readFile(join(root, "index.html"), "utf-8"), 200, {
        "Cache-Control": "no-store, must-revalidate",
      });
    } catch {
      return c.json({ detail: "frontend is not built" }, 404);
    }
  });
}

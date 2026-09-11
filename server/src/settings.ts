/**
 * Environment configuration. Every env var this service reads is declared here.
 *
 * **Superseded:** the Python service talked to its own hermes container, and
 * `hermes_base_url` / `hermes_api_key` / `hermes_session_key` lived here. The
 * harness is now in-process (pi-agent-core), so there is no gateway to address
 * and no second container to isolate against. The isolation argument that
 * justified a separate hermes still holds and is now met differently: the agent
 * gets exactly two tools, both of which only read the web, and neither can
 * reach a shell, a file outside the corpus, or another agent's memory.
 */

export interface Settings {
  // --- auth -------------------------------------------------------------
  appUser: string;
  /** scrypt hash from `npm run hashpw`. Empty disables login entirely, which is
   *  only ever appropriate on localhost. */
  appPasswordHash: string;
  jwtSecret: string;
  sessionHours: number;
  cookieSecure: boolean;

  // --- inference --------------------------------------------------------
  openrouterApiKey: string;
  /**
   * Pi has no notion of a gateway default, so the model is always named. A
   * 1M-token context matters more here than raw capability: one real stage-1
   * run was 1.7M tokens across its turns.
   */
  model: string;

  // --- the web ----------------------------------------------------------
  searxngUrl: string;
  firecrawlApiKey: string;
  firecrawlBaseUrl: string;
  /** Per-request ceiling for a single search or fetch. */
  webTimeoutSeconds: number;
  /** Characters of fetched text handed back to the model in one tool result.
   *  The archived body on disk is never truncated — only what the model reads. */
  fetchCharLimit: number;

  // --- the corpus -------------------------------------------------------
  /** Raw fetched bodies are written here by `web_fetch`, one directory per run.
   *  Absent is survivable — sources come back `archived: false` and each
   *  becomes a gap. */
  corpusPath: string;

  // --- persistence / server ---------------------------------------------
  databasePath: string;
  staticDir: string;
  host: string;
  port: number;
}

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function loadSettings(): Settings {
  return {
    appUser: str("MRA_APP_USER", "ash"),
    appPasswordHash: str("MRA_APP_PASSWORD_HASH", ""),
    jwtSecret: str("MRA_JWT_SECRET", ""),
    sessionHours: num("MRA_SESSION_HOURS", 720),
    cookieSecure: bool("MRA_COOKIE_SECURE", true),

    openrouterApiKey: str("OPENROUTER_API_KEY", ""),
    model: str("MRA_MODEL", "deepseek/deepseek-v4-flash-0731"),

    searxngUrl: str("SEARXNG_URL", "http://searxng:8080"),
    firecrawlApiKey: str("FIRECRAWL_API_KEY", ""),
    firecrawlBaseUrl: str("FIRECRAWL_BASE_URL", "https://api.firecrawl.dev"),
    webTimeoutSeconds: num("MRA_WEB_TIMEOUT_SECONDS", 90),
    fetchCharLimit: num("MRA_FETCH_CHAR_LIMIT", 60000),

    corpusPath: str("MRA_CORPUS_PATH", "/corpus"),

    databasePath: str("MRA_DATABASE_PATH", "/data/research.db"),
    staticDir: str("MRA_STATIC_DIR", "/app/static"),
    host: str("MRA_HOST", "0.0.0.0"),
    port: num("MRA_PORT", 8000),
  };
}

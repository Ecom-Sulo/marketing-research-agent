"""Environment configuration. Every env var this service reads is declared here.

Its own file rather than a shared one, because this is its own service: it has
its own database, its own login, and — the part that matters — **its own hermes
gateway**. The researcher fetches the open web and reasons over what comes back,
so giving it a separate harness with a separate `HERMES_HOME` means a poisoned
page cannot reach the chat agent's memory, sessions or skills.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- auth -------------------------------------------------------------
    app_user: str = "ash"
    # scrypt hash from `python -m mra.hashpw`. Empty disables login entirely,
    # which is only ever appropriate on localhost.
    app_password_hash: str = ""
    jwt_secret: str = ""
    session_hours: int = 720
    cookie_secure: bool = True

    # --- the researcher's own hermes --------------------------------------
    # A separate instance of the same image, not the chat gateway: its own
    # container, its own HERMES_HOME volume, its own state.db, memory, sessions
    # and skills. `hermes` is the compose service name and resolves on the
    # stack's private network — which is why there is no bridge-gateway address
    # and no firewall rule here. See setup.md §5a.
    hermes_base_url: str = "http://hermes:8642/v1"
    hermes_api_key: str = ""
    # Long-term memory channel, constant on purpose — hermes scopes memory to
    # this key and it persists across transcripts, while the per-run session id
    # rotates. Distinct from agentchat's so the two never share a memory.
    hermes_session_key: str = "research"
    # Empty means the gateway's own default route.
    model: str = ""

    # --- the corpus -------------------------------------------------------
    # Shared with the agent sandbox: hermes writes raw fetched bodies here
    # (terminal.docker_volumes: ["/srv/research-corpus:/corpus"]); this service
    # mounts the same host directory read-only. Absent is survivable — sources
    # come back `archived: false` and each becomes a gap.
    corpus_path: str = "/corpus"

    # --- persistence / server ---------------------------------------------
    database_path: str = "/data/research.db"
    static_dir: str = "/app/static"
    host: str = "0.0.0.0"
    port: int = 8000
    request_timeout_seconds: float = 3600.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="MRA_",
        extra="ignore",
        # `model` would otherwise collide with pydantic's protected namespace.
        protected_namespaces=(),
    )


def load_settings() -> Settings:
    return Settings()

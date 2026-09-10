"""The service: auth, the research routes, and the built SPA.

Deliberately small. Everything interesting lives in `api.py` (the routes),
`runner.py` (the run lifecycle) and `packet.py` (what a valid stage-1 output
is). This file only wires them together and puts a login in front.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Cookie, FastAPI, HTTPException, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .api import build_router
from .auth import TokenService, verify_password
from .hermes_runs import HermesRunsClient
from .runner import RunSupervisor
from .settings import Settings, load_settings
from .store import SqliteResearchStore

logger = logging.getLogger(__name__)
SESSION_COOKIE = "mra_session"


class LoginRequest(BaseModel):
    username: str
    password: str


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    store = SqliteResearchStore(settings.database_path)
    tokens = TokenService(settings.jwt_secret, session_hours=settings.session_hours)
    auth_required = bool(settings.app_password_hash)
    if not auth_required:
        logger.warning("MRA_APP_PASSWORD_HASH is empty — authentication is DISABLED")

    supervisor = RunSupervisor(
        store=store,
        client=HermesRunsClient(
            base_url=settings.hermes_base_url,
            api_key=settings.hermes_api_key,
            memory_key=settings.hermes_session_key,
            timeout=settings.request_timeout_seconds,
        ),
        settings=settings,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        # A research run outlives this process — a redeploy mid-run otherwise
        # leaves rows saying `running` with nothing watching them.
        await supervisor.recover()
        yield
        await supervisor.aclose()

    app = FastAPI(title="marketing-research-agent", version="0.1.0", lifespan=lifespan)

    def current_user(
        session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    ) -> str:
        if not auth_required:
            return settings.app_user
        subject = tokens.verify(session) if session else None
        if not subject:
            raise HTTPException(status_code=401, detail="not authenticated")
        return subject

    @app.get("/api/auth/session")
    async def session_state(
        session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    ):
        if not auth_required:
            return {"authenticated": True, "user": settings.app_user, "auth_required": False}
        subject = tokens.verify(session) if session else None
        return {"authenticated": bool(subject), "user": subject, "auth_required": True}

    @app.post("/api/auth/login")
    async def login(body: LoginRequest, response: Response):
        ok = body.username == settings.app_user and verify_password(
            body.password, settings.app_password_hash
        )
        if not ok:
            raise HTTPException(status_code=401, detail="invalid credentials")
        response.set_cookie(
            SESSION_COOKIE,
            tokens.issue(body.username),
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
            max_age=settings.session_hours * 3600,
            path="/",
        )
        return {"user": body.username}

    @app.post("/api/auth/logout")
    async def logout(response: Response):
        response.delete_cookie(SESSION_COOKIE, path="/")
        return {"ok": True}

    @app.get("/api/health")
    async def health():
        return {"status": "ok"}

    # Before _mount_frontend: its catch-all /{path:path} would otherwise match
    # first and answer API calls with the SPA shell.
    app.include_router(
        build_router(
            store=store,
            supervisor=supervisor,
            settings=settings,
            user_dependency=current_user,
        )
    )

    _mount_frontend(app, settings.static_dir)
    return app


# Anything under these prefixes is a real resource or nothing at all. Falling
# back to index.html here answers a failed API call with HTML and a 200, which
# clients then try to parse as JSON — a clean 404 turned into a confusing crash.
_NON_SPA_PREFIXES = ("api/", "assets/")


def _mount_frontend(app: FastAPI, static_dir: str) -> None:
    root = Path(static_dir)
    if not root.is_dir():
        logger.warning("static dir %s missing — running API only", static_dir)
        return
    assets = root / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    def _index() -> FileResponse:
        # Never cache the shell, or a browser holding an older build keeps
        # asking for assets that no longer exist.
        return FileResponse(
            root / "index.html", headers={"Cache-Control": "no-store, must-revalidate"}
        )

    @app.get("/{path:path}")
    async def spa(path: str):
        candidate = (root / path).resolve()
        if path and root.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        if path.startswith(_NON_SPA_PREFIXES):
            raise HTTPException(status_code=404, detail=f"no such resource: /{path}")
        if "." in path.rsplit("/", 1)[-1]:
            raise HTTPException(status_code=404, detail=f"no such file: /{path}")
        return _index()

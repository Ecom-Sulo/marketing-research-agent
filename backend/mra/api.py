"""`/api/research/*` — the cockpit's surface.

Mounted onto the existing app by `create_app`, behind the same auth dependency
as everything else. A tab, not a second product.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse

from .hermes_runs import HermesRunsError
from .settings import Settings
from .schema import DEFAULT_REJECTED_KINDS, JudgementIn, RunRequest
from .runner import RunSupervisor
from .store import ResearchStore

logger = logging.getLogger(__name__)

# A source id is `sha256:<64 hex>`; the path segment is the bare hash. Anything
# else never reaches the filesystem — the corpus is written by an agent whose
# input is the open web, so its ids are untrusted strings.
_SHA_RE = re.compile(r"^[0-9a-f]{64}$")


def build_router(
    *,
    store: ResearchStore,
    supervisor: RunSupervisor,
    settings: Settings,
    user_dependency,
) -> APIRouter:
    router = APIRouter(prefix="/api/research", dependencies=[Depends(user_dependency)])

    def _run_or_404(run_id: str):
        run = store.get_run(run_id)
        if not run:
            raise HTTPException(status_code=404, detail="no such run")
        return run

    # -- runs -------------------------------------------------------------

    @router.get("/runs")
    async def list_runs(limit: int = 50):
        return {"data": [r.summary() for r in store.list_runs(limit=limit)]}

    @router.post("/runs")
    async def create_run(body: RunRequest):
        if not body.brief.product.strip():
            raise HTTPException(status_code=400, detail="brief.product is required")
        try:
            run_id = await supervisor.start(body)
        except HermesRunsError as exc:
            # 502: the run record exists and is marked failed, so the UI can
            # show what happened rather than losing the attempt.
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return store.get_run(run_id).summary()

    @router.get("/runs/{run_id}")
    async def get_run(run_id: str):
        run = _run_or_404(run_id)
        return {
            **run.summary(),
            "packet": run.packet,
            "output": run.output,
            "reject_kinds": run.reject_kinds,
            "live": supervisor.is_live(run_id),
        }

    @router.get("/runs/{run_id}/events")
    async def run_events(run_id: str, request: Request, after: int = 0):
        """Replay from `after`, then follow live.

        Subscribing *before* replaying is what closes the gap: an event landing
        between the two arrives on the queue and is deduped by id, rather than
        being missed entirely.
        """
        _run_or_404(run_id)
        queue = supervisor.subscribe(run_id)

        async def stream():
            last = after
            try:
                for event in store.list_events(run_id, after_id=last):
                    last = event.id
                    yield _sse("event", {
                        "id": event.id, "kind": event.kind,
                        "payload": event.payload, "created_at": event.created_at,
                    })
                if queue is None:
                    # Finished (or being watched by another process). The replay
                    # above is the whole story.
                    yield _sse("end", {"reason": "not live"})
                    return
                while True:
                    try:
                        frame = await asyncio.wait_for(queue.get(), timeout=20.0)
                    except asyncio.TimeoutError:
                        # Caddy needs `flush_interval -1` for SSE; the keepalive
                        # is also how a dead client is noticed.
                        if await request.is_disconnected():
                            return
                        yield ": keepalive\n\n"
                        continue
                    if frame is None:
                        yield _sse("end", {"reason": "run finished"})
                        return
                    if frame["id"] <= last:
                        continue  # already replayed
                    last = frame["id"]
                    yield _sse("event", frame)
            finally:
                if queue is not None:
                    supervisor.unsubscribe(run_id, queue)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    @router.post("/runs/{run_id}/steer")
    async def steer_run(run_id: str, body: JudgementIn):
        _run_or_404(run_id)
        if not body.text.strip():
            raise HTTPException(status_code=400, detail="judgement text is required")
        # Stored first: a correction the human made is worth keeping even if the
        # run it was aimed at has just ended.
        judgement = store.add_judgement(
            kind=body.kind, text=body.text.strip(),
            rejects_kinds=body.rejects_kinds,
        )
        try:
            await supervisor.steer(run_id, judgement)
        except HermesRunsError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return judgement.as_dict()

    @router.post("/runs/{run_id}/stop")
    async def stop_run(run_id: str):
        _run_or_404(run_id)
        try:
            await supervisor.stop(run_id)
        except HermesRunsError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"ok": True}

    # -- corpus -----------------------------------------------------------

    @router.get("/runs/{run_id}/sources/{sha}", response_class=PlainTextResponse)
    async def source_body(run_id: str, sha: str):
        """The archived raw body, for checking a span against its source.

        Served as text/plain unconditionally. The corpus is fetched from the
        open web; handing a browser something it would render as HTML from our
        own origin is how a scraped page becomes a script on this domain.
        """
        _run_or_404(run_id)
        if not _SHA_RE.match(sha):
            raise HTTPException(status_code=400, detail="not a source hash")
        root = Path(settings.corpus_path) / "runs" / run_id / "sources"
        path = (root / sha).resolve()
        if not str(path).startswith(str(root.resolve()) + "/") or not path.is_file():
            raise HTTPException(status_code=404, detail="not archived")
        body = path.read_bytes()
        digest = hashlib.sha256(body).hexdigest()
        return PlainTextResponse(
            body.decode("utf-8", "replace"),
            headers={
                # Whether the file still hashes to its id is the audit, so say
                # it rather than making the caller recompute it.
                "X-Corpus-Digest": digest,
                "X-Corpus-Digest-Matches": "true" if digest == sha else "false",
                "Content-Security-Policy": "default-src 'none'",
                "X-Content-Type-Options": "nosniff",
            },
        )

    # -- judgements -------------------------------------------------------

    @router.get("/judgements")
    async def list_judgements():
        return {"data": [j.as_dict() for j in store.list_judgements()]}

    @router.post("/judgements")
    async def add_judgement(body: JudgementIn):
        if not body.text.strip():
            raise HTTPException(status_code=400, detail="judgement text is required")
        return store.add_judgement(
            kind=body.kind, text=body.text.strip(), rejects_kinds=body.rejects_kinds
        ).as_dict()

    @router.delete("/judgements/{judgement_id}")
    async def delete_judgement(judgement_id: str):
        store.delete_judgement(judgement_id)
        return {"ok": True}

    # -- config -----------------------------------------------------------

    @router.get("/config")
    async def config():
        """What the cockpit needs to render the run form honestly."""
        corpus = Path(settings.corpus_path)
        return {
            "default_reject_kinds": list(DEFAULT_REJECTED_KINDS),
            "model": settings.model,
            "corpus_path": settings.corpus_path,
            # False means every source will come back `archived: false` and the
            # run will be full of gaps. Better said up front than discovered.
            "corpus_mounted": corpus.is_dir(),
        }

    return router


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"

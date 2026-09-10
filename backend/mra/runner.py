"""Owns a research run for its whole life.

One background task per run consumes hermes's event stream, writes every event
to SQLite, and fans it out to whichever browsers are watching. That ordering is
not decoration:

    hermes  ──(single-consumer, in-memory, not replayable)──▶  runner
    runner  ──(SQLite, replayable, many readers)───────────▶  browsers

Reading hermes directly from the HTTP handler would mean a browser refresh
consumes events a previous connection needed, and a second tab silently steals
half the stream. See `providers/hermes_runs.py` for why the upstream is like
that.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass

from .hermes_runs import HermesRunsClient, HermesRunsError
from .settings import Settings
from . import packet as packet_mod
from . import prompt as prompt_mod
from .schema import Brief, RunRequest
from .store import TERMINAL_STATUSES, Judgement, ResearchStore

logger = logging.getLogger(__name__)

# Events worth keeping. hermes emits a fair amount that is display noise; these
# are the ones the cockpit renders or the audit trail needs.
_KEPT_EVENTS = frozenset({
    "message.delta", "tool.started", "tool.completed", "reasoning.available",
    "subagent.start", "subagent.complete", "run.steered", "run.stopping",
    "run.completed", "run.failed", "run.cancelled",
})

# tool name -> what the cockpit should draw. web_extract takes a list and its
# preview shows only the first element, which is why lanes are a liveness
# indicator and the packet is the record (spec-stage-1.md §8.3).
TOOL_LANES = {
    "web_search": "search",
    "web_extract": "fetch",
    "browser_navigate": "fetch",
    # The agent falls back to driving a browser whenever web_search/web_extract
    # are unavailable, and on the first real run that is exactly what happened
    # (ddgs was missing on the VPS). Without these two the cockpit shows a run
    # that looks idle while it is working hard.
    "browser_exec": "fetch",
    "execute_code": "fetch",
    "terminal": "corpus",
    "write_file": "corpus",
    "delegate_task": "subagent",
}


@dataclass
class _Live:
    task: asyncio.Task
    subscribers: set[asyncio.Queue]


class RunSupervisor:
    """Starts runs and keeps them alive independently of any HTTP connection."""

    def __init__(
        self,
        *,
        store: ResearchStore,
        client: HermesRunsClient,
        settings: Settings,
    ) -> None:
        self._store = store
        self._client = client
        self._settings = settings
        self._live: dict[str, _Live] = {}

    # -- lifecycle --------------------------------------------------------

    async def start(self, request: RunRequest) -> str:
        """Create the run record, admit it upstream, and start watching it."""
        judgements = [
            j for j in self._store.list_judgements(active_only=True)
        ]
        reject_kinds = _effective_reject_kinds(request, judgements)
        run = self._store.create_run(
            brief=request.brief.model_dump(),
            model=request.model or self._settings.model,
            reject_kinds=reject_kinds,
            judgement_ids=[j.id for j in judgements],
        )
        instructions = prompt_mod.build_instructions(
            brief=request.brief,
            run_id=run.id,
            reject_kinds=reject_kinds,
            judgements=judgements,
            corpus_path=self._settings.corpus_path,
        )
        # One hermes session per run, so /steer and the transcript line up.
        session_id = f"research-{run.id}"
        try:
            hermes_run_id = await self._client.start(
                instructions=instructions, model=run.model, session_id=session_id,
            )
        except HermesRunsError as exc:
            self._store.update_run(
                run.id, status="failed", error=str(exc), ended_at=_now_iso()
            )
            self._emit(run.id, "run.failed", {"error": str(exc)})
            raise

        self._store.update_run(
            run.id, hermes_run_id=hermes_run_id, session_id=session_id, status="running"
        )
        self._emit(run.id, "run.started", {"hermes_run_id": hermes_run_id})
        task = asyncio.create_task(self._watch(run.id, hermes_run_id))
        self._live[run.id] = _Live(task=task, subscribers=set())
        return run.id

    async def recover(self) -> None:
        """Settle runs this process was watching when it stopped.

        A stage-1 run is long and a redeploy mid-run is ordinary, so runs are
        left in `running` with nothing consuming them. Re-subscribing is not an
        option: hermes drops a run's transport when its subscriber disconnects
        (`_drop_run_transport`), so the event stream is gone. `GET /v1/runs/{id}`
        still answers, which is enough to record what actually happened instead
        of leaving a run that says `running` forever.
        """
        for run in self._store.list_runs(limit=200):
            if run.status in TERMINAL_STATUSES or not run.hermes_run_id:
                continue
            logger.info("research run %s: reconciling after restart", run.id)
            try:
                await self._reconcile(run.id, run.hermes_run_id, run.output)
            except Exception:  # noqa: BLE001 - one bad run must not block startup
                logger.exception("research run %s: recovery failed", run.id)

    async def steer(self, run_id: str, judgement: Judgement) -> None:
        run = self._store.get_run(run_id)
        if not run or not run.hermes_run_id:
            raise HermesRunsError(f"no live hermes run for {run_id}")
        await self._client.steer(run.hermes_run_id, prompt_mod.steer_text(judgement))
        self._emit(run_id, "run.steered", {
            "judgement_id": judgement.id, "text": judgement.text,
        })

    async def stop(self, run_id: str) -> None:
        run = self._store.get_run(run_id)
        if not run or not run.hermes_run_id:
            raise HermesRunsError(f"no live hermes run for {run_id}")
        self._store.update_run(run_id, status="stopping")
        await self._client.stop(run.hermes_run_id)
        self._emit(run_id, "run.stopping", {})

    async def aclose(self) -> None:
        for live in list(self._live.values()):
            live.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await live.task
        self._live.clear()
        await self._client.aclose()

    # -- watching ---------------------------------------------------------

    async def _watch(self, run_id: str, hermes_run_id: str) -> None:
        """Consume the upstream stream to its end and settle the run."""
        output: list[str] = []
        terminal = False
        try:
            async for event in self._client.events(hermes_run_id):
                name = str(event.get("event") or "")
                if name == "message.delta":
                    output.append(str(event.get("delta") or ""))
                if name not in _KEPT_EVENTS:
                    continue
                self._emit(run_id, name, _payload(name, event))
                if name.startswith("run."):
                    if name == "run.completed":
                        self._settle(run_id, event, "".join(output))
                        terminal = True
                    elif name in ("run.failed", "run.cancelled"):
                        status = "failed" if name == "run.failed" else "cancelled"
                        self._store.update_run(
                            run_id, status=status,
                            error=str(event.get("error") or ""),
                            output="".join(output), ended_at=_now_iso(),
                        )
                        terminal = True
        except asyncio.CancelledError:
            # Shutdown, not failure. `terminal` must be set or the `finally`
            # below awaits _reconcile inside a cancelled task, which re-raises
            # at the first await and skips the cleanup underneath it. The run
            # is genuinely still alive upstream; `recover()` settles it on the
            # next start.
            terminal = True
            raise
        except Exception as exc:  # noqa: BLE001 - a lost stream must settle the run
            logger.exception("research run %s: event stream failed", run_id)
            self._store.update_run(
                run_id, status="failed",
                error=f"event stream failed: {exc}", output="".join(output),
                ended_at=_now_iso(),
            )
            self._emit(run_id, "run.failed", {"error": str(exc)})
            terminal = True
        finally:
            if not terminal:
                # The stream closed without a terminal event. Ask upstream what
                # happened rather than guessing — the run may well have finished.
                await self._reconcile(run_id, hermes_run_id, "".join(output))
            self._close_subscribers(run_id)
            self._live.pop(run_id, None)

    def _settle(self, run_id: str, event: dict, streamed: str) -> None:
        """Terminal event carrying output: parse the packet or fail loudly.

        `invalid` is a distinct status from `failed` on purpose. The agent
        finished and produced something, and what it produced broke the
        contract — that is the most informative failure there is, and
        collapsing it into "failed" would hide it.
        """
        output = str(event.get("output") or "") or streamed
        # §11 asks what a stage-1 run costs. It is only answerable if the number
        # is kept, so keep it on the run rather than only in the event log.
        self._store.update_run(
            run_id, output=output, usage=event.get("usage") or {},
            ended_at=_now_iso(),
        )
        try:
            parsed = packet_mod.parse(output)
        except packet_mod.PacketError as exc:
            self._store.update_run(run_id, status="invalid", error=str(exc))
            self._emit(run_id, "packet.invalid", {"error": str(exc)})
            return
        self._store.update_run(run_id, status="completed", packet=parsed, error="")
        self._count_judgement_applications(run_id, parsed)
        self._emit(run_id, "packet.ready", {
            "sources": len(parsed.sources),
            "excerpts": len(parsed.excerpts),
            "gaps": len(parsed.gaps),
        })

    def _count_judgement_applications(self, run_id: str, parsed) -> None:
        """"Applied 4 times" must be a count of real rejections, not a claim."""
        run = self._store.get_run(run_id)
        if not run:
            return
        by_id = {j.id: j for j in self._store.list_judgements()}
        for judgement_id in run.judgement_ids:
            judgement = by_id.get(judgement_id)
            if not judgement or not judgement.rejects_kinds:
                continue
            hits = sum(
                1 for s in parsed.sources
                if not s.admitted and s.kind in judgement.rejects_kinds
            )
            if hits:
                self._store.bump_judgement(judgement_id, hits)

    async def _reconcile(self, run_id: str, hermes_run_id: str, streamed: str) -> None:
        """The stream ended with no terminal event — go and ask."""
        try:
            status = await self._client.status(hermes_run_id)
        except Exception as exc:  # noqa: BLE001
            self._store.update_run(
                run_id, status="failed", output=streamed,
                error=f"stream ended and status could not be read: {exc}",
                ended_at=_now_iso(),
            )
            self._emit(run_id, "run.failed", {"error": str(exc)})
            return
        upstream = str(status.get("status") or "")
        if upstream == "completed":
            self._settle(run_id, status, streamed)
        elif upstream in ("failed", "cancelled"):
            self._store.update_run(
                run_id, status=upstream, output=streamed,
                error=str(status.get("error") or ""), ended_at=_now_iso(),
            )
        else:
            self._store.update_run(
                run_id, status="failed", output=streamed,
                error=f"event stream ended while upstream run was {upstream!r}",
                ended_at=_now_iso(),
            )
        settled = self._store.get_run(run_id)
        self._emit(run_id, f"run.{settled.status if settled else 'failed'}", {})

    # -- fan-out ----------------------------------------------------------

    def _emit(self, run_id: str, kind: str, payload: dict) -> None:
        """Persist first, then fan out. Order matters on a crash."""
        event = self._store.add_event(run_id, kind, payload)
        live = self._live.get(run_id)
        if not live:
            return
        frame = {
            "id": event.id, "kind": kind, "payload": payload,
            "created_at": event.created_at,
        }
        for queue in list(live.subscribers):
            try:
                queue.put_nowait(frame)
            except asyncio.QueueFull:
                # A browser that cannot keep up loses live frames, not events:
                # everything is in SQLite and it can reconnect with `after`.
                logger.debug("research run %s: subscriber queue full", run_id)

    def subscribe(self, run_id: str) -> asyncio.Queue | None:
        """A live feed, or None when the run is no longer running here."""
        live = self._live.get(run_id)
        if not live:
            return None
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        live.subscribers.add(queue)
        return queue

    def unsubscribe(self, run_id: str, queue: asyncio.Queue) -> None:
        live = self._live.get(run_id)
        if live:
            live.subscribers.discard(queue)

    def is_live(self, run_id: str) -> bool:
        return run_id in self._live

    def _close_subscribers(self, run_id: str) -> None:
        live = self._live.get(run_id)
        if not live:
            return
        for queue in list(live.subscribers):
            with contextlib.suppress(asyncio.QueueFull):
                queue.put_nowait(None)  # sentinel: no more live frames


def _effective_reject_kinds(
    request: RunRequest, judgements: list[Judgement]
) -> list[str]:
    """Defaults, overridden by the request, widened by every source rule.

    A judgement only ever adds. Removing a default rejection is an explicit
    `reject_kinds` on the request, so a standing rule can never quietly make
    the corpus wider — which is the incentive §6.2-4 of `spec.md` warns about.
    """
    from .schema import DEFAULT_REJECTED_KINDS

    kinds = list(request.reject_kinds) if request.reject_kinds else list(DEFAULT_REJECTED_KINDS)
    for judgement in judgements:
        for kind in judgement.rejects_kinds:
            if kind not in kinds:
                kinds.append(kind)
    return kinds


def _payload(name: str, event: dict) -> dict:
    """Trim an upstream event to what the cockpit renders."""
    if name == "message.delta":
        return {"delta": event.get("delta") or ""}
    if name == "tool.started":
        tool = str(event.get("tool") or "")
        return {
            "tool": tool,
            "preview": event.get("preview") or "",
            "lane": TOOL_LANES.get(tool, "other"),
        }
    if name == "tool.completed":
        return {
            "tool": event.get("tool") or "",
            "duration": event.get("duration"),
            "error": bool(event.get("error")),
            "lane": TOOL_LANES.get(str(event.get("tool") or ""), "other"),
        }
    if name == "reasoning.available":
        return {"text": event.get("text") or ""}
    if name == "run.completed":
        # Not `output`: the packet is already stored on the run, and copying it
        # into the event log doubles the size of every finished run for nothing.
        return {"usage": event.get("usage") or {}}
    return {
        k: v for k, v in event.items()
        if k not in ("event", "run_id", "output")
    }


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()

"""Research run persistence.

SQLite alongside the chat store, in the same file, for the same reason: one
user, small data, and a backup path that already knows how to copy it.

Two things this store must get right:

* **Events are persisted as they arrive.** hermes's run stream is in-memory and
  single-consumer (see `providers/hermes_runs.py`), so if this table is not
  written, a browser refresh loses the run.
* **Excerpts are write-once.** `spec.md` §6.3-F: verbatim degrades irreversibly
  the moment it is paraphrased, so the store refuses to change one rather than
  trusting callers not to.

`CREATE TABLE IF NOT EXISTS` does not alter an existing table — new columns
need a migration, and the failure shows up at INSERT rather than at startup.
`_migrate` exists for that and runs on every open.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .schema import StagePacket

SCHEMA = """
CREATE TABLE IF NOT EXISTS research_runs (
    id             TEXT PRIMARY KEY,
    hermes_run_id  TEXT NOT NULL DEFAULT '',
    session_id     TEXT NOT NULL DEFAULT '',
    stage          INTEGER NOT NULL DEFAULT 1,
    status         TEXT NOT NULL,
    model          TEXT NOT NULL DEFAULT '',
    brief          TEXT NOT NULL DEFAULT '{}',
    reject_kinds   TEXT NOT NULL DEFAULT '[]',
    judgement_ids  TEXT NOT NULL DEFAULT '[]',
    packet         TEXT NOT NULL DEFAULT '',
    error          TEXT NOT NULL DEFAULT '',
    output         TEXT NOT NULL DEFAULT '',
    usage          TEXT NOT NULL DEFAULT '{}',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    ended_at       TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS research_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id     TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    payload    TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_events_run
    ON research_events(run_id, id);
CREATE TABLE IF NOT EXISTS research_judgements (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,
    text          TEXT NOT NULL,
    rejects_kinds TEXT NOT NULL DEFAULT '[]',
    active        INTEGER NOT NULL DEFAULT 1,
    applied_count INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);
"""

# A run is one of these. `invalid` is deliberately distinct from `failed`: the
# agent finished and produced something, and what it produced broke the
# contract. Collapsing the two would hide the most informative failure there is.
RUN_STATUSES = (
    "queued", "running", "stopping", "completed", "invalid", "failed", "cancelled"
)
TERMINAL_STATUSES = frozenset({"completed", "invalid", "failed", "cancelled"})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


@dataclass(frozen=True)
class ResearchRun:
    id: str
    hermes_run_id: str
    session_id: str
    stage: int
    status: str
    model: str
    brief: dict
    reject_kinds: list[str]
    judgement_ids: list[str]
    packet: dict | None
    error: str
    output: str
    usage: dict
    created_at: str
    updated_at: str
    ended_at: str

    def summary(self) -> dict:
        """The list view's row: enough to choose a run, not the whole packet."""
        packet = self.packet or {}
        sources = packet.get("sources") or []
        return {
            "id": self.id,
            "status": self.status,
            "stage": self.stage,
            "model": self.model,
            "brief": self.brief,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "ended_at": self.ended_at,
            "usage": self.usage,
            "counts": {
                "sources": sum(1 for s in sources if s.get("admitted", True)),
                "rejected": sum(1 for s in sources if not s.get("admitted", True)),
                "excerpts": len(packet.get("excerpts") or []),
                "measurements": len(packet.get("measurements") or []),
                "attributes": len(packet.get("attributes") or []),
                "gaps": len(packet.get("gaps") or []),
            },
        }


@dataclass(frozen=True)
class RunEvent:
    id: int
    run_id: str
    kind: str
    payload: dict
    created_at: str


@dataclass(frozen=True)
class Judgement:
    id: str
    kind: str
    text: str
    rejects_kinds: list[str] = field(default_factory=list)
    active: bool = True
    applied_count: int = 0
    created_at: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


class ResearchStore(ABC):
    """Persistence contract. One implementation today; the seam is the point."""

    @abstractmethod
    def create_run(
        self, *, brief: dict, model: str, reject_kinds: list[str],
        judgement_ids: list[str],
    ) -> ResearchRun: ...

    @abstractmethod
    def get_run(self, run_id: str) -> ResearchRun | None: ...

    @abstractmethod
    def list_runs(self, limit: int = 50) -> list[ResearchRun]: ...

    @abstractmethod
    def update_run(self, run_id: str, **fields) -> None: ...

    @abstractmethod
    def add_event(self, run_id: str, kind: str, payload: dict) -> RunEvent: ...

    @abstractmethod
    def list_events(self, run_id: str, after_id: int = 0) -> list[RunEvent]: ...

    @abstractmethod
    def list_judgements(self, active_only: bool = False) -> list[Judgement]: ...

    @abstractmethod
    def add_judgement(
        self, *, kind: str, text: str, rejects_kinds: list[str]
    ) -> Judgement: ...

    @abstractmethod
    def delete_judgement(self, judgement_id: str) -> None: ...

    @abstractmethod
    def bump_judgement(self, judgement_id: str, by: int = 1) -> None: ...


class SqliteResearchStore(ResearchStore):
    def __init__(self, path: str) -> None:
        self._path = path
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False: FastAPI runs sync handlers on a threadpool.
        # Writes are short and serialised by SQLite's own lock.
        self._conn = sqlite3.connect(path, check_same_thread=False, timeout=15.0)
        self._conn.row_factory = sqlite3.Row
        # Same file as the chat store, so two connections write to it. WAL lets
        # them, and busy_timeout turns a lost race into a short wait instead of
        # an immediate "database is locked". Set here as well as in the chat
        # store rather than depending on which one opens first.
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=15000")
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(SCHEMA)
        self._migrate()
        self._conn.commit()

    def _migrate(self) -> None:
        """Add columns a previous version of this schema did not have.

        `CREATE TABLE IF NOT EXISTS` above is a no-op against an existing table,
        so anything added later has to arrive here or the first INSERT fails.
        """
        have = {r["name"] for r in self._conn.execute("PRAGMA table_info(research_runs)")}
        for column, ddl in (
            ("output", "ALTER TABLE research_runs ADD COLUMN output TEXT NOT NULL DEFAULT ''"),
            ("judgement_ids", "ALTER TABLE research_runs ADD COLUMN judgement_ids TEXT NOT NULL DEFAULT '[]'"),
            ("usage", "ALTER TABLE research_runs ADD COLUMN usage TEXT NOT NULL DEFAULT '{}'"),
        ):
            if column not in have:
                self._conn.execute(ddl)

    # -- runs -------------------------------------------------------------

    def create_run(
        self, *, brief: dict, model: str, reject_kinds: list[str],
        judgement_ids: list[str],
    ) -> ResearchRun:
        now = _now()
        run_id = _new_id()
        self._conn.execute(
            "INSERT INTO research_runs (id, status, model, brief, reject_kinds,"
            " judgement_ids, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (run_id, "queued", model, json.dumps(brief), json.dumps(reject_kinds),
             json.dumps(judgement_ids), now, now),
        )
        self._conn.commit()
        run = self.get_run(run_id)
        assert run is not None
        return run

    def get_run(self, run_id: str) -> ResearchRun | None:
        row = self._conn.execute(
            "SELECT * FROM research_runs WHERE id = ?", (run_id,)
        ).fetchone()
        return _run_from_row(row) if row else None

    def list_runs(self, limit: int = 50) -> list[ResearchRun]:
        rows = self._conn.execute(
            "SELECT * FROM research_runs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [_run_from_row(r) for r in rows]

    _JSON_FIELDS = {"brief", "reject_kinds", "judgement_ids", "packet", "usage"}
    _RUN_FIELDS = {
        "hermes_run_id", "session_id", "stage", "status", "model", "brief",
        "reject_kinds", "judgement_ids", "packet", "error", "output", "usage",
        "ended_at",
    }

    def update_run(self, run_id: str, **fields) -> None:
        unknown = set(fields) - self._RUN_FIELDS
        if unknown:
            raise ValueError(f"not run columns: {sorted(unknown)}")
        if not fields:
            return
        values: list = []
        for key, value in fields.items():
            if key in self._JSON_FIELDS and not isinstance(value, str):
                value = json.dumps(_jsonable(value))
            values.append(value)
        assignments = ", ".join(f"{k} = ?" for k in fields)
        self._conn.execute(
            f"UPDATE research_runs SET {assignments}, updated_at = ? WHERE id = ?",
            (*values, _now(), run_id),
        )
        self._conn.commit()

    # -- events -----------------------------------------------------------

    def add_event(self, run_id: str, kind: str, payload: dict) -> RunEvent:
        now = _now()
        cursor = self._conn.execute(
            "INSERT INTO research_events (run_id, kind, payload, created_at)"
            " VALUES (?,?,?,?)",
            (run_id, kind, json.dumps(payload, default=str), now),
        )
        self._conn.commit()
        return RunEvent(
            id=int(cursor.lastrowid), run_id=run_id, kind=kind,
            payload=payload, created_at=now,
        )

    def list_events(self, run_id: str, after_id: int = 0) -> list[RunEvent]:
        rows = self._conn.execute(
            "SELECT * FROM research_events WHERE run_id = ? AND id > ? ORDER BY id",
            (run_id, after_id),
        ).fetchall()
        return [
            RunEvent(
                id=r["id"], run_id=r["run_id"], kind=r["kind"],
                payload=_loads(r["payload"], {}), created_at=r["created_at"],
            )
            for r in rows
        ]

    # -- judgements -------------------------------------------------------

    def list_judgements(self, active_only: bool = False) -> list[Judgement]:
        sql = "SELECT * FROM research_judgements"
        if active_only:
            sql += " WHERE active = 1"
        sql += " ORDER BY created_at"
        return [
            Judgement(
                id=r["id"], kind=r["kind"], text=r["text"],
                rejects_kinds=_loads(r["rejects_kinds"], []),
                active=bool(r["active"]), applied_count=r["applied_count"],
                created_at=r["created_at"],
            )
            for r in self._conn.execute(sql)
        ]

    def add_judgement(
        self, *, kind: str, text: str, rejects_kinds: list[str]
    ) -> Judgement:
        judgement = Judgement(
            id=_new_id(), kind=kind, text=text, rejects_kinds=list(rejects_kinds),
            active=True, applied_count=0, created_at=_now(),
        )
        self._conn.execute(
            "INSERT INTO research_judgements (id, kind, text, rejects_kinds, active,"
            " applied_count, created_at) VALUES (?,?,?,?,?,?,?)",
            (judgement.id, judgement.kind, judgement.text,
             json.dumps(judgement.rejects_kinds), 1, 0, judgement.created_at),
        )
        self._conn.commit()
        return judgement

    def delete_judgement(self, judgement_id: str) -> None:
        self._conn.execute(
            "DELETE FROM research_judgements WHERE id = ?", (judgement_id,)
        )
        self._conn.commit()

    def bump_judgement(self, judgement_id: str, by: int = 1) -> None:
        """`applied N times` has to be a count of real events, not a claim."""
        self._conn.execute(
            "UPDATE research_judgements SET applied_count = applied_count + ?"
            " WHERE id = ?",
            (by, judgement_id),
        )
        self._conn.commit()


def _run_from_row(row: sqlite3.Row) -> ResearchRun:
    return ResearchRun(
        id=row["id"],
        hermes_run_id=row["hermes_run_id"],
        session_id=row["session_id"],
        stage=row["stage"],
        status=row["status"],
        model=row["model"],
        brief=_loads(row["brief"], {}),
        reject_kinds=_loads(row["reject_kinds"], []),
        judgement_ids=_loads(row["judgement_ids"], []),
        packet=_loads(row["packet"], None) if row["packet"] else None,
        error=row["error"],
        output=row["output"],
        usage=_loads(row["usage"], {}),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        ended_at=row["ended_at"],
    )


def _loads(raw: str, default):
    try:
        return json.loads(raw) if raw else default
    except json.JSONDecodeError:
        return default


def _jsonable(value):
    return value.model_dump() if isinstance(value, StagePacket) else value

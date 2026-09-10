"""Stage-1 research: the run contract, the store, and the run lifecycle.

The tests that matter most here are the *rejection* ones. Stage 1's whole value
is that it gathers without concluding, and that property lives in a validator —
so a validator that quietly accepts a conclusion is the bug this file exists to
catch.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from mra import packet as packet_mod
from mra import prompt as prompt_mod
from mra.runner import RunSupervisor, TOOL_LANES, _effective_reject_kinds, _payload
from mra.schema import Brief, RunRequest
from mra.store import Judgement, SqliteResearchStore
from mra.hermes_runs import HermesRunsClient
from mra.settings import Settings


# --- fixtures ---------------------------------------------------------------

def minimal_packet(**overrides) -> dict:
    """A packet that validates. Tests mutate one thing and assert the failure."""
    data = {
        "contract_version": "1",
        "stage": 1,
        "brief": {"product": "MagnaCalm 400mg", "url": "https://x", "market": "UK"},
        "sources": [{
            "id": "sha256:aaa", "url": "https://reddit.com/r/insomnia/1",
            "kind": "forum", "publisher": "reddit.com",
            "fetched_at": "2026-09-10T09:00:00Z", "admitted": True,
            "admission_reason": "forum — default policy", "archived": True,
            "node": "review_mining",
        }],
        "excerpts": [{
            "id": "sha256:bbb", "source_id": "sha256:aaa",
            "text": "I wake up at 3am and can't get back to sleep.",
            "captured_at": "2026-09-10T09:00:01Z", "node": "review_mining",
            "star_rating": 3, "axis": "why_quit", "themes": ["3am waking"],
        }],
        "saturation": [{
            "node": "review_mining",
            "curve": [{"source_id": "sha256:aaa", "new_themes": 1, "cumulative_themes": 1}],
            "stopped_because": "three consecutive sources added no new theme",
        }],
        "nodes": [{
            "node": "review_mining", "status": "complete",
            "done_criterion_met": True, "why": "saturated",
        }],
        "gaps": [{
            "node": "competitors", "missing": "CalmWell UK ad library empty",
            "would_need": "a UK-IP pull", "blocking": False,
        }],
    }
    data.update(overrides)
    return data


def fenced(data: dict, prose: str = "Here is the packet.") -> str:
    return f"{prose}\n\n```json\n{json.dumps(data)}\n```\n"


@pytest.fixture
def store(tmp_path):
    return SqliteResearchStore(str(tmp_path / "research.db"))


# --- extraction -------------------------------------------------------------

def test_extract_from_fenced_block():
    assert packet_mod.extract(fenced(minimal_packet()))["stage"] == 1


def test_extract_takes_the_last_packet():
    """An agent that shows its working writes the example first."""
    first = minimal_packet()
    first["brief"]["product"] = "an example"
    second = minimal_packet()
    output = fenced(first, "For illustration:") + fenced(second, "And the real one:")
    assert packet_mod.extract(output)["brief"]["product"] == "MagnaCalm 400mg"


def test_extract_accepts_bare_json():
    assert packet_mod.extract(json.dumps(minimal_packet()))["stage"] == 1


def test_extract_ignores_unrelated_fences():
    output = "```python\nprint('hi')\n```\n\n" + fenced(minimal_packet())
    assert packet_mod.extract(output)["stage"] == 1


def test_extract_without_any_json_is_an_error():
    with pytest.raises(packet_mod.PacketError, match="no fenced JSON"):
        packet_mod.extract("I did the research and here is what I think.")


def test_extract_empty_output_is_an_error():
    with pytest.raises(packet_mod.PacketError, match="no output"):
        packet_mod.extract("   ")


# --- validation: the rule that stage 1 does not conclude --------------------

def test_a_conclusion_has_nowhere_to_live():
    """The point of the whole schema. An invented field is a hard failure."""
    data = minimal_packet()
    data["findings"] = ["Buyers are motivated by 3am waking"]
    with pytest.raises(packet_mod.PacketError) as exc:
        packet_mod.validate(data)
    assert "not in the stage-1 contract" in str(exc.value)


def test_a_conclusion_smuggled_onto_an_excerpt_is_rejected():
    data = minimal_packet()
    data["excerpts"][0]["interpretation"] = "sleep maintenance issues"
    with pytest.raises(packet_mod.PacketError, match="not in the stage-1 contract"):
        packet_mod.validate(data)


def test_a_theme_may_not_carry_a_description():
    """§5: a theme with prose attached is a conclusion wearing a hat."""
    data = minimal_packet()
    data["excerpts"][0]["themes"] = [{"label": "3am waking", "meaning": "…"}]
    with pytest.raises(packet_mod.PacketError):
        packet_mod.validate(data)


# --- validation: the cross-object rules -------------------------------------

def test_empty_gap_list_fails_the_run():
    """spec.md §4.3 — a run reporting no holes stopped looking."""
    with pytest.raises(packet_mod.PacketError, match="gap list is empty"):
        packet_mod.validate(minimal_packet(gaps=[]))


def test_excerpt_citing_an_absent_source_is_rejected():
    data = minimal_packet()
    data["excerpts"][0]["source_id"] = "sha256:nope"
    with pytest.raises(packet_mod.PacketError, match="not in the packet"):
        packet_mod.validate(data)


def test_saturation_curve_citing_an_absent_source_is_rejected():
    data = minimal_packet()
    data["saturation"][0]["curve"][0]["source_id"] = "sha256:ghost"
    with pytest.raises(packet_mod.PacketError, match="not in the packet"):
        packet_mod.validate(data)


def test_review_mining_complete_without_three_star_coverage_is_rejected():
    data = minimal_packet()
    data["excerpts"][0]["star_rating"] = 5
    with pytest.raises(packet_mod.PacketError, match="no 3-star excerpt"):
        packet_mod.validate(data)


def test_complete_node_needs_a_saturation_curve():
    with pytest.raises(packet_mod.PacketError, match="saturation curve"):
        packet_mod.validate(minimal_packet(saturation=[]))


def test_product_data_is_a_checklist_not_a_search():
    """The one node whose done-criterion is finite, so no curve is required."""
    data = minimal_packet()
    data["nodes"] = [{
        "node": "product_data", "status": "complete",
        "done_criterion_met": True, "why": "10 of 10 attributes, COA gapped",
    }]
    data["saturation"] = []
    packet_mod.validate(data)  # must not raise


def test_undated_ad_needs_a_gap_recording_it():
    """Longevity is the only outside performance signal there is."""
    data = minimal_packet()
    data["sources"].append({
        "id": "sha256:ccc", "url": "https://facebook.com/ads/library?id=1",
        "kind": "ad_library", "fetched_at": "2026-09-10T09:00:00Z",
        "first_seen": None, "admitted": True, "archived": True,
        "node": "competitors",
    })
    data["gaps"] = [{"node": "review_mining", "missing": "thin forum coverage"}]
    with pytest.raises(packet_mod.PacketError, match="first_seen"):
        packet_mod.validate(data)


def test_undated_ad_is_fine_when_gapped():
    data = minimal_packet()
    data["sources"].append({
        "id": "sha256:ccc", "url": "https://facebook.com/ads/library?id=1",
        "kind": "ad_library", "fetched_at": "2026-09-10T09:00:00Z",
        "first_seen": None, "admitted": True, "archived": True,
        "node": "competitors",
    })
    packet_mod.validate(data)  # the default gap is on `competitors`


def test_rejected_sources_stay_in_the_packet():
    """They are the evidence of what was searched, and the UI renders them."""
    data = minimal_packet()
    data["sources"].append({
        "id": "sha256:ddd", "url": "https://top10supplementpicks.net/best",
        "kind": "seo_listicle", "admitted": False,
        "admission_reason": "seo_listicle — rejected by admission policy",
        "archived": False, "node": "competitors",
    })
    parsed = packet_mod.validate(data)
    assert [s.admitted for s in parsed.sources] == [True, False]


def test_valid_packet_round_trips():
    parsed = packet_mod.parse(fenced(minimal_packet()))
    assert parsed.excerpts[0].text.startswith("I wake up at 3am")
    assert parsed.excerpts[0].star_rating == 3


# --- admission policy -------------------------------------------------------

def test_judgements_only_ever_widen_the_rejection_set():
    """A standing rule must never quietly make the corpus wider (spec.md §6.2-4)."""
    request = RunRequest(brief=Brief(product="x"))
    judgement = Judgement(
        id="j1", kind="source_rule", text="no competitor marketing",
        rejects_kinds=["competitor_marketing"],
    )
    kinds = _effective_reject_kinds(request, [judgement])
    assert set(kinds) >= {"seo_listicle", "review_roundup", "ai_generated"}
    assert "competitor_marketing" in kinds


def test_explicit_reject_kinds_replace_the_defaults():
    request = RunRequest(brief=Brief(product="x"), reject_kinds=["ai_generated"])
    assert _effective_reject_kinds(request, []) == ["ai_generated"]


# --- prompt -----------------------------------------------------------------

def test_instructions_name_the_run_and_the_corpus_path():
    text = prompt_mod.build_instructions(
        brief=Brief(product="MagnaCalm", url="https://x", market="UK"),
        run_id="abc123", reject_kinds=["seo_listicle"], judgements=[],
        corpus_path="/corpus",
    )
    assert "/corpus/runs/abc123/sources/" in text
    assert "seo_listicle" in text
    assert "MagnaCalm" in text
    # The example packet has to be there or the model invents a shape.
    assert '"contract_version"' in text


def test_instructions_carry_standing_judgements():
    judgement = Judgement(id="j1", kind="weighting", text="Weight 3-star reviews")
    text = prompt_mod.build_instructions(
        brief=Brief(product="x"), run_id="r", reject_kinds=[],
        judgements=[judgement], corpus_path="/corpus",
    )
    assert "Weight 3-star reviews" in text
    assert "Standing judgements" in text


def test_a_brief_without_a_url_sends_the_agent_searching():
    """The brief is a product and a market; finding URLs is the agent's job.
    Without an explicit instruction a careful agent stalls asking for one."""
    text = prompt_mod.build_instructions(
        brief=Brief(product="MagnaCalm", market="UK"),
        run_id="r", reject_kinds=[], judgements=[], corpus_path="/corpus",
    )
    assert "No product URL was supplied" in text
    assert "web search" in text


def test_a_brief_with_a_url_skips_the_search_instruction():
    text = prompt_mod.build_instructions(
        brief=Brief(product="MagnaCalm", url="https://x"),
        run_id="r", reject_kinds=[], judgements=[], corpus_path="/corpus",
    )
    assert "https://x" in text
    assert "No product URL was supplied" not in text


def test_the_example_in_the_prompt_is_itself_valid():
    """A prompt that demonstrates an invalid packet teaches the wrong shape."""
    packet_mod.validate(prompt_mod._EXAMPLE)


def test_instructions_define_empty_posted_at():
    """The first mullein run failed validation on excerpts with posted_at: null
    — the model had no instruction for dateless sources and guessed. It must
    be told the field is a string and the empty form is ""."""
    text = prompt_mod.build_instructions(
        brief=Brief(product="x"), run_id="r", reject_kinds=[],
        judgements=[], corpus_path="/corpus",
    )
    assert 'or "" when it does not' in text
    assert "Never `null`" in text


def test_instructions_prevent_a_fifth_gap_node():
    """Same run: a run-level problem (corpus volume unwritable) got
    node: "all", which no legal Node matches. The prompt must name the
    catch-all and forbid inventing new nodes, or the next infrastructure
    failure reinvents this rejection."""
    text = prompt_mod.build_instructions(
        brief=Brief(product="x"), run_id="r", reject_kinds=[],
        judgements=[], corpus_path="/corpus",
    )
    assert 'use\n`node: "category_data"`' in text or '`node: "category_data"`' in text
    assert "fifth node" in text


# --- store ------------------------------------------------------------------

def test_run_lifecycle(store):
    run = store.create_run(brief={"product": "x"}, model="m", reject_kinds=[], judgement_ids=[])
    assert run.status == "queued"
    store.update_run(run.id, status="running", hermes_run_id="run_1")
    reloaded = store.get_run(run.id)
    assert (reloaded.status, reloaded.hermes_run_id) == ("running", "run_1")


def test_update_run_rejects_unknown_columns(store):
    run = store.create_run(brief={}, model="", reject_kinds=[], judgement_ids=[])
    with pytest.raises(ValueError, match="not run columns"):
        store.update_run(run.id, conclusion="the market is growing")


def test_packet_is_stored_as_json(store):
    run = store.create_run(brief={}, model="", reject_kinds=[], judgement_ids=[])
    store.update_run(run.id, packet=packet_mod.validate(minimal_packet()))
    stored = store.get_run(run.id)
    assert stored.packet["excerpts"][0]["star_rating"] == 3
    assert stored.summary()["counts"]["gaps"] == 1


def test_summary_counts_admitted_and_rejected_separately(store):
    data = minimal_packet()
    data["sources"].append({
        "id": "sha256:ddd", "url": "https://x", "kind": "seo_listicle",
        "admitted": False, "archived": False, "node": "competitors",
    })
    run = store.create_run(brief={}, model="", reject_kinds=[], judgement_ids=[])
    store.update_run(run.id, packet=packet_mod.validate(data))
    counts = store.get_run(run.id).summary()["counts"]
    assert (counts["sources"], counts["rejected"]) == (1, 1)


def test_events_are_replayable_in_order(store):
    run = store.create_run(brief={}, model="", reject_kinds=[], judgement_ids=[])
    first = store.add_event(run.id, "tool.started", {"tool": "web_extract"})
    store.add_event(run.id, "tool.completed", {"tool": "web_extract"})
    assert [e.kind for e in store.list_events(run.id)] == [
        "tool.started", "tool.completed",
    ]
    assert [e.kind for e in store.list_events(run.id, after_id=first.id)] == [
        "tool.completed",
    ]


def test_judgement_applied_count_is_a_count(store):
    judgement = store.add_judgement(
        kind="source_rule", text="no listicles", rejects_kinds=["seo_listicle"]
    )
    store.bump_judgement(judgement.id, 3)
    assert store.list_judgements()[0].applied_count == 3


def test_migration_adds_columns_to_an_existing_database(tmp_path):
    """CREATE TABLE IF NOT EXISTS does not alter an existing table."""
    import sqlite3

    path = tmp_path / "old.db"
    sqlite3.connect(path).executescript(
        "CREATE TABLE research_runs (id TEXT PRIMARY KEY, hermes_run_id TEXT NOT NULL"
        " DEFAULT '', session_id TEXT NOT NULL DEFAULT '', stage INTEGER NOT NULL"
        " DEFAULT 1, status TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', brief TEXT"
        " NOT NULL DEFAULT '{}', reject_kinds TEXT NOT NULL DEFAULT '[]', packet TEXT"
        " NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT"
        " NULL, updated_at TEXT NOT NULL, ended_at TEXT NOT NULL DEFAULT '');"
    )
    store = SqliteResearchStore(str(path))
    run = store.create_run(brief={}, model="", reject_kinds=[], judgement_ids=["j1"])
    assert store.get_run(run.id).judgement_ids == ["j1"]


# --- event translation ------------------------------------------------------

def test_tool_events_map_to_lanes():
    started = _payload("tool.started", {
        "event": "tool.started", "run_id": "r", "tool": "web_extract",
        "preview": "https://reddit.com/…",
    })
    assert started == {
        "tool": "web_extract", "preview": "https://reddit.com/…", "lane": "fetch",
    }
    assert TOOL_LANES["terminal"] == "corpus"
    assert _payload("tool.started", {"tool": "unheard_of"})["lane"] == "other"


def test_message_delta_payload_is_just_the_text():
    assert _payload("message.delta", {"delta": "hi", "run_id": "r"}) == {"delta": "hi"}


# --- the run lifecycle, against a fake harness ------------------------------

class FakeRunsClient(HermesRunsClient):
    """Stands in for hermes. Same surface, scripted events."""

    def __init__(self, events, *, status=None):
        self._events = events
        self._status = status or {"status": "completed"}
        self.started: list[dict] = []
        self.steered: list[str] = []
        self.stopped: list[str] = []

    async def start(self, *, instructions, model, session_id):
        self.started.append(
            {"instructions": instructions, "model": model, "session_id": session_id}
        )
        return "run_fake"

    async def events(self, run_id):
        for event in self._events:
            yield event

    async def status(self, run_id):
        return self._status

    async def steer(self, run_id, text):
        self.steered.append(text)

    async def stop(self, run_id):
        self.stopped.append(run_id)

    async def aclose(self):
        return None


def _supervisor(store, events, **kwargs):
    settings = Settings(_env_file=None, jwt_secret="x" * 32, corpus_path="/corpus")
    return RunSupervisor(
        store=store, client=FakeRunsClient(events, **kwargs), settings=settings
    )


async def _drain(supervisor, run_id):
    live = supervisor._live.get(run_id)
    if live:
        await live.task


def test_completed_run_stores_a_validated_packet(store):
    events = [
        {"event": "tool.started", "run_id": "run_fake", "tool": "web_extract",
         "preview": "https://reddit.com/…"},
        {"event": "run.completed", "run_id": "run_fake",
         "output": fenced(minimal_packet())},
    ]
    supervisor = _supervisor(store, events)

    async def go():
        run_id = await supervisor.start(RunRequest(brief=Brief(product="MagnaCalm")))
        await _drain(supervisor, run_id)
        return run_id

    run_id = asyncio.run(go())
    run = store.get_run(run_id)
    assert run.status == "completed"
    assert run.packet["excerpts"][0]["star_rating"] == 3
    kinds = [e.kind for e in store.list_events(run_id)]
    assert "tool.started" in kinds and "packet.ready" in kinds


def test_a_run_that_concludes_is_invalid_not_completed(store):
    """`invalid` is the most informative failure there is; do not hide it."""
    bad = minimal_packet()
    bad["findings"] = ["the 3am waker is the primary avatar"]
    supervisor = _supervisor(store, [
        {"event": "run.completed", "run_id": "run_fake", "output": fenced(bad)},
    ])

    async def go():
        run_id = await supervisor.start(RunRequest(brief=Brief(product="x")))
        await _drain(supervisor, run_id)
        return run_id

    run = store.get_run(asyncio.run(go()))
    assert run.status == "invalid"
    assert "not in the stage-1 contract" in run.error
    # The output is kept: an invalid packet is the thing you need to read.
    assert "findings" in run.output


def test_prose_only_run_is_invalid(store):
    supervisor = _supervisor(store, [
        {"event": "run.completed", "run_id": "run_fake",
         "output": "I researched the product. Customers care about sleep."},
    ])

    async def go():
        run_id = await supervisor.start(RunRequest(brief=Brief(product="x")))
        await _drain(supervisor, run_id)
        return run_id

    run = store.get_run(asyncio.run(go()))
    assert run.status == "invalid"
    assert "fenced JSON" in run.error


def test_stream_ending_without_a_terminal_event_is_reconciled(store):
    """The stream can drop; the run is still upstream, so go and ask."""
    supervisor = _supervisor(
        store,
        [{"event": "message.delta", "run_id": "run_fake", "delta": "working…"}],
        status={"status": "completed", "output": fenced(minimal_packet())},
    )

    async def go():
        run_id = await supervisor.start(RunRequest(brief=Brief(product="x")))
        await _drain(supervisor, run_id)
        return run_id

    assert store.get_run(asyncio.run(go())).status == "completed"


def test_run_failure_is_recorded_with_its_error(store):
    supervisor = _supervisor(store, [
        {"event": "run.failed", "run_id": "run_fake", "error": "provider auth failed"},
    ])

    async def go():
        run_id = await supervisor.start(RunRequest(brief=Brief(product="x")))
        await _drain(supervisor, run_id)
        return run_id

    run = store.get_run(asyncio.run(go()))
    assert (run.status, run.error) == ("failed", "provider auth failed")


def test_judgement_applications_are_counted_from_the_packet(store):
    judgement = store.add_judgement(
        kind="source_rule", text="Reject SEO listicles", rejects_kinds=["seo_listicle"]
    )
    data = minimal_packet()
    for i in range(2):
        data["sources"].append({
            "id": f"sha256:x{i}", "url": f"https://listicle{i}.net", "kind": "seo_listicle",
            "admitted": False, "admission_reason": "rejected by judgement",
            "archived": False, "node": "competitors",
        })
    supervisor = _supervisor(store, [
        {"event": "run.completed", "run_id": "run_fake", "output": fenced(data)},
    ])

    async def go():
        run_id = await supervisor.start(RunRequest(brief=Brief(product="x")))
        await _drain(supervisor, run_id)

    asyncio.run(go())
    assert store.list_judgements()[0].applied_count == 2
    assert judgement.id  # the rule was the one that ran


def test_active_judgements_reach_the_instructions(store):
    store.add_judgement(
        kind="source_rule", text="Reject SEO listicles", rejects_kinds=["seo_listicle"]
    )
    supervisor = _supervisor(store, [
        {"event": "run.completed", "run_id": "run_fake",
         "output": fenced(minimal_packet())},
    ])

    async def go():
        run_id = await supervisor.start(RunRequest(brief=Brief(product="x")))
        await _drain(supervisor, run_id)
        return run_id

    run_id = asyncio.run(go())
    sent = supervisor._client.started[0]
    assert "Reject SEO listicles" in sent["instructions"]
    assert sent["session_id"] == f"research-{run_id}"


# --- SSE parsing ------------------------------------------------------------

def test_runs_sse_parsing():
    parse = HermesRunsClient._parse_sse_line
    assert parse('data: {"event":"tool.started","tool":"web_search"}') == {
        "event": "tool.started", "tool": "web_search",
    }
    assert parse(": keepalive") is None
    assert parse("") is None
    assert parse("data: [DONE]") is None
    assert parse("data: {broken") is None
    assert parse("data: [1,2]") is None  # a list is not an event


# --- HTTP surface -----------------------------------------------------------

def _client(tmp_path, monkeypatch, events=None):
    """The real app, with the harness faked out underneath the supervisor."""
    from fastapi.testclient import TestClient

    from mra import app as app_mod
    from mra.app import create_app

    monkeypatch.setattr(
        app_mod, "HermesRunsClient",
        lambda **kwargs: FakeRunsClient(events or []),
    )
    settings = Settings(
        _env_file=None, jwt_secret="x" * 32, app_password_hash="",
        database_path=str(tmp_path / "app.db"), static_dir=str(tmp_path / "static"),
        corpus_path=str(tmp_path / "corpus"),
    )
    return TestClient(create_app(settings)), settings


def test_run_can_be_started_and_read_back(tmp_path, monkeypatch):
    events = [{"event": "run.completed", "run_id": "run_fake",
               "output": fenced(minimal_packet())}]
    client, _ = _client(tmp_path, monkeypatch, events)
    created = client.post(
        "/api/research/runs", json={"brief": {"product": "MagnaCalm"}}
    ).json()
    detail = client.get(f"/api/research/runs/{created['id']}").json()
    assert detail["brief"]["product"] == "MagnaCalm"
    assert client.get("/api/research/runs").json()["data"][0]["id"] == created["id"]


def test_a_run_without_a_product_is_refused(tmp_path, monkeypatch):
    client, _ = _client(tmp_path, monkeypatch)
    assert client.post("/api/research/runs", json={"brief": {"product": "  "}}).status_code == 400


def test_events_endpoint_replays_the_whole_run(tmp_path, monkeypatch):
    """A browser refresh must get the run, not the tail of it."""
    events = [
        {"event": "tool.started", "run_id": "run_fake", "tool": "web_search",
         "preview": "magnesium glycinate reviews"},
        {"event": "run.completed", "run_id": "run_fake",
         "output": fenced(minimal_packet())},
    ]
    client, _ = _client(tmp_path, monkeypatch, events)
    run_id = client.post(
        "/api/research/runs", json={"brief": {"product": "x"}}
    ).json()["id"]
    with client.stream("GET", f"/api/research/runs/{run_id}/events") as response:
        body = "".join(chunk for chunk in response.iter_text())
    assert "tool.started" in body and "packet.ready" in body
    assert '"reason": "not live"' in body


def test_corpus_route_rejects_anything_that_is_not_a_hash(tmp_path, monkeypatch):
    """Source ids come from an agent whose input is the open web."""
    client, _ = _client(tmp_path, monkeypatch)
    run_id = client.post(
        "/api/research/runs", json={"brief": {"product": "x"}}
    ).json()["id"]
    for bad in ("..%2f..%2fetc%2fpasswd", "not-a-hash", "../../../etc/passwd"):
        assert client.get(
            f"/api/research/runs/{run_id}/sources/{bad}"
        ).status_code in (400, 404)


def test_archived_body_is_served_as_text_with_its_digest(tmp_path, monkeypatch):
    import hashlib

    client, settings = _client(tmp_path, monkeypatch)
    run_id = client.post(
        "/api/research/runs", json={"brief": {"product": "x"}}
    ).json()["id"]
    body = b"<html>I wake up at 3am</html>"
    sha = hashlib.sha256(body).hexdigest()
    root = tmp_path / "corpus" / "runs" / run_id / "sources"
    root.mkdir(parents=True)
    (root / sha).write_bytes(body)

    response = client.get(f"/api/research/runs/{run_id}/sources/{sha}")
    assert response.status_code == 200
    # Never text/html: a scraped page served from our own origin is a script.
    assert response.headers["content-type"].startswith("text/plain")
    assert response.headers["x-corpus-digest-matches"] == "true"
    assert "3am" in response.text


def test_a_tampered_corpus_file_says_so(tmp_path, monkeypatch):
    import hashlib

    client, _ = _client(tmp_path, monkeypatch)
    run_id = client.post(
        "/api/research/runs", json={"brief": {"product": "x"}}
    ).json()["id"]
    sha = hashlib.sha256(b"original").hexdigest()
    root = tmp_path / "corpus" / "runs" / run_id / "sources"
    root.mkdir(parents=True)
    (root / sha).write_bytes(b"something else entirely")
    response = client.get(f"/api/research/runs/{run_id}/sources/{sha}")
    assert response.headers["x-corpus-digest-matches"] == "false"


def test_config_reports_whether_the_corpus_is_mounted(tmp_path, monkeypatch):
    client, _ = _client(tmp_path, monkeypatch)
    assert client.get("/api/research/config").json()["corpus_mounted"] is False
    (tmp_path / "corpus").mkdir()
    assert client.get("/api/research/config").json()["corpus_mounted"] is True


# --- surviving a restart ----------------------------------------------------

def test_recover_settles_a_run_the_process_stopped_watching(store):
    """A redeploy mid-run must not leave a row saying `running` forever."""
    run = store.create_run(brief={"product": "x"}, model="", reject_kinds=[], judgement_ids=[])
    store.update_run(run.id, status="running", hermes_run_id="run_fake")
    supervisor = _supervisor(
        store, [], status={"status": "completed", "output": fenced(minimal_packet())}
    )
    asyncio.run(supervisor.recover())
    assert store.get_run(run.id).status == "completed"


def test_recover_leaves_finished_runs_alone(store):
    run = store.create_run(brief={}, model="", reject_kinds=[], judgement_ids=[])
    store.update_run(run.id, status="cancelled", hermes_run_id="run_fake", error="stopped")
    supervisor = _supervisor(store, [], status={"status": "completed"})
    asyncio.run(supervisor.recover())
    assert store.get_run(run.id).status == "cancelled"


def test_recover_reports_a_run_that_died_upstream(store):
    run = store.create_run(brief={}, model="", reject_kinds=[], judgement_ids=[])
    store.update_run(run.id, status="running", hermes_run_id="run_fake")
    supervisor = _supervisor(store, [], status={"status": "running"})
    asyncio.run(supervisor.recover())
    settled = store.get_run(run.id)
    assert settled.status == "failed" and "ended while upstream" in settled.error


def test_shutdown_does_not_strand_a_live_run(store):
    """aclose() cancels the watcher; the cancellation path must clean up."""
    started = asyncio.Event()

    class Hanging(FakeRunsClient):
        async def events(self, run_id):
            started.set()
            await asyncio.sleep(3600)
            yield {}  # pragma: no cover

    settings = Settings(_env_file=None, jwt_secret="x" * 32)
    supervisor = RunSupervisor(store=store, client=Hanging([]), settings=settings)

    async def go():
        run_id = await supervisor.start(RunRequest(brief=Brief(product="x")))
        await started.wait()
        assert supervisor.is_live(run_id)
        await supervisor.aclose()
        return run_id

    run_id = asyncio.run(go())
    assert not supervisor.is_live(run_id)
    # Still `running` on purpose: the run really is alive upstream, and
    # recover() is what settles it on the next start.
    assert store.get_run(run_id).status == "running"


def test_every_source_kind_reaches_the_prompt():
    """The first live run failed because the enum was never shown to the agent.

    It invented `product_page`, `marketplace_page`, `industry_report` and four
    more — all reasonable, none in the enum, whole packet rejected. A note per
    kind is not decoration: it is what tells the model which one a product page
    actually is.
    """
    from mra.schema import SOURCE_KIND_NOTES, SourceKind
    import typing

    enum = set(typing.get_args(SourceKind))
    assert {kind for kind, _ in SOURCE_KIND_NOTES} == enum

    text = prompt_mod.build_instructions(
        brief=Brief(product="x"), run_id="r", reject_kinds=[], judgements=[],
        corpus_path="/corpus",
    )
    for kind in enum:
        assert f"`{kind}`" in text, kind


def test_default_hermes_url_points_at_this_stacks_harness():
    """Not agentchat's gateway. The two harnesses share an image, nothing else.

    A default pointing at :8642 on the docker bridge would silently work on the
    VPS and give the researcher the chat agent's memory and skills — the exact
    coupling this service exists to avoid.
    """
    settings = Settings(_env_file=None, jwt_secret="x" * 32)
    assert settings.hermes_base_url == "http://hermes:8642/v1"
    assert settings.hermes_session_key == "research"

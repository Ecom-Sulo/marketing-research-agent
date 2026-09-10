"""hermes runs API adapter.

A new adapter, not an extension of `HermesProvider`: different endpoint,
different lifecycle, different failure modes. `/v1/chat/completions` is one
request that streams one answer; `/v1/runs` admits a job, hands back an id, and
lets you subscribe, steer and stop it. One adapter per boundary.

Two properties of the upstream stream shape everything above this layer, and
both were read out of `gateway/platforms/api_server_runs.py` rather than
assumed:

* **The event queue is in-memory and single-consumer.** `_run_streams[run_id]`
  is an `asyncio.Queue`; every subscriber calls `get()` on the same queue, so a
  second reader *splits* the stream instead of duplicating it, and a reader
  that arrives late has missed what came before. Exactly one task in this
  process may consume a run, and it must persist what it sees.
* **The run outlives the subscription.** Closing the SSE response does not stop
  the agent. That is the whole reason a research run survives a closed browser.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import httpx

logger = logging.getLogger(__name__)


class HermesRunsError(RuntimeError):
    """Upstream refused or failed a runs-API call."""


class HermesRunsClient:
    """Start, watch, steer and stop hermes runs."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        memory_key: str,
        timeout: float = 600.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._memory_key = memory_key
        # Runs are long. The read timeout has to cover the gap between events,
        # and hermes sends a `: keepalive` comment every 30s so a stalled
        # stream is still distinguishable from a slow one.
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout, connect=15.0, read=None),
            follow_redirects=False,
        )

    def _headers(self, session_id: str | None = None) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        if session_id:
            # The transcript. Rotates per run.
            headers["X-Hermes-Session-Id"] = session_id
        if self._memory_key:
            # Long-term memory. Constant — see settings.hermes_session_key.
            headers["X-Hermes-Session-Key"] = self._memory_key
        return headers

    async def aclose(self) -> None:
        await self._client.aclose()

    # -- lifecycle --------------------------------------------------------

    async def start(
        self,
        *,
        instructions: str,
        model: str,
        session_id: str,
    ) -> str:
        """Admit a run and return its hermes run id.

        `instructions` is the user turn. hermes reads `input`; a bare string is
        the documented shape and avoids the history-resolution path entirely.
        """
        payload: dict = {"input": instructions, "session_id": session_id}
        if model:
            payload["model"] = model
        response = await self._client.post(
            f"{self._base_url}/runs", json=payload, headers=self._headers(session_id)
        )
        if response.status_code >= 400:
            raise HermesRunsError(_error_text(response))
        body = response.json()
        run_id = body.get("run_id")
        if not run_id:
            raise HermesRunsError(f"runs API returned no run_id: {body!r}")
        return str(run_id)

    async def events(self, run_id: str) -> AsyncIterator[dict]:
        """Yield decoded run events until the stream closes.

        Call this exactly once per run — see the module docstring.
        """
        url = f"{self._base_url}/runs/{run_id}/events"
        async with self._client.stream("GET", url, headers=self._headers()) as response:
            if response.status_code >= 400:
                raise HermesRunsError(await _error_text_async(response))
            async for line in response.aiter_lines():
                event = self._parse_sse_line(line)
                if event is not None:
                    yield event

    @staticmethod
    def _parse_sse_line(line: str) -> dict | None:
        """One `data:` frame into a dict; anything else is None.

        hermes writes bare `data:` frames with no `event:` line — the event
        name lives inside the JSON under `event`.
        """
        line = line.strip()
        if not line.startswith("data:"):
            return None  # `: keepalive`, blank separators, `event:` lines
        raw = line[5:].strip()
        if not raw or raw == "[DONE]":
            return None
        try:
            decoded = json.loads(raw)
        except json.JSONDecodeError:
            logger.debug("runs SSE: undecodable frame %r", raw[:200])
            return None
        return decoded if isinstance(decoded, dict) else None

    async def status(self, run_id: str) -> dict:
        response = await self._client.get(
            f"{self._base_url}/runs/{run_id}", headers=self._headers()
        )
        if response.status_code >= 400:
            raise HermesRunsError(_error_text(response))
        return response.json()

    async def steer(self, run_id: str, text: str) -> None:
        response = await self._client.post(
            f"{self._base_url}/runs/{run_id}/steer",
            json={"input": text},
            headers=self._headers(),
        )
        if response.status_code >= 400:
            raise HermesRunsError(_error_text(response))

    async def stop(self, run_id: str) -> None:
        response = await self._client.post(
            f"{self._base_url}/runs/{run_id}/stop", json={}, headers=self._headers()
        )
        # A run that already finished is not a failure to stop it.
        if response.status_code >= 400 and response.status_code != 409:
            raise HermesRunsError(_error_text(response))


def _error_text(response: httpx.Response) -> str:
    try:
        body = response.json()
    except Exception:  # noqa: BLE001 - error paths must not raise
        return f"hermes runs API: HTTP {response.status_code}"
    detail = body.get("error", body) if isinstance(body, dict) else body
    if isinstance(detail, dict):
        detail = detail.get("message") or detail
    return f"hermes runs API: HTTP {response.status_code}: {detail}"


async def _error_text_async(response: httpx.Response) -> str:
    await response.aread()
    return _error_text(response)

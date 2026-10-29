# backend/aipds/token_usage.py — cumulative token usage per project (the admin usage screen).
#
# **What is metered.** Every model call a project makes, from four sources:
#   discovery — the Discovery agent (agent/claude_driver.py)
#   prototype — prototype build sessions (proto/builder.py)
#   survey    — survey question generation (app.questionnaire_agent_factory)
#   handoff   — the handoff package writer (app.handoff_writer_factory)
# The DESIGN.md token extractor is not here: it runs for the global brand profile, outside
# any project.
#
# **Per API request, not per turn.** The CLI's `ResultMessage.usage` is the turn total, which
# hides how large each request's prompt was — and a price tier can depend on that
# (pricing.py, long context). `AssistantMessage.usage` is one API response's usage, so that
# is what is metered. Subagent messages are included: the context meter skips them because
# they run in their own window, but their tokens are billed all the same.
#
# **Each response arrives several times.** The CLI emits one AssistantMessage per content
# block (thinking, text, each tool call), all carrying the same `message_id` and the same
# usage (observed in a CLI transcript, 2026-10-29: three messages, identical usage). So a
# response is keyed by `message_id`, and only the growth over what was already counted is
# added — the first sighting counts the request, a later larger value (if a CLI ever
# reports usage incrementally) adds the difference.
#
# **Stored as token counts, priced at read time.** `usage/tokens.json` holds counts per
# source × model × tier; cost is computed by `summarize` from pricing.py. A price change then
# needs only a table edit, and past usage follows it.
#
# **Writes.** Counted tokens are held in memory and written when a turn ends (the
# ResultMessage). The write is a read-modify-write of one object, serialized per project by
# an in-process lock — the backend is a single uvicorn process (infra/lib/user-data.ts), and
# a project's Discovery turn, build session and one-shot calls can finish at the same time.
# A failed write keeps the counts in memory for the next one. Usage is display-only, so no
# failure here reaches a turn.
#
# The file is not carried by project export/import (project_bundle.py): it records what was
# spent on *this* deployment.
from __future__ import annotations

import asyncio
import json
import logging
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any

from aipds import pricing
from aipds.s3store import S3StoreLike

_log = logging.getLogger(__name__)

#: Project-relative key. Deleting the project deletes it along with everything else.
USAGE_KEY = "usage/tokens.json"

SOURCES = ("discovery", "prototype", "survey", "handoff")

#: How many recent responses to remember for de-duplication. Blocks of one response arrive
#: back to back, so this only needs to outlast one response — the margin is for subagents
#: interleaving their messages with the main agent's.
_SEEN_LIMIT = 1024

_locks: dict[str, asyncio.Lock] = {}


def _lock(project_id: str) -> asyncio.Lock:
    lock = _locks.get(project_id)
    if lock is None:
        lock = _locks[project_id] = asyncio.Lock()
    return lock


def _empty() -> dict[str, int]:
    return {"requests": 0, **{f: 0 for f in pricing.TOKEN_FIELDS}}


def _sdk_counts(usage: dict) -> dict[str, int]:
    """Anthropic `usage` (as the CLI reports it) → our token kinds."""
    def n(value: Any) -> int:
        try:
            return max(0, int(value or 0))
        except (TypeError, ValueError):
            return 0

    creation = usage.get("cache_creation")
    if isinstance(creation, dict):
        write_5m = n(creation.get("ephemeral_5m_input_tokens"))
        write_1h = n(creation.get("ephemeral_1h_input_tokens"))
    else:
        # Older shape with only the total: the CLI's default TTL is 5 minutes.
        write_5m, write_1h = n(usage.get("cache_creation_input_tokens")), 0
    return {
        "input": n(usage.get("input_tokens")),
        "output": n(usage.get("output_tokens")),
        "cache_write_5m": write_5m,
        "cache_write_1h": write_1h,
        "cache_read": n(usage.get("cache_read_input_tokens")),
    }


def _prompt_tokens(counts: dict[str, int]) -> int:
    return (counts["input"] + counts["cache_write_5m"] + counts["cache_write_1h"]
            + counts["cache_read"])


class UsageRecorder:
    """Meters one source of one project. One instance per driver/builder (or per one-shot caller).

    `model_id` is the model id the project is configured with. It decides global vs regional
    pricing — the CLI reports only the bare model name, which carries no endpoint.
    """

    def __init__(self, s3: S3StoreLike, project_id: str, source: str,
                 model_id: str | None = None) -> None:
        self._s3 = s3
        self._project_id = project_id
        self._source = source
        self._regional = pricing.is_regional(model_id)
        self._fallback_model = pricing.base_model(model_id) if model_id else "unknown"
        #: (model key, tier) → counts not yet written.
        self._pending: dict[tuple[str, str], dict[str, int]] = {}
        #: message_id → (model key, tier, counts already counted).
        self._seen: OrderedDict[str, tuple[str, str, dict[str, int]]] = OrderedDict()
        self._tasks: set[asyncio.Task] = set()

    def _key(self, model: str | None) -> str:
        name = pricing.base_model(model) if model else self._fallback_model
        return name + pricing.REGIONAL_SUFFIX if self._regional else name

    def _add(self, key: str, tier: str, delta: dict[str, int], new_request: bool) -> None:
        bucket = self._pending.setdefault((key, tier), _empty())
        if new_request:
            bucket["requests"] += 1
        for f, v in delta.items():
            bucket[f] += v

    def observe(self, msg: Any) -> None:
        """Takes every SDK message as is. Synchronous — callers run it inside translation loops."""
        tname = type(msg).__name__
        if tname == "ResultMessage":
            self.flush_soon()
            return
        if tname != "AssistantMessage":
            return
        usage = getattr(msg, "usage", None)
        if not isinstance(usage, dict):
            return
        counts = _sdk_counts(usage)
        mid = getattr(msg, "message_id", None) or getattr(msg, "uuid", None)
        if not mid:
            # No id to de-duplicate by — count it as a request of its own.
            key = self._key(getattr(msg, "model", None))
            tier = pricing.tier_of(key, _prompt_tokens(counts))
            self._add(key, tier, counts, True)
            return
        prior = self._seen.get(mid)
        if prior is None:
            key = self._key(getattr(msg, "model", None))
            tier = pricing.tier_of(key, _prompt_tokens(counts))
            self._add(key, tier, counts, True)
            self._seen[mid] = (key, tier, counts)
            while len(self._seen) > _SEEN_LIMIT:
                self._seen.popitem(last=False)
            return
        key, tier, counted = prior
        delta = {f: max(0, counts[f] - counted[f]) for f in counts}
        if any(delta.values()):
            self._add(key, tier, delta, False)
            self._seen[mid] = (key, tier, {f: max(counts[f], counted[f]) for f in counts})

    def add_converse(self, usage: dict | None) -> None:
        """One Bedrock Converse call's usage (Strands `accumulated_usage`). Used by one-shot calls."""
        if not isinstance(usage, dict):
            return
        counts = {
            "input": int(usage.get("inputTokens") or 0),
            "output": int(usage.get("outputTokens") or 0),
            # Converse reports one write total, and Strands sets no TTL — Bedrock's default is 5 minutes.
            "cache_write_5m": int(usage.get("cacheWriteInputTokens") or 0),
            "cache_write_1h": 0,
            "cache_read": int(usage.get("cacheReadInputTokens") or 0),
        }
        key = self._key(None)
        self._add(key, pricing.tier_of(key, _prompt_tokens(counts)), counts, True)

    def flush_soon(self) -> None:
        """Schedules a write without waiting for it (called from synchronous translation)."""
        if not self._pending:
            return
        try:
            task = asyncio.get_running_loop().create_task(self.flush())
        except RuntimeError:
            return  # no loop (a synchronous test) — the next flush picks the counts up
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def wait(self) -> None:
        """Waits for scheduled writes. For shutdown paths and tests."""
        while self._tasks:
            tasks = list(self._tasks)
            await asyncio.gather(*tasks, return_exceptions=True)
            # Removed here, not left to the done callbacks: awaiting tasks that are already
            # done never yields to the loop, so the callbacks would never get to run and
            # this loop would spin forever.
            self._tasks.difference_update(tasks)

    async def flush(self) -> None:
        if not self._pending:
            return
        pending, self._pending = self._pending, {}
        try:
            async with _lock(self._project_id):
                data = await _load_raw(self._s3)
                sources = data.setdefault("sources", {})
                models = sources.setdefault(self._source, {})
                for (key, tier), counts in pending.items():
                    bucket = models.setdefault(key, {}).setdefault(tier, _empty())
                    for f, v in counts.items():
                        bucket[f] = int(bucket.get(f, 0)) + v
                data["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                await self._s3.put(USAGE_KEY, json.dumps(data, ensure_ascii=False))
        except Exception:
            _log.exception("token usage write failed: project=%s source=%s",
                           self._project_id, self._source)
            # Keep the counts for the next write rather than losing them.
            for k, counts in pending.items():
                bucket = self._pending.setdefault(k, _empty())
                for f, v in counts.items():
                    bucket[f] += v


async def _load_raw(s3: S3StoreLike) -> dict:
    try:
        data = json.loads(await s3.get(USAGE_KEY))
    except FileNotFoundError:
        return {"version": 1, "sources": {}}
    if not isinstance(data, dict) or not isinstance(data.get("sources"), dict):
        # A corrupt file would otherwise block every later write. Starting over loses the
        # history, but the log says so, and the alternative is losing everything after it.
        _log.error("unreadable token usage record; starting over: %s", USAGE_KEY)
        return {"version": 1, "sources": {}}
    return data


async def load_usage(s3: S3StoreLike) -> dict | None:
    """The stored record. None if there is none or it is unreadable."""
    try:
        data = json.loads(await s3.get(USAGE_KEY))
    except FileNotFoundError:
        return None
    except Exception:
        _log.warning("unreadable token usage record: %s", USAGE_KEY, exc_info=True)
        return None
    return data if isinstance(data, dict) and isinstance(data.get("sources"), dict) else None


def _bucket_view() -> dict:
    return {"requests": 0, "long_context_requests": 0,
            "tokens": {f: 0 for f in pricing.TOKEN_FIELDS}, "cost_usd": 0.0}


def _accumulate(view: dict, tier: str, counts: dict, cost: float | None) -> None:
    requests = int(counts.get("requests", 0))
    view["requests"] += requests
    if tier == "long":
        view["long_context_requests"] += requests
    for f in pricing.TOKEN_FIELDS:
        view["tokens"][f] += int(counts.get(f, 0))
    if cost is not None:
        view["cost_usd"] += cost


def _cache_hit_rate(tokens: dict) -> float | None:
    prompt = (tokens["input"] + tokens["cache_write_5m"] + tokens["cache_write_1h"]
              + tokens["cache_read"])
    return tokens["cache_read"] / prompt if prompt else None


def summarize(data: dict | None, prices: pricing.PriceTable = pricing.PRICES) -> dict:
    """The stored record → the admin screen's view: totals and per source, with cost.

    No per-model view: a project runs on the model it was created with (it cannot be changed
    afterwards), so a model breakdown would only repeat the total. Counts stay keyed by model
    in the record all the same — pricing needs the model.
    """
    total = _bucket_view()
    by_source: dict[str, dict] = {}
    unpriced: set[str] = set()
    for source, models in ((data or {}).get("sources") or {}).items():
        if not isinstance(models, dict):
            continue
        for model_key, tiers in models.items():
            if not isinstance(tiers, dict):
                continue
            for tier, counts in tiers.items():
                if not isinstance(counts, dict):
                    continue
                cost = pricing.cost_usd(model_key, tier, counts, prices)
                if cost is None:
                    unpriced.add(model_key)
                for view in (total, by_source.setdefault(source, _bucket_view())):
                    _accumulate(view, tier, counts, cost)
    for view in (total, *by_source.values()):
        view["cost_usd"] = round(view["cost_usd"], 6)
        view["cache_hit_rate"] = _cache_hit_rate(view["tokens"])
    return {
        **total,
        "by_source": by_source,
        # Models with no price in the table: their tokens are counted but not in cost_usd.
        "unpriced_models": sorted(unpriced),
        "updated_at": (data or {}).get("updated_at"),
    }


# backend/aipds/proto/reset_evidence.py — keep what Discovery cites before a reset destroys it.
#
# **Why this exists.** A reset (routes/prototypes.reset_prototype) wipes a prototype back to its
# spec: the survey tree and its responses, the change history next to the spec, the survey files
# under aiplc-docs/, and every source generation. The next build starts again at gen 1.
#
# That is right for the *build* — a history of a build that no longer exists would mislead the next
# builder (session.purge_session_state). It is wrong for the *evidence*. Observed (a workshop run):
# a prototype was reset and rebuilt after Discovery had been approved. `validation-results.md` and the
# approved `spec-as-built.md` still cited survey responses and history entries gen 1-3, but the
# survey, the history and the validated source were gone; the handoff package then shipped code that
# was not the code users had seen, and nothing could show what had been validated.
#
# So, before anything is deleted, the evidence is copied under `prototype-resets/{slug}/{stamp}/`.
# It sits outside `prototypes/{slug}/` (which the reset deletes) and outside `aiplc-docs/` (which the
# Discovery workspace restores — the agent and its rules never see it). Project export picks it up
# like any other project key; project deletion removes it with the project prefix.
#
# **No live credential is copied.** A questionnaire carries the survey token. The copy drops it, and
# is renamed (`definition.json`), and the survey subtree is renamed (`survey-records/`): project
# import re-registers any `/survey/questionnaire.json` it finds as a live survey link, and a snapshot
# must never come back as one.
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from aipds.proto import layout
from aipds.survey.store import aggregate_md_key, questionnaire_md_key, survey_prefix

_log = logging.getLogger(__name__)

#: Root of the snapshots, relative to the project prefix.
RESETS_PREFIX = "prototype-resets/"

#: Renamed survey subtree and questionnaire file in a snapshot (see the module header).
_SURVEY_DIR = "survey-records/"
_DEFINITION = "definition.json"


def snapshot_prefix(slug: str, stamp: str) -> str:
    return f"{RESETS_PREFIX}{slug}/{stamp}/"


def _stamp(now: datetime | None = None) -> str:
    # Colon-free so the key is usable as a path segment on every OS an export is unpacked on.
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H-%M-%SZ")


def _without_token(body: bytes) -> bytes | None:
    """A questionnaire with its token removed, or None if it cannot be read. An unreadable body is
    left out rather than copied raw (a raw copy would carry the token this exists to remove) and
    rather than failing the snapshot (one damaged definition would then block every reset)."""
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    data.pop("token", None)
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


async def _current_source_prefix(s3, slug: str) -> str | None:
    """`prototypes/{slug}/source/{gen}/` of the current generation, or None if there is none."""
    key = f"prototypes/{slug}/source/current.json"
    try:
        data = json.loads(await s3.get(key))
    except FileNotFoundError:
        return None
    gen = data.get("gen") if isinstance(data, dict) else None
    if not isinstance(gen, int):
        return None
    return f"prototypes/{slug}/source/{gen:06d}/"


def _plan(slug: str, survey_keys: list[str], doc_keys: list[str],
          source_keys: list[str], source_prefix: str | None) -> list[tuple[str, str]]:
    """(source key, snapshot-relative path) for everything worth keeping."""
    out: list[tuple[str, str]] = []
    sp = survey_prefix(slug)
    for key in survey_keys:
        if key.endswith("/"):
            continue
        rel = key[len(sp):]
        if rel.endswith("questionnaire.json"):
            rel = rel[: -len("questionnaire.json")] + _DEFINITION
        out.append((key, _SURVEY_DIR + rel))
    for key in doc_keys:
        out.append((key, key.rsplit("/", 1)[-1]))
    if source_prefix:
        for key in source_keys:
            if not key.endswith("/"):
                out.append((key, "source/" + key[len(source_prefix):]))
    return out


async def snapshot_before_reset(s3, slug: str, *, now: datetime | None = None) -> str | None:
    """Copy this prototype's evidence aside. Returns the snapshot prefix, or None if there was
    nothing to keep (a prototype never surveyed and never changed after approval).

    Raises on any failure, so the caller can refuse the reset: deleting evidence that could not be
    kept is exactly the loss this module prevents.
    """
    survey_keys = await s3.list(survey_prefix(slug))
    doc_keys = [k for k in (layout.change_history_key(slug), questionnaire_md_key(slug),
                            aggregate_md_key(slug))
                if k in set(await s3.list(k))]
    source_prefix = await _current_source_prefix(s3, slug)
    source_keys = await s3.list(source_prefix) if source_prefix else []

    plan = _plan(slug, survey_keys, doc_keys, source_keys, source_prefix)
    # Source alone is not evidence anything cited: a prototype that was built but never surveyed or
    # changed after approval has nothing Discovery points at, and copying its tree on every reset
    # would only pile up storage.
    if not any(not rel.startswith("source/") for _, rel in plan):
        return None

    dest = snapshot_prefix(slug, _stamp(now))
    for key, rel in plan:
        body = await s3.get_bytes(key)
        if rel.endswith(_DEFINITION):
            body = _without_token(body)
            if body is None:
                _log.warning("reset snapshot: unreadable questionnaire %s left out", key)
                continue
        await s3.put_bytes(dest + rel, body)
    _log.info("reset snapshot for %s: %d object(s) at %s", slug, len(plan), dest)
    return dest

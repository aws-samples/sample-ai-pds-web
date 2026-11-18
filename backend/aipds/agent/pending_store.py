# backend/aipds/agent/pending_store.py — S3 persistence for pending questions.
#
# Why it is needed: Strands persisted the pending interrupt along with the session
# (so reading agent._interrupt_state was enough), but the Claude Agent SDK's session
# store is a transcript mirror, so a pending question is an in-memory Future.
# GET /pending -- restoring the question form after a refresh -- relies on that, so
# it is stored separately.
#
# A project has only one pending question, so the key is fixed (S3Store adds the
# project prefix).
from __future__ import annotations

import json
import logging

from aipds.s3store import S3StoreLike

_log = logging.getLogger("aipds.agent")

PENDING_KEY = "pending/questions.json"


def _is_valid(data: dict) -> bool:
    """Field presence alone is not enough -- if a type is wrong (e.g. sdk_questions is a
    string), it blows up later in Task 6's answer back-translation path. The internal
    structure of questions/sdk_questions is not validated (that is the parser's/builder's
    job); this only guards the top-level types whose breakage would immediately break
    answer back-translation and session lookup."""
    interrupt_id = data.get("interrupt_id")
    session_id = data.get("session_id")
    return (
        isinstance(interrupt_id, str) and interrupt_id != "" and
        isinstance(data.get("questions"), dict) and
        isinstance(data.get("sdk_questions"), list) and
        isinstance(session_id, str) and session_id != ""
    )


async def save_pending(s3: S3StoreLike, *, interrupt_id: str, questions: dict,
                       sdk_questions: list[dict], session_id: str) -> None:
    """Stores sdk_questions (the SDK's original form) too -- needed to back-translate
    answers into SDK labels, and after a restart there is no in-memory copy."""
    await s3.put(PENDING_KEY, json.dumps({
        "interrupt_id": interrupt_id,
        "questions": questions,
        "sdk_questions": sdk_questions,
        "session_id": session_id,
    }, ensure_ascii=False))


async def load_pending(s3: S3StoreLike) -> dict | None:
    """None if missing or corrupted. Does not raise a 500 -- pending is a restore
    convenience, and without it the user can start the turn again. A half-restore is worse."""
    try:
        raw = await s3.get(PENDING_KEY)
    except FileNotFoundError:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        _log.warning("pending payload is not valid JSON — ignoring")
        return None
    if not isinstance(data, dict) or not _is_valid(data):
        _log.warning("pending payload missing or malformed required fields — ignoring")
        return None
    return data


async def clear_pending(s3: S3StoreLike) -> None:
    """Idempotent -- an answer submission and an interrupt can overlap and call this twice."""
    await s3.delete_prefix(PENDING_KEY)


#: Path of the **open file** in a question-file round. It is a separate key from
#: PENDING_KEY above because what it holds is entirely different -- loosening
#: `_is_valid` would also weaken validation for the still-live AskUserQuestion path.
PENDING_FILE_KEY = "pending/question-file.json"


#: How many open question files are remembered. Rounds a user never answers stay open, so the
#: list is capped; the oldest drop off first. One observed project had 9 question files in total.
OPEN_FILES_LIMIT = 10


async def save_pending_file(s3: S3StoreLike, *, file: str,
                            still_open: list[str] | None = None) -> None:
    """Record `file` as the newest open question file, keeping the earlier open ones.

    **The question content is not stored.** Re-reading from the file every time gives
    three things:

    1. It is always current -- if the agent edits the file, the card follows.
    2. **There is no clear step.** `runner.write_file` writes to S3 directly
       (runner.py:57-59), so S3 is current the moment an answer is recorded, and with
       no unanswered items the restore naturally skips that file. There is structurally
       no path where a dead card remains because someone forgot to delete it -- this
       is what differs from the old path, where `disconnect` had to evict dead
       questions in three places.
    3. No fuzzy matching is needed. The file is the source of truth and the number is
       the key.

    Then why store paths -- **because of ambiguity.** An observed project had 3
    unanswered question files at once (the result of lost answers). A scan alone
    cannot tell which rounds are open, and showing the wrong card is worse than
    showing none.

    **Why more than one.** This used to hold a single path, so a second round replaced the
    first. Observed in a workshop run: the PM left one prototype's decision form open, asked
    for the next prototype's survey to be reflected, and that round's form took the slot --
    the first form never came back, and the decision gate it held was skipped. Now the
    earlier open files stay listed, and the restore falls back to them once the newer one
    is answered (claude_driver._pending_from_file).

    `still_open` is the caller's list of earlier files that still have unanswered questions
    (oldest first). Without it, the stored list is kept as is.
    """
    earlier = still_open if still_open is not None else await load_open_files(s3)
    files = [f for f in earlier if f != file] + [file]
    files = files[-OPEN_FILES_LIMIT:]
    await s3.put(PENDING_FILE_KEY, json.dumps({"file": file, "open": files},
                                              ensure_ascii=False))


async def load_open_files(s3: S3StoreLike) -> list[str]:
    """Open question files, oldest first. Empty if missing or corrupted.

    A record written before the list existed holds only `file`; it reads as a list of one.
    It does not raise for the same reason as `load_pending` -- restoring is a convenience,
    and without it the user can start the turn again."""
    try:
        raw = await s3.get(PENDING_FILE_KEY)
    except FileNotFoundError:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        _log.warning("pending question-file payload is not valid JSON — ignoring")
        return []
    if not isinstance(data, dict):
        _log.warning("pending question-file payload has no usable path — ignoring")
        return []
    files = data.get("open")
    if isinstance(files, list):
        kept = [f for f in files if isinstance(f, str) and f]
        if kept:
            return kept
    file = data.get("file")
    if isinstance(file, str) and file:
        return [file]
    _log.warning("pending question-file payload has no usable path — ignoring")
    return []


async def load_pending_file(s3: S3StoreLike) -> str | None:
    """Path of the newest open question file. None if missing or corrupted."""
    files = await load_open_files(s3)
    return files[-1] if files else None

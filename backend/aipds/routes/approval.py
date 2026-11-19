# backend/aipds/routes/approval.py — where the Discovery approvals stand, for the review screen.
#
# Read-only on purpose. Approvals are given in the workspace, by answering the approval question file the agent opens at
# the end of a stage; the review screen only says which ones were answered and which one is waiting. The reason the
# screen no longer has an approve button of its own is in the aipds/approval_gates.py header.
from __future__ import annotations

import asyncio

from fastapi import APIRouter

from aipds import doc_revisions
from aipds.approval_gates import gates, is_approval_file
from aipds.routes.deps import ensure_workspace

router = APIRouter()


@router.get("/projects/{pid}/approval-gates")
async def list_approval_gates(pid: str):
    """Every approval question round of the project, in workflow order, with its answers and when they were given."""
    ws = await ensure_workspace(pid)
    paths = [p for p in await ws.list_question_files() if is_approval_file(p)]
    texts, rounds = await asyncio.gather(
        asyncio.gather(*(ws.runner.read_file(p) for p in paths), return_exceptions=True),
        doc_revisions.load_rounds(ws.runner, pid))
    # A file listed but gone by the time it is read (the agent replaced it) is left out, not fatal.
    contents = {p: t for p, t in zip(paths, texts) if isinstance(t, str)}
    return {"gates": [g.model_dump() for g in gates(contents, rounds)]}

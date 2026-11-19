# backend/aipds/approval_gates.py — where each Discovery approval stands, read from the approval question files.
#
# **Why this replaces the review screen's own approval button.** The review screen used to carry a gate of its own: an
# "approve and continue" button that recorded the hash of `discovery-document.md` and sent the agent a bare "승인" turn.
# Observed (eight workshop exports): every approval was given in the workspace, by answering the approval question file
# the agent opened at the end of a stage (`envision-approval-questions.md`, `strategy-approval-questions.md`, …); the
# button was used once. The gate recognised none of those answers, and `discovery-document.md` is a living document —
# every later stage writes into it — so even the one recorded approval stopped matching the next time the agent wrote.
# The gate therefore asked for an approval the PM had already given, and pressing it dropped "승인" into a conversation
# that was not asking for one.
#
# The upstream rules own the approvals: a stage ends with an approval question, and the answer goes back to the agent
# through the question form. So this module does not decide anything. It reports, per approval question file, whether it
# still waits for an answer and what the PM answered — the option the PM chose, as written — so the review screen can
# say "Envision: answered 11/18 — A. 승인한다" or "the Product Strategy approval is waiting in the workspace".
#
# **By name.** An approval round is a question file whose name says so: observed names were `envision-approval-`,
# `envision-reapproval-`, `part2-approval-`, `prototype-validation-approval-`, `spec-as-built-approval-`,
# `strategy-approval-`, `product-strategy-approval-`, `gtm-approval-`, `discovery-approval-questions.md` and numbered
# rounds of them. Ordinary question files never carry the word, so the name is precise enough and needs no content guess.
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Literal

from pydantic import BaseModel

from aipds.answer_summary import render_answer
from aipds.doc_revisions import KIND_ANSWERS, Round
from aipds.handoff.readiness import Stage, stage_of
from aipds.parsers.questions import parse_question_file
from aipds.question_files import named_question_file, round_of

_APPROVAL = re.compile(r"approv[^/]*-questions(?:-\d+)?\.md$")
#: The question in a round that asks for the approval itself. A round often asks a few scope decisions beside it, before
#: or after (observed: first in one project, last in another), and the screen leads with the approval's answer. Matched
#: on the asking sentence only, as a verb ("…을 승인하시겠습니까?", "Do you approve …?"): observed, a scope question's
#: background spoke of the customer's own "가입 승인" and would otherwise have been taken for the approval. Both
#: languages, because the question is written in the project language.
_ASKS_APPROVAL = re.compile(r"승인하|approve", re.IGNORECASE)

_STAGE_ORDER: tuple[Stage, ...] = ("envision", "solution_analysis", "use_case_intake", "prioritization",
                                   "prototype", "product_strategy", "go_to_market", "other")


class ApprovalAnswer(BaseModel):
    number: int
    #: The question as asked.
    question: str
    #: The answer as the PM gave it, an option letter expanded to its words ("A. 승인한다 — …").
    answer: str


class ApprovalGate(BaseModel):
    path: str
    #: The gate this round belongs to — rounds of one approval (`…-questions.md`, `…-questions-2.md`) share it.
    gate: str
    stage: Stage
    #: 1 for the first round of a gate, 2 for `…-questions-2.md` and so on.
    round: int
    #: pending: at least one question has no answer yet — the agent is waiting in the workspace.
    status: Literal["pending", "answered"]
    answers: list[ApprovalAnswer]
    #: The answer to the approval question itself — what the screen shows first. Falls back to the last answer when no
    #: question reads as the approval. None while nothing is answered.
    headline: str | None = None
    #: When the answers were handed over (the revision round the answer route took). None when no round was taken —
    #: projects from before revision rounds, or a round that had no documents to keep.
    answered_at: str | None = None


def is_approval_file(path: str) -> bool:
    return named_question_file(path) and bool(_APPROVAL.search(path))


def _answered_at(rounds: list[Round]) -> dict[str, str]:
    """Question file → when its answers were last handed over. A file answered twice (answers changed) keeps the latest."""
    out: dict[str, str] = {}
    for r in rounds:
        if r.kind == KIND_ANSWERS and r.at > out.get(r.source, ""):
            out[r.source] = r.at
    return out


def gates(contents: Mapping[str, str], rounds: list[Round]) -> list[ApprovalGate]:
    """Approval question files (path → text) and the project's revision rounds → the approval gates, in workflow order."""
    when = _answered_at(rounds)
    out: list[ApprovalGate] = []
    for path, text in contents.items():
        if not is_approval_file(path):
            continue
        parsed = parse_question_file(path.rsplit("/", 1)[-1], text)
        if not parsed.questions:
            # Nothing to answer means nothing to wait for; a file the parser cannot read must not hold a banner up.
            continue
        answers = [ApprovalAnswer(number=q.number, question=q.ask or q.text,
                                  answer=render_answer(q.options, q.answer.strip()))
                   for q in parsed.questions if q.answer and q.answer.strip()]
        asks = {q.number: q.ask or q.text for q in parsed.questions}
        headline = next((a.answer for a in answers if _ASKS_APPROVAL.search(asks[a.number])),
                        answers[-1].answer if answers else None)
        out.append(ApprovalGate(
            path=path, gate=round_of(path)[0], stage=stage_of(path), round=round_of(path)[1],
            status="answered" if len(answers) == len(parsed.questions) else "pending",
            answers=answers, headline=headline, answered_at=when.get(path)))
    out.sort(key=lambda g: (_STAGE_ORDER.index(g.stage), g.gate, g.round))
    return out

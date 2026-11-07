# backend/aipds/question_files.py — what a question file is, in one place: by content where the text is at hand, by name where
# only the path is.
#
# **Why it exists.** The upstream rules do not keep their own naming: the generic guide puts `aiplc-docs/{phase}-questions.md` at
# the docs root while the stage rules use `aiplc-docs/discovery/<stage>/…`, the prototype rule puts questions in
# `design-context.md`, and a re-approval after changes gets a number from the agent (`envision-approval-questions-2.md`,
# `spec-as-built-questions-2.md`) because the answered round cannot be overwritten. Recording answers already moved to judging by
# content (agent/question_file_answers). The readers did not: the handoff read `aiplc-docs/discovery/*-questions.md` only, so
# observed (a workshop run), the Envision approval rounds at the docs root and a numbered spec round never reached the decision
# ledger, and the numbered round shipped as an original.
#
# **Name or content.** `is_question_file` takes either: the name rule (numbered rounds included), or the recorder's own content
# test — an `[Answer]:` slot at a line start, not a record-keeping file — which catches the files upstream named otherwise.
# `named_question_file` is for callers that see only a path (the doc panel's filter, the dashboard list): the same name rule
# everywhere.
from __future__ import annotations

import re

from aipds.agent.question_file_answers import looks_like_question_file

#: `{phase}-questions.md`, and the numbered rounds an agent opens for the same gate (`…-questions-2.md`).
_NAME = re.compile(r"-questions(?:-(\d+))?\.md$")


def is_question_file(rel: str, text: str) -> bool:
    """Whether a workspace document is a question round: named as one, or holding answer slots (the answer recorder's test)."""
    return named_question_file(rel) or looks_like_question_file(rel, text)


def named_question_file(rel: str) -> bool:
    """Whether a path is named as a question file. For callers without the text; the content test decides where it is at hand."""
    return bool(_NAME.search(rel))


def round_of(rel: str) -> tuple[str, int]:
    """(gate, round) of a question file: rounds of one gate share a gate — the path without the round number — and count from 1.
    `aiplc-docs/envision-approval-questions-2.md` → (`aiplc-docs/envision-approval-questions.md`, 2). A file not named by the
    rule is a gate of its own, round 1."""
    match = _NAME.search(rel)
    if match is None or match.group(1) is None:
        return rel, 1
    return rel[:match.start()] + "-questions.md", int(match.group(1))


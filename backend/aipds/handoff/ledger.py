# backend/aipds/handoff/ledger.py — decision ledger: a table carrying over, as is, the decisions the PM answered in Discovery.
#
# **Why it exists.** Discovery documents hold the results of decisions, not the questions they answer. The ledger is the
# decisions as the PM gave them: every answered question, the chosen option's words and the PM's elaboration, so development
# can trace a requirement back to the question that settled it.
#
# **Every answer is the PM's.** The question form preselects nothing and has no "take the suggestions" shortcut, so an answer
# that matches the option the AI marked is still one the PM picked. The ledger once set those apart as "AI suggestion kept"
# — about half of all answers (98 of 200 across seven projects) — and vision.md, the handoff tab and the harness instructions
# then asked the PM to confirm, again, what they had already decided. Agreeing with a suggestion is a decision.
#
# **It does not call the model.** It only moves question file answers and handoff tab records into a table. A
# rewritten document can diverge from the source (observed: internal contradictions in a rewritten PRD), and
# the same input must produce the same table so a person can check it against the source.
from __future__ import annotations

import re
from collections.abc import Mapping

from aipds.handoff import readiness as readiness_mod
from aipds.handoff import supplement as supplement_mod
from aipds.models import Question
from aipds.parsers.questions import parse_question_file

LEDGER = "decisions.md"

_STAGE_ORDER = ("envision", "solution_analysis", "use_case_intake", "prioritization",
                "prototype", "product_strategy", "go_to_market", "other")

_TEXT = {
    "ko": {
        "title": "# 결정 장부",
        "lead": ("Discovery의 질문 파일에서 PM이 답한 결정과 인계 직전에 PM이 보탠 답을 그대로 "
                 "옮겼습니다. 모두 PM이 정한 것입니다. 결정의 내용과 이유는 `discovery-document.md`에 "
                 "있고, 이 표는 각 결정이 어느 질문에서 나왔는지와 그 답을 보여 줍니다."),
        "columns": ("근거", "질문", "답"),
        "handoff": "인계 시 보완(PM)", "handoff_title": "## 인계 시 보완(PM)",
        "handoff_columns": ("질문", "답", "답한 시각"),
        "unknown": "모름 (열린 결정으로 넘김)", "checking": "확인 중",
        "stages": {"envision": "Envision", "solution_analysis": "솔루션 분석",
                   "use_case_intake": "유스케이스 접수", "prioritization": "우선순위",
                   "prototype": "프로토타입", "product_strategy": "제품 전략",
                   "go_to_market": "Go-to-Market", "other": "기타"},
        "topics": {
            "problem.evidence": "문제가 실제로 있다는 근거", "problem.why_now": "지금 풀어야 하는 이유",
            "goals.success": "성공의 기준", "non_goals.list": "만들지 않을 것",
            "constraints.rules": "지켜야 할 규정·사내 규칙·연동 시스템",
            "assumptions.must_be_true": "성공하려면 사실이어야 하는 것",
            "assumptions.failure_reasons": "실패할 가능성이 가장 큰 이유",
        },
    },
    "en": {
        "title": "# Decision ledger",
        "lead": ("Decisions the PM answered in the Discovery question files, and answers the PM "
                 "added right before handoff, copied as they are. The PM made every one of them. What "
                 "was decided and why is in `discovery-document.md`; this table shows which question each "
                 "decision answers, and the answer."),
        "columns": ("Source", "Question", "Answer"),
        "handoff": "Added at handoff (PM)", "handoff_title": "## Added at handoff (PM)",
        "handoff_columns": ("Question", "Answer", "Answered at"),
        "unknown": "Unknown (moved to open decisions)", "checking": "Being checked with",
        "stages": {"envision": "Envision", "solution_analysis": "Solution analysis",
                   "use_case_intake": "Use case intake", "prioritization": "Prioritization",
                   "prototype": "Prototype", "product_strategy": "Product strategy",
                   "go_to_market": "Go-to-Market", "other": "Other"},
        "topics": {
            "problem.evidence": "Evidence that the problem is real",
            "problem.why_now": "Why it must be solved now",
            "goals.success": "What counts as success", "non_goals.list": "What will not be built",
            "constraints.rules": "Regulations, internal rules and systems to work with",
            "assumptions.must_be_true": "What must be true to succeed",
            "assumptions.failure_reasons": "The most likely reasons it would fail",
        },
    },
}

def labels(language: str) -> dict:
    """This module's wording in the project language — the handoff section title and the topic names are reused elsewhere."""
    return _TEXT.get(language, _TEXT["ko"])


_SINGLE = re.compile(r"^([A-J])\s*(?::\s*(.*))?$", re.DOTALL)
#: A question file: `{phase}-questions.md`, and the further rounds an agent numbers on (`spec-as-built-questions-2.md`) —
#: observed (a workshop run): two numbered files went into the zip as originals, and their answers missed the ledger.
_QUESTION_FILE = re.compile(r"-questions(?:-\d+)?\.md$")


def is_question_file(path: str) -> bool:
    """Whether a workspace path is a question file — the one test the handoff uses (ledger, zip, decision list, revise)."""
    return bool(_QUESTION_FILE.search(path))


def build(contents: Mapping[str, str], record: supplement_mod.Supplement, language: str) -> str:
    """Question files (workspace path → content) and handoff tab records → `decisions.md`."""
    lab = _TEXT.get(language, _TEXT["ko"])
    by_stage: dict[str, list[tuple[str, str, str]]] = {}
    for path in sorted(p for p in contents if is_question_file(p)):
        parsed = parse_question_file(path.rsplit("/", 1)[-1], contents[path])
        cite = path.removeprefix("aiplc-docs/discovery/")
        for q in parsed.questions:
            if not (q.answer or "").strip():
                continue
            chosen = readiness_mod.chosen_letters(q)
            by_stage.setdefault(readiness_mod.stage_of(path), []).append(
                (f"{cite} Q{q.number}", q.ask or q.text, _answer(q, chosen)))

    head = "| " + " | ".join(lab["columns"]) + " |\n|" + "---|" * len(lab["columns"])
    parts = [lab["title"], lab["lead"]]
    for stage in _STAGE_ORDER:
        rows = by_stage.get(stage)
        if not rows:
            continue
        body = "\n".join("| " + " | ".join(_cell(c) for c in row) + " |" for row in rows)
        parts.append(f"## {lab['stages'][stage]}\n\n{head}\n{body}")
    handoff = _handoff_rows(record, lab)
    if handoff:
        cols = lab["handoff_columns"]
        head = "| " + " | ".join(cols) + " |\n|" + "---|" * len(cols)
        body = "\n".join("| " + " | ".join(_cell(c) for c in row) + " |" for row in handoff)
        parts.append(f"{lab['handoff_title']}\n\n{head}\n{body}")
    return "\n\n".join(parts) + "\n"


def decisions(contents: Mapping[str, str]) -> list[supplement_mod.Decision]:
    """Every answered question in the question files (workspace path → content), in file and question order. All of them —
    an answer that matches the AI's marked option is the PM's decision like any other."""
    out: list[supplement_mod.Decision] = []
    for path in sorted(p for p in contents if is_question_file(p)):
        parsed = parse_question_file(path.rsplit("/", 1)[-1], contents[path])
        for q in parsed.questions:
            answer = (q.answer or "").strip()
            if not answer:
                continue
            chosen = readiness_mod.chosen_letters(q)
            match = _SINGLE.match(answer)
            out.append(supplement_mod.Decision(
                file=path, number=q.number, ask=q.ask or q.text, answer=answer,
                stage=readiness_mod.stage_of(path),
                choices=[_option_text(o.text) for o in q.options if o.letter in chosen and not o.is_other] or [answer],
                remark=(match.group(2) or "").strip() if match and chosen else "",
                options=q.options, multi_select=q.multi_select))
    return out


def _option_text(text: str) -> str:
    return text.partition(readiness_mod.SUGGESTION_MARK)[0].strip()


def _answer(q: Question, chosen: set[str]) -> str:
    """The text of the chosen option (with the elaboration appended if any). If not an option letter, the PM's answer as written."""
    if not chosen:
        return (q.answer or "").strip()
    texts = [_option_text(o.text) for o in q.options if o.letter in chosen and not o.is_other]
    match = _SINGLE.match((q.answer or "").strip())
    remark = (match.group(2) or "").strip() if match else ""
    return " / ".join(texts) + (f" — {remark}" if remark else "")


def _handoff_rows(record: supplement_mod.Supplement, lab: dict) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for qid, a in record.answers.items():
        rows.append((lab["topics"].get(qid, qid), lab["unknown"] if a.unknown else a.text,
                     a.updated_at))
    for a in record.open_answers.values():
        if a.unknown:
            text = lab["unknown"]
        elif a.text:
            text = a.text
        else:
            text = f"{lab['checking']}: {a.pending_with}"
        rows.append((a.question, text, a.updated_at))
    return rows


def _cell(text: str) -> str:
    """One table cell — so that line breaks and vertical bars do not break the table."""
    return " ".join(text.replace("|", "\\|").split())

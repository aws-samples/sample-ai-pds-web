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

import difflib
import re
from collections.abc import Mapping

from aipds.handoff import readiness as readiness_mod
from aipds.handoff import supplement as supplement_mod
from aipds.models import Question
from aipds.parsers.questions import parse_question_file
from aipds.question_files import is_question_file, round_of

LEDGER = "decisions.md"

_STAGE_ORDER = ("envision", "solution_analysis", "use_case_intake", "prioritization",
                "prototype", "product_strategy", "go_to_market", "other")

_TEXT = {
    "ko": {
        "title": "# 결정 장부",
        "lead": ("Discovery의 질문 파일에서 PM이 답한 결정과 인계 직전에 PM이 보탠 답을 그대로 "
                 "옮겼습니다. 모두 PM이 정한 것입니다. 결정의 내용과 이유는 `discovery-document.md`에 "
                 "있고, 이 표는 각 결정이 어느 질문에서 나왔는지와 그 답을 보여 줍니다. 같은 승인을 다시 받은 회차"
                 "(`…-questions-2.md`)는 차례대로 놓았고, 뒤 회차가 다시 물은 질문의 답은 뒤 회차의 답이 대신합니다."),
        "asked_again": " — 이후 회차에서 다시 물었습니다({file})",
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
                 "decision answers, and the answer. Rounds of the same approval asked again (`…-questions-2.md`) "
                 "follow each other; where a later round asked a question again, its answer stands."),
        "asked_again": " — asked again in a later round ({file})",
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
def _question_files(contents: Mapping[str, str]) -> list[str]:
    """The question files among the contents — by content (aipds/question_files) — with the rounds of one gate together and in
    order: an agent opens `…-questions-2.md` when a gate is asked again after changes, and by name it sorts before round 1."""
    return sorted((p for p in contents if is_question_file(p, contents[p])), key=lambda p: (*round_of(p), p))


#: How alike two questions' first sentences must be to be the same question asked again. A later round rewords it ("수정을 반영한
#: … 승인하시겠습니까?"), and asks new questions besides — observed (a workshop run), round 2 of an Envision approval asked the
#: approval again and one new question, while round 1's scope decisions stood as answered.
_SAME_QUESTION = 0.8


def _first_sentence(text: str) -> str:
    flat = " ".join(text.replace("**", "").replace("`", "").split())
    return re.split(r"(?<=[?？.!])\s", flat, maxsplit=1)[0]


def _same_question(earlier: str, later: str) -> bool:
    a, b = _first_sentence(earlier), _first_sentence(later)
    return bool(a) and (a in b or difflib.SequenceMatcher(None, a, b).ratio() >= _SAME_QUESTION)


def _asked_again(contents: Mapping[str, str], paths: list[str]) -> dict[tuple[str, int], str]:
    """(question file, number) → the later round of the same gate that asked that question again. Only the questions a later
    round asks again are replaced by it: the others stand as answered, and marking them would cast doubt on a decision made."""
    rounds: dict[str, list[tuple[int, str]]] = {}
    for path in paths:
        gate, number = round_of(path)
        rounds.setdefault(gate, []).append((number, path))
    parsed = {p: parse_question_file(p.rsplit("/", 1)[-1], contents[p]).questions for p in paths}
    out: dict[tuple[str, int], str] = {}
    for files in rounds.values():
        files.sort()
        for i, (_, earlier) in enumerate(files):
            for q in parsed[earlier]:
                for _, later in reversed(files[i + 1:]):
                    if any(_same_question(q.text, r.text) for r in parsed[later]):
                        out[(earlier, q.number)] = later
                        break
    return out


def _cite(path: str) -> str:
    return path.removeprefix("aiplc-docs/discovery/")


def build(contents: Mapping[str, str], record: supplement_mod.Supplement, language: str) -> str:
    """Question files (workspace path → content) and handoff tab records → `decisions.md`."""
    lab = _TEXT.get(language, _TEXT["ko"])
    by_stage: dict[str, list[tuple[str, str, str]]] = {}
    paths = _question_files(contents)
    later = _asked_again(contents, paths)
    for path in paths:
        parsed = parse_question_file(path.rsplit("/", 1)[-1], contents[path])
        cite = _cite(path)
        for q in parsed.questions:
            if not (q.answer or "").strip():
                continue
            chosen = readiness_mod.chosen_letters(q)
            answer = _answer(q, chosen)
            if (path, q.number) in later:
                answer += lab["asked_again"].replace("{file}", _cite(later[(path, q.number)]))
            by_stage.setdefault(readiness_mod.stage_of(path), []).append(
                (f"{cite} Q{q.number}", q.ask or q.text, answer))

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
    paths = _question_files(contents)
    later = _asked_again(contents, paths)
    for path in paths:
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
                options=q.options, multi_select=q.multi_select, later_round=later.get((path, q.number), "")))
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

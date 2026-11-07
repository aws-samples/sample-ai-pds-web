# backend/tests/test_handoff_ledger.py — handoff/ledger: decision ledger
from __future__ import annotations

import re

from aipds.handoff import ledger, supplement
from test_handoff_readiness import D, QUESTIONS

_PATH = D + "product-strategy/strategy-questions.md"


def _rows(text: str) -> list[list[str]]:
    """Table line → cells. An escaped pipe (`\\|`) is not a cell boundary."""
    return [[c.strip() for c in re.split(r"(?<!\\)\|", line.strip().strip("|"))]
            for line in text.splitlines() if line.startswith("| ") and "---" not in line]


def test_every_answer_is_the_pms_whatever_the_ai_suggested():
    """The question form preselects nothing, so an answer that matches the AI's marked option is still the PM's pick. The
    ledger once called those "AI suggestion kept" — about half of all answers — and the PM was asked to confirm them again."""
    text = ledger.build({_PATH: QUESTIONS, D + "discovery-document.md": "# 문서\n"}, supplement.Supplement(), "ko")
    assert text.startswith("# 결정 장부")
    assert "## 제품 전략" in text and "모두 PM이 정한 것입니다" in text
    rows = _rows(text)
    assert rows[0] == ["근거", "질문", "답"]
    by_q = {r[0]: r for r in rows[1:]}
    # Q1 picked the option the AI marked; Q3 did not — the ledger tells them apart no more.
    assert by_q["product-strategy/strategy-questions.md Q1"][2:] == ["Subscription"]
    assert by_q["product-strategy/strategy-questions.md Q2"][2:] == ["Premium — 단, 첫 해는 할인"]
    assert by_q["product-strategy/strategy-questions.md Q3"][2:] == ["Partners"]
    assert "AI 제안" not in text and "누가 정했나" not in text
    # The AI's suggestion note (after ←) is not an answer.
    assert "제안: 페인 포인트" not in text


def test_handoff_answers_are_listed_as_they_were_given():
    q = "증빙 효력은?"
    record = supplement.Supplement(
        answers={"problem.evidence": supplement.Answer(text="현장 인터뷰 | 12명", updated_at="t1")},
        open_answers={
            supplement.open_key(q): supplement.OpenAnswer(question=q, pending_with="법무팀",
                                                          updated_at="t2"),
            supplement.open_key("링크 유효기간"): supplement.OpenAnswer(
                question="링크 유효기간", unknown=True, updated_at="t3")})
    text = ledger.build({}, record, "ko")
    rows = _rows(text.split("## 인계 시 보완(PM)", 1)[1])
    assert rows[1:] == [["문제가 실제로 있다는 근거", "현장 인터뷰 \\| 12명", "t1"],
                        ["증빙 효력은?", "확인 중: 법무팀", "t2"],
                        ["링크 유효기간", "모름 (열린 결정으로 넘김)", "t3"]]


def test_the_ledger_is_english_for_english_projects():
    text = ledger.build({_PATH: QUESTIONS}, supplement.Supplement(), "en")
    assert text.startswith("# Decision ledger") and "The PM made every one of them" in text
    assert "AI suggestion" not in text


def test_every_answered_question_is_listed_for_the_pm_to_change():
    """The tab lists every Discovery decision, not just the ones that matched an AI suggestion — any of them may need changing."""
    got = ledger.decisions({_PATH: QUESTIONS, D + "discovery-document.md": "# 문서\n"})
    assert [d.number for d in got] == [1, 2, 3, 4, 5, 7]          # Q6 is unanswered
    by = {d.number: d for d in got}
    # The decision in words, without the AI's note — the matched suggestion (Q1) and the PM's other pick (Q3) alike.
    assert by[1].choices == ["Subscription"] and by[3].choices == ["Partners"]
    assert (by[2].choices, by[2].remark, by[2].answer) == (["Premium"], "단, 첫 해는 할인", "A: 단, 첫 해는 할인")
    assert by[4].choices == ["Seoul", "Daegu"]
    # Free text is the decision as written, with no remark split off.
    assert (by[5].choices, by[5].remark) == (["Broker: 큐를 따로 둔다"], "")
    assert by[1].stage == "product_strategy" and by[1].file == _PATH
    assert [o.letter for o in by[1].options] == ["A", "B", "X"]


_ROUND1 = ("## Question 1\nPart 1(Envision)을 승인하시겠습니까?\n\nA) 승인\nB) 수정 필요\n\n[Answer]: B: 범위를 바꿔 주세요\n\n"
           "## Question 2\n대표 지표의 측정 정의를 바꿀까요?\n\nA) 바꾼다\nB) 지금 정하지 않는다\n\n[Answer]: B\n")
_ROUND2 = ("## Question 1\n수정을 반영한 Part 1(Envision)을 승인하시겠습니까?\n\nA) 승인\nB) 수정 필요\n\n[Answer]: A\n\n"
           "## Question 2\n작업 결과를 확인하는 단계도 둘까요?\n\nA) 둔다\nB) 두지 않는다\n\n[Answer]: B\n")


def test_rounds_of_one_gate_follow_each_other_and_the_earlier_one_says_it_was_asked_again():
    """Observed (a workshop run): an Envision approval asked again after changes was saved as `…-questions-2.md` at the docs
    root, as the generic question guide has it — and neither round reached the ledger. By name, round 2 also sorts first."""
    contents = {"aiplc-docs/envision-approval-questions-2.md": _ROUND2,
                "aiplc-docs/envision-approval-questions.md": _ROUND1}
    text = ledger.build(contents, supplement.Supplement(), "ko")
    rows = _rows(text)
    assert "## PR/FAQ · 문제 정의" not in text and "## Envision" in text      # stage from the name at the docs root
    assert [r[0] for r in rows[1:]] == [
        "aiplc-docs/envision-approval-questions.md Q1", "aiplc-docs/envision-approval-questions.md Q2",
        "aiplc-docs/envision-approval-questions-2.md Q1", "aiplc-docs/envision-approval-questions-2.md Q2"]
    # The approval was asked again, reworded: round 2's answer stands for it.
    assert rows[1][2] == "수정 필요 — 범위를 바꿔 주세요 — 이후 회차에서 다시 물었습니다(aiplc-docs/envision-approval-questions-2.md)"
    # Round 2 did not ask Q2 again: it stands as answered, with no mark that would cast doubt on it.
    assert rows[2][2] == "지금 정하지 않는다"
    assert rows[3][2] == "승인" and rows[4][2] == "두지 않는다"
    got = ledger.decisions(contents)
    assert [(d.file.rsplit("/", 1)[-1], d.number, d.later_round) for d in got] == [
        ("envision-approval-questions.md", 1, "aiplc-docs/envision-approval-questions-2.md"),
        ("envision-approval-questions.md", 2, ""),
        ("envision-approval-questions-2.md", 1, ""), ("envision-approval-questions-2.md", 2, "")]


def test_a_question_file_named_otherwise_is_told_by_its_answer_slots():
    contents = {D + "prototype/approval-round.md": _ROUND2, D + "discovery-document.md": "# 문서\n승인 [Answer] 없음\n"}
    assert {d.file for d in ledger.decisions(contents)} == {D + "prototype/approval-round.md"}

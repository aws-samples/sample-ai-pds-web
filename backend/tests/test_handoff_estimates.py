# backend/tests/test_handoff_estimates.py — handoff/estimates: a value the originals estimate stays marked in vision.md
from __future__ import annotations

import pytest

from aipds.handoff import estimates

D = "aiplc-docs/discovery/"


@pytest.mark.parametrize("text, value, kind", [
    ("하루 2시간을 쓴다(연 약 1,584시간 ≈ 0.75 FTE, 추정).", "1,584시간", "estimate"),
    ("되묻기는 요청당 평균 2~3회로 추정되어", "2~3회", "estimate"),
    ("월 132시간(연 0.75 FTE, 추정)", "132시간", "estimate"),
    ("연 약 1,584시간(담당자 추정)을 쓴다", "1,584시간", "estimate"),
    ("되묻기 왕복 (추정 2~3회)", "2~3회", "estimate"),
    ("(주 40시간 근무 가정)", "40시간", "assumed"),
    ("(가정: 5분 스피치 ≈ 700단어)", "700단어", "assumed"),
    ("추정치 300건으로 본다", "300건", "estimate"),
])
def test_a_value_counts_when_the_mark_sits_with_it(text, value, kind):
    assert estimates.marked_values(text).get(value) == kind


@pytest.mark.parametrize("text", [
    # "추정" names a feature here — the 90% is a target, not an estimate (observed in a validation plan).
    "| (추정 유형 수락률·수정 후 제출 완료율 90% 이상) | 목표 |",
    "유형 추정 수락률 80% · 제출 완료율 100%",
    # A single digit is too common to be the same value elsewhere (observed: "CS Lead 1명으로 가정" vs "PM 1명").
    "CS Lead 인원(1명으로 가정)",
    "월 730건이 들어온다.",
])
def test_a_marking_word_without_its_value_counts_for_nothing(text):
    assert estimates.marked_values(text) == {}


_MATERIAL = {
    D + "discovery-document.md": "## 성공 지표\n분류·배정에 연 약 1,584시간(0.75 FTE, 추정)이 든다. 요청은 월 730건이다.\n",
    D + "envision/business-context.md": "## 규모\n요청자 360명, 월 730건.\n",
}


def test_a_dropped_mark_is_restored_only_on_a_line_citing_the_file_that_made_it():
    doc = ("# P — Vision\n\n## Business Context\n"
           "- 분류·배정 연 약 1,584시간을 줄인다 [discovery-document.md · 성공 지표]\n"
           "- 분류·배정 연 약 1,584시간 [envision/business-context.md · 규모]\n"
           "- 분류·배정 연 약 1,584시간 (추정) [discovery-document.md · 성공 지표]\n"
           "- 월 730건 [discovery-document.md · 성공 지표]\n")
    out, count = estimates.restore(doc, _MATERIAL, "ko")
    lines = out.splitlines()
    assert count == 1
    assert lines[3] == "- 분류·배정 연 약 1,584시간 (추정)을 줄인다 [discovery-document.md · 성공 지표]"
    # The second line cites a file that does not estimate it; the third kept its mark; 730건 was measured.
    assert lines[4:] == doc.splitlines()[4:]


def test_a_value_closing_a_parenthesis_gets_the_mark_inside_it():
    doc = "- 투입량(약 0.75 FTE) [discovery-document.md · 성공 지표]\n"
    out, count = estimates.restore(doc, _MATERIAL, "ko")
    assert (out, count) == ("- 투입량(약 0.75 FTE, 추정) [discovery-document.md · 성공 지표]\n", 1)


def test_citations_headings_and_the_open_questions_table_are_left_alone():
    doc = ("## 1,584시간 절감\n"
           "### Open Questions\n"
           "| O-01 | 연 1,584시간을 어떻게 셀까? | PM | 빌드 전 | — | discovery-document.md · 성공 지표 |\n")
    assert estimates.restore(doc, _MATERIAL, "ko") == (doc, 0)


def test_english_projects_get_english_labels():
    material = {D + "discovery-document.md": "Triage takes about 1,584 hours (estimated) a year."}
    out, _ = estimates.restore("- Triage takes 1,584 hours [discovery-document.md · Metrics]", material, "en")
    assert out == "- Triage takes 1,584 hours (estimated) [discovery-document.md · Metrics]"

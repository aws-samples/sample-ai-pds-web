# backend/tests/test_handoff_fill.py — handoff/fill: go-to-market targets vision.md left out go back in, checked by code
from __future__ import annotations

import json

import pytest

from aipds.handoff import fill

DOCUMENT = """# Discovery

## 성공 지표
- 완료율 95%

# Part 3: Go-to-Market

## 단계별 성공 기준

| 시점 | 성공 기준 |
|---|---|
| **30일** | 요청 유입이 유지되는가 (월 약 730건 수준) |
| **60일** | 종결코드 오선택 비율이 기준선보다 낮아지는가 |

## 개발팀 핸드오프 패키지

- 원본 분석 자료 48건을 넘긴다
- 무엇을 넘길지 정리한다
"""
VISION = """# P — Vision

## Business Context
### Success Metrics
| Metric | Today | Target | How it is measured |
|---|---|---|---|
| 요청 유입 | 월 약 730건 | 유지 | 일별 집계 [discovery-document.md · 성공 지표] |
| 완료율 | — | 95% | 건별 [discovery-document.md · 성공 지표] |

## Risks and Dependencies
### Open Questions
| ID | 질문 |
|---|---|
"""


def _reply(*items):
    return json.dumps({"items": list(items)}, ensure_ascii=False)


def test_only_part_3_lines_with_numbers_count_and_only_those_not_all_carried():
    found = fill.items(DOCUMENT)
    # Part 1's 95% is not looked at; the header row and the line without a number are not items.
    assert [(i.heading, i.numbers) for i in found] == [
        ("단계별 성공 기준", ["30일", "730건"]), ("단계별 성공 기준", ["60일"]), ("개발팀 핸드오프 패키지", ["48건"])]
    # 730건 is in vision.md, 30일 is not — the row still counts as missing.
    assert [i.numbers for i in fill.missing(found, VISION)] == [["30일", "730건"], ["60일"], ["48건"]]
    assert fill.items("# 문서\n- 30일\n") == []          # no Go-to-Market part


def test_added_lines_go_in_order_after_the_line_they_follow():
    todo = fill.missing(fill.items(DOCUMENT), VISION)
    row = "| 오픈 {d}일 | — | {t} | 점검 [discovery-document.md · 단계별 성공 기준] |"
    out, added = fill.apply(VISION, todo, _reply(
        {"id": "G1", "action": "add", "after": 7, "text": row.format(d=30, t="월 약 730건 유지")},
        {"id": "G2", "action": "add", "after": 7, "text": row.format(d=60, t="기준선보다 낮음")},
        {"id": "G3", "action": "skip", "reason": "패키지 구성"}))
    assert added == 2
    lines = out.splitlines()
    assert lines[6].startswith("| 요청 유입")
    assert lines[7].startswith("| 오픈 30일") and lines[8].startswith("| 오픈 60일")
    assert lines[9].startswith("| 완료율")


@pytest.mark.parametrize("entry", [
    {"id": "G2", "action": "add", "after": 8, "text": "- 오픈 60일 점검 [discovery-document.md · 단계별 성공 기준]"},  # list after a row
    {"id": "G2", "action": "add", "after": 8, "text": "| 오픈 | — | 낮음 | 점검 [discovery-document.md · 단계별 성공 기준] |"},  # lost its number
    {"id": "G2", "action": "add", "after": 8, "text": "| 오픈 60일 | — | 낮음 | 점검 [discovery-document.md · 성공 지표] |"},  # wrong heading
    {"id": "G2", "action": "add", "after": 12, "text": "| 오픈 60일 | 점검 [discovery-document.md · 단계별 성공 기준] |"},  # Open Questions
    {"id": "G9", "action": "add", "after": 8, "text": "| 오픈 60일 | — | 낮음 | 점검 [discovery-document.md · 단계별 성공 기준] |"},  # no such item
])
def test_a_line_that_does_not_hold_is_not_taken(entry):
    todo = fill.missing(fill.items(DOCUMENT), VISION)
    assert fill.apply(VISION, todo, _reply(entry)) == (VISION, 0)


def test_an_unreadable_reply_raises_so_the_caller_keeps_the_document():
    with pytest.raises(ValueError):
        fill.apply(VISION, [], "할 수 없습니다")


def test_the_prompt_numbers_the_lines_and_lists_the_items():
    todo = fill.missing(fill.items(DOCUMENT), VISION)
    prompt = fill.build_prompt(language="ko", vision=VISION, todo=todo)
    assert "   7  | 요청 유입 |" in prompt and "G1. [단계별 성공 기준] | **30일** |" in prompt
    assert "written in Korean" in prompt and "skip it rather" in prompt

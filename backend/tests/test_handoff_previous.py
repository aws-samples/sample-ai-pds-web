# backend/tests/test_handoff_previous.py — handoff/previous: a rebuild edits the last vision.md
from __future__ import annotations

import asyncio

from aipds.handoff import previous
from fakes.in_memory_s3 import FakeS3Store

D = "aiplc-docs/discovery/"
DOC = D + "discovery-document.md"
VISION = """# P — Vision

## Business Context
### Success Metrics
- 완료율 95% (AI 제안, PM 미확인) [decisions.md · use-case-intake/use-case-intake-questions.md Q1]

## Risks and Dependencies
### Open Questions

| ID | 질문 | 답할 사람 | 시점 | 답이 나올 때까지 | 근거 |
|---|---|---|---|---|---|
| O-01 | 보존 기간은? | PM | 빌드 전 | — | 재료 없음 |
"""
MATERIAL = {DOC: "# 문서\n\n## 성공 지표\n- 완료율 95%\n", "decisions.md": "# 결정 장부\n| Q1 | 목표? | 95% |\n"}


def _run(coro):
    return asyncio.run(coro)


def test_nothing_changed_gives_the_last_version_to_keep():
    s3 = FakeS3Store()
    _run(previous.save(s3, vision=VISION, material=MATERIAL))
    got = _run(previous.load(s3, vision=VISION, material=MATERIAL))
    assert got is not None and got.changes == ""
    # Code renders the Open Questions table every time, and the earlier layout's marks are gone.
    assert "### Open Questions" in got.vision and "O-01" not in got.vision
    assert "AI 제안" not in got.vision and "- 완료율 95% [decisions.md" in got.vision
    section = previous.prompt_section(got, "vision.md")
    assert "Nothing in the material changed" in section and "<<<PREVIOUS vision.md>>>" in section


def test_a_changed_answer_reaches_the_edit_as_the_ledgers_diff():
    s3 = FakeS3Store()
    _run(previous.save(s3, vision=VISION, material=MATERIAL))
    now = MATERIAL | {"decisions.md": MATERIAL["decisions.md"] + "## 인계 시 보완(PM)\n| 보존 기간은? | 3년 | t |\n",
                      D + "prototype/spec-as-built.md": "# 명세\n"}
    now.pop(DOC)
    got = _run(previous.load(s3, vision=VISION, material=now))
    assert "<<<CHANGED decisions.md>>>" in got.changes and "+| 보존 기간은? | 3년 | t |" in got.changes
    assert "New in the material: prototype/spec-as-built.md" in got.changes
    assert "Removed from the material: discovery-document.md" in got.changes


def test_without_a_basis_that_describes_the_stored_version_it_is_written_anew():
    s3 = FakeS3Store()
    assert _run(previous.load(s3, vision=VISION, material=MATERIAL)) is None          # no basis yet
    assert _run(previous.load(s3, vision=None, material=MATERIAL)) is None            # no last version
    _run(previous.save(s3, vision=VISION, material=MATERIAL))
    assert _run(previous.load(s3, vision=VISION + "\n편집됨\n", material=MATERIAL)) is None


def test_a_change_too_large_to_be_an_edit_is_written_anew(monkeypatch):
    s3 = FakeS3Store()
    _run(previous.save(s3, vision=VISION, material=MATERIAL))
    monkeypatch.setattr(previous, "MAX_CHANGE_CHARS", 50)
    now = MATERIAL | {DOC: MATERIAL[DOC] + "\n".join(f"- 새 줄 {i}" for i in range(40))}
    assert _run(previous.load(s3, vision=VISION, material=now)) is None


def test_material_is_stored_once_by_content():
    s3 = FakeS3Store()
    _run(previous.save(s3, vision=VISION, material=MATERIAL))
    _run(previous.save(s3, vision=VISION, material=MATERIAL | {"decisions.md": "바뀐 장부\n"}))
    stored = [k for k in s3.blobs if k.startswith(previous.MATERIAL_PREFIX)]
    assert len(stored) == 3   # the document once, both ledgers

"""Demo sessions recorded in the Prototypes tab (proto/demo_notes.py)."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from aipds.proto import demo_notes
from aipds.proto.demo_notes import DemoRecordIn
from tests.fakes.in_memory_s3 import FakeS3Store

SLUG = "prototype"   # Path A.1's single id
NOTES = "aiplc-docs/discovery/prototype/demo-notes.md"


def _body(**over):
    data = {"participants": [{"role": "상담원", "count": 3}, {"role": "관리자", "count": 1}],
            "tasks": [{"task": "후보 목록에서 바로 연락할 곳 찾기", "outcome": "done", "note": ""},
                      {"task": "연락 기록 남기기", "outcome": "stuck", "note": "저장 버튼을 못 찾음 | 두 명"}],
            "notes": "필터 이름이 낯설다는 의견\n\n정렬 기준을 물어봄"}
    data.update(over)
    return DemoRecordIn.model_validate(data)


async def test_a_record_renders_next_to_the_spec_with_its_generation():
    s3 = FakeS3Store()
    s3.blobs[f"prototypes/{SLUG}/source/current.json"] = json.dumps({"gen": 3})
    rec = await demo_notes.add(s3, SLUG, _body(), language="ko",
                               now=datetime(2026, 1, 5, 4, 30, tzinfo=timezone.utc))
    assert rec.gen == 3
    md = s3.blobs[NOTES]
    assert "## 2026-01-05 04:30 UTC · gen 3" in md
    assert "상담원 3, 관리자 1 (총 4명)" in md
    assert "| 연락 기록 남기기 | 막힘 | 저장 버튼을 못 찾음 \\| 두 명 |" in md
    assert "> 필터 이름이 낯설다는 의견" in md


async def test_records_live_outside_the_tree_a_reset_wipes():
    """A reset deletes prototypes/{slug}/; a demo of an earlier build is still evidence."""
    s3 = FakeS3Store()
    await demo_notes.add(s3, SLUG, _body(), language="ko")
    assert all(not k.startswith(f"prototypes/{SLUG}/") for k in s3.blobs)
    assert any(k.startswith(f"demo-records/{SLUG}/") for k in s3.blobs)


async def test_records_accumulate_in_order_and_removing_the_last_removes_the_notes():
    s3 = FakeS3Store()
    first = await demo_notes.add(s3, SLUG, _body(notes="첫 시연"), language="en",
                                 now=datetime(2026, 1, 5, 1, 0, tzinfo=timezone.utc))
    second = await demo_notes.add(s3, SLUG, _body(notes="두 번째"), language="en",
                                  now=datetime(2026, 1, 5, 2, 0, tzinfo=timezone.utc))
    md = s3.blobs[NOTES]
    assert md.startswith("# Demo notes")
    assert md.index("첫 시연") < md.index("두 번째")
    assert "generation unknown" in md

    assert await demo_notes.remove(s3, SLUG, first.id, language="en")
    assert "첫 시연" not in s3.blobs[NOTES]
    assert await demo_notes.remove(s3, SLUG, second.id, language="en")
    assert NOTES not in s3.blobs
    assert not await demo_notes.remove(s3, SLUG, second.id, language="en")


def test_participants_are_required_and_bounded():
    with pytest.raises(ValueError):
        DemoRecordIn.model_validate({"participants": []})
    with pytest.raises(ValueError):
        DemoRecordIn.model_validate({"participants": [{"role": "x", "count": 0}]})
    with pytest.raises(ValueError):
        DemoRecordIn.model_validate({"participants": [{"role": "x", "count": 1}],
                                     "tasks": [{"task": "t", "outcome": "maybe"}]})

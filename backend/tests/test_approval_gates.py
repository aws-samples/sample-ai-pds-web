# The approval gates, read from question files (aipds/approval_gates.py). Names below are the shapes observed in
# workshop exports; the module recognises an approval round by its name alone.
from aipds.approval_gates import gates, is_approval_file
from aipds.doc_revisions import Round

_D = "aiplc-docs/discovery/"


def _file(answer: str = "A", *, extra: str = "") -> str:
    return ("# 승인\n\n## Question 1\n승인하십니까?\n\nA) 승인한다\nB) 수정이 필요하다\n\n"
            f"[Answer]: {answer}\n{extra}")


def test_observed_approval_names_are_recognised():
    for name in ("envision/envision-approval-questions.md", "envision/envision-reapproval-questions.md",
                 "envision/envision-approval-questions-2.md", "prototype/part2-approval-questions.md",
                 "prototype/spec-as-built-approval-questions.md", "product-strategy/strategy-approval-questions.md",
                 "go-to-market/gtm-approval-questions.md", "go-to-market/discovery-approval-questions.md"):
        assert is_approval_file(_D + name), name
    assert is_approval_file("aiplc-docs/envision-approval-questions.md")  # docs root, older layout


def test_other_files_are_not_approval_rounds():
    for path in (_D + "envision/pain-point-questions.md", _D + "prototypes/x/approval-notes.md",
                 _D + "discovery-document.md"):
        assert not is_approval_file(path), path


def test_a_round_with_any_unanswered_question_is_pending():
    two = _file("A", extra="\n## Question 2\n범위를 줄일까요?\n\nA) 예\nB) 아니오\n\n[Answer]:\n")
    [gate] = gates({_D + "envision/envision-approval-questions.md": two}, [])
    assert gate.status == "pending"
    assert [a.number for a in gate.answers] == [1]


def test_gates_follow_the_workflow_and_rounds_share_their_gate():
    contents = {
        _D + "go-to-market/gtm-approval-questions.md": _file(),
        _D + "envision/envision-approval-questions-2.md": _file(),
        _D + "envision/envision-approval-questions.md": _file("B: 2절을 고쳐 주세요"),
    }
    out = gates(contents, [])
    assert [(g.stage, g.round) for g in out] == [("envision", 1), ("envision", 2), ("go_to_market", 1)]
    assert out[0].gate == out[1].gate
    assert out[0].answers[0].answer == "B. 수정이 필요하다 — 2절을 고쳐 주세요"


def test_answered_at_is_the_latest_answer_round_for_that_file():
    path = _D + "envision/envision-approval-questions.md"
    rounds = [Round(id="1", at="2026-11-18T04:36:58+00:00", kind="answers", source=path, documents={}),
              Round(id="2", at="2026-11-18T05:00:00+00:00", kind="answers", source=path, documents={}),
              Round(id="3", at="2026-11-18T06:00:00+00:00", kind="revision", source=path, documents={}),
              Round(id="4", at="2026-11-18T07:00:00+00:00", kind="answers", source="other.md", documents={})]
    [gate] = gates({path: _file()}, rounds)
    assert gate.answered_at == "2026-11-18T05:00:00+00:00"


def test_a_file_without_questions_holds_nothing_up():
    assert gates({_D + "envision/envision-approval-questions.md": "# 승인\n\n본문만 있다\n"}, []) == []


def test_the_headline_is_the_answer_to_the_approval_question():
    text = ("# 승인\n\n## Question 1\n범위를 줄일까요?\n\nA) 예\nB) 아니오\n\n[Answer]: B\n\n"
            "## Question 2\nEnvision 결과를 승인하십니까?\n\nA) 승인한다\nB) 수정이 필요하다\n\n[Answer]: A\n\n"
            "## Question 3\n지표를 하나로 줄일까요?\n\nA) 예\nB) 아니오\n\n[Answer]: A\n")
    [gate] = gates({_D + "envision/envision-approval-questions.md": text}, [])
    assert gate.headline == "A. 승인한다"


def test_without_an_approval_question_the_headline_is_the_last_answer():
    text = "# 확인\n\n## Question 1\n진행할까요?\n\nA) 예\nB) 아니오\n\n[Answer]: A\n"
    [gate] = gates({_D + "go-to-market/gtm-approval-questions.md": text}, [])
    assert gate.headline == "A. 예"

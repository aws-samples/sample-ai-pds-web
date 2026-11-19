# Contract of the approval status route — the review screen's only source for "which approvals were given".
#
# Why it reads the approval question files instead of keeping its own records is in the aipds/approval_gates.py header.
# The invariant this file guards: the route reports, it never acts — there is no endpoint that approves or starts a turn.
import asyncio

from fastapi.testclient import TestClient

import aipds.app as app_module
from aipds.app import app, registry
from aipds.workspace import Workspace
from fakes.fake_runner import FakeRunner

client = TestClient(app)

_APPROVAL = "aiplc-docs/discovery/envision/envision-approval-questions.md"
_ANSWERED = ("# Envision 승인\n\n## Question 1\nEnvision 결과를 승인하십니까?\n\n"
             "A) 승인한다 — Solution Analysis로 진행한다\nB) 수정이 필요하다\n\n[Answer]: A\n")


def _seed(monkeypatch, pid, files: dict[str, str]):
    monkeypatch.setenv("AIPDS_S3_BUCKET", "")

    async def make(project_id):
        return Workspace(FakeRunner())

    monkeypatch.setattr(app_module, "make_workspace", make)
    client.post("/projects", json={"project_id": pid})
    ws = registry.get(pid)
    for path, text in files.items():
        asyncio.run(ws.runner.write_file(path, text))
    return ws


def test_an_answered_approval_question_is_reported_with_the_chosen_option(monkeypatch):
    _seed(monkeypatch, "ag1", {_APPROVAL: _ANSWERED})
    gates = client.get("/projects/ag1/approval-gates").json()["gates"]
    assert len(gates) == 1
    assert gates[0]["stage"] == "envision"
    assert gates[0]["status"] == "answered"
    assert gates[0]["answers"][0]["answer"] == "A. 승인한다 — Solution Analysis로 진행한다"


def test_an_unanswered_approval_question_is_pending(monkeypatch):
    _seed(monkeypatch, "ag2", {_APPROVAL: _ANSWERED.replace("[Answer]: A", "[Answer]:")})
    gates = client.get("/projects/ag2/approval-gates").json()["gates"]
    assert [g["status"] for g in gates] == ["pending"]


def test_other_question_files_are_not_approval_gates(monkeypatch):
    _seed(monkeypatch, "ag3", {
        "aiplc-docs/discovery/envision/pain-point-questions.md": _ANSWERED,
        "aiplc-docs/discovery/discovery-document.md": "# Discovery Document\n",
    })
    assert client.get("/projects/ag3/approval-gates").json() == {"gates": []}


def test_the_review_screen_cannot_approve_on_its_own(monkeypatch):
    """The old button sent a bare "승인" turn whether or not the agent had asked for an approval. That path is gone."""
    _seed(monkeypatch, "ag4", {_APPROVAL: _ANSWERED})
    assert client.post("/projects/ag4/approve").status_code in (404, 405)


def test_unknown_project_is_404():
    assert client.get("/projects/nope-not-here/approval-gates").status_code == 404

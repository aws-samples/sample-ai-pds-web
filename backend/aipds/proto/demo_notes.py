# backend/aipds/proto/demo_notes.py — demo sessions recorded in the Prototypes tab.
#
# **Why this exists.** The validation rule (prototype-validation.md Step 5) lets feedback come from
# "interviews or demos" reported back to Discovery, and Step 6 synthesizes whatever the user
# provides. In one-day workshops that is the route that fits: a survey needs respondents and days,
# a demo needs three to five people in the room for half an hour. Observed (workshop runs): teams
# showed the prototype to colleagues and then told Discovery "validated, skip it" — who saw it, what
# they tried and what went wrong were never written down, so validation counted zero signals.
#
# This module gives that demo a record. Each session is one object (who took part by role and
# count — never names — the tasks tried with their outcome, and what was observed), and every change
# rewrites `demo-notes.md` next to the spec. Discovery reads that file in Step 6 as the
# interview/demo feedback the rule already asks for; nothing about the rule changes. Recording is
# optional — skipping validation stays the user's call.
#
# **Where the records live.** `demo-records/{slug}/{id}.json`, outside `prototypes/{slug}/`: a reset
# wipes that tree, and a demo of an earlier build is still evidence of what was validated (each
# record carries the build generation it was taken on, so Discovery can compare it with the change
# history). One object per record, like survey responses, so two people saving at once do not
# overwrite each other.
from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from aipds.proto import layout

#: Root of the records, relative to the project prefix.
RECORDS_PREFIX = "demo-records/"


def records_prefix(slug: str) -> str:
    return f"{RECORDS_PREFIX}{slug}/"


def notes_key(slug: str) -> str:
    """Where the rendered notes go: next to the spec, like the survey aggregate."""
    return f"{layout.artifact_dir(slug)}/{layout.DEMO_NOTES}"


Outcome = Literal["done", "stuck", "skipped"]


class Participant(BaseModel):
    #: A role, not a person ("상담원", "store manager"). The form says so.
    role: str = Field(min_length=1, max_length=80)
    count: int = Field(ge=1, le=100)


class TaskResult(BaseModel):
    task: str = Field(min_length=1, max_length=200)
    outcome: Outcome
    note: str = Field(default="", max_length=500)


class DemoRecordIn(BaseModel):
    participants: list[Participant] = Field(min_length=1, max_length=10)
    tasks: list[TaskResult] = Field(default_factory=list, max_length=20)
    notes: str = Field(default="", max_length=4000)


class DemoRecord(DemoRecordIn):
    id: str
    at: str
    #: The source generation shown in the demo (proto/store.py); None if it could not be read.
    gen: int | None = None


def _new_id(now: datetime) -> str:
    # Time-ordered so a plain key sort is chronological.
    return f"{now.strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(3)}"


async def current_gen(s3, slug: str) -> int | None:
    try:
        data = json.loads(await s3.get(f"prototypes/{slug}/source/current.json"))
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    gen = data.get("gen") if isinstance(data, dict) else None
    return gen if isinstance(gen, int) else None


async def load(s3, slug: str) -> list[DemoRecord]:
    """Every record, oldest first. A record that no longer parses is skipped, not fatal."""
    out: list[DemoRecord] = []
    for key in sorted(await s3.list(records_prefix(slug))):
        if not key.endswith(".json"):
            continue
        try:
            out.append(DemoRecord.model_validate_json(await s3.get(key)))
        except (FileNotFoundError, ValueError):
            continue
    return out


_LABELS = {
    "ko": {
        "title": "# 시연 기록",
        "intro": ("Prototypes 탭에서 기록한 대면 시연입니다(AI-PDS Web이 관리하며, 기록이 바뀔 때마다 "
                  "다시 씁니다). `prototype-validation.md` Step 5의 \"인터뷰·데모 후 결과 보고\"에 "
                  "해당하는 피드백입니다. 참여자는 역할과 인원만 적습니다."),
        "participants": "참여자", "total": "총 {n}명", "tasks": "과업",
        "task": "과업", "outcome": "결과", "note": "메모", "notes": "관찰·의견",
        "gen": "gen {gen}", "no_gen": "세대 미상",
        "done": "완료", "stuck": "막힘", "skipped": "시도 안 함",
    },
    "en": {
        "title": "# Demo notes",
        "intro": ("In-person demos recorded in the Prototypes tab (maintained by AI-PDS Web and "
                  "rewritten whenever a record changes). This is the feedback Step 5 of "
                  "`prototype-validation.md` calls \"interviews or demos reported here\". "
                  "Participants are recorded by role and count only."),
        "participants": "Participants", "total": "{n} in total", "tasks": "Tasks",
        "task": "Task", "outcome": "Outcome", "note": "Note", "notes": "Observations",
        "gen": "gen {gen}", "no_gen": "generation unknown",
        "done": "Done", "stuck": "Stuck", "skipped": "Not tried",
    },
}


def _cell(text: str) -> str:
    return text.replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ").strip()


def render(records: list[DemoRecord], language: str) -> str:
    L = _LABELS["en" if language == "en" else "ko"]
    parts = [L["title"], "", L["intro"], ""]
    for r in records:
        when = r.at.replace("T", " ")[:16] + " UTC"
        gen = L["gen"].format(gen=r.gen) if r.gen is not None else L["no_gen"]
        total = sum(p.count for p in r.participants)
        who = ", ".join(f"{p.role} {p.count}" for p in r.participants)
        parts += [f"## {when} · {gen}", "",
                  f"- **{L['participants']}**: {who} ({L['total'].format(n=total)})"]
        if r.tasks:
            parts += ["", f"| {L['task']} | {L['outcome']} | {L['note']} |", "|---|---|---|"]
            parts += [f"| {_cell(t.task)} | {L[t.outcome]} | {_cell(t.note)} |" for t in r.tasks]
        if r.notes.strip():
            parts += ["", f"**{L['notes']}**", ""]
            parts += [f"> {line}" if line.strip() else ">" for line in r.notes.strip().splitlines()]
        parts.append("")
    return "\n".join(parts)


async def _rewrite(s3, slug: str, language: str) -> list[DemoRecord]:
    records = await load(s3, slug)
    if records:
        await s3.put(notes_key(slug), render(records, language))
    else:
        await s3.delete_prefix(notes_key(slug))
    return records


async def add(s3, slug: str, body: DemoRecordIn, *, language: str,
              now: datetime | None = None) -> DemoRecord:
    at = now or datetime.now(timezone.utc)
    record = DemoRecord(**body.model_dump(), id=_new_id(at),
                        at=at.strftime("%Y-%m-%dT%H:%M:%SZ"), gen=await current_gen(s3, slug))
    await s3.put(f"{records_prefix(slug)}{record.id}.json", record.model_dump_json())
    await _rewrite(s3, slug, language)
    return record


async def remove(s3, slug: str, record_id: str, *, language: str) -> bool:
    key = f"{records_prefix(slug)}{record_id}.json"
    if key not in await s3.list(key):
        return False
    await s3.delete_prefix(key)
    await _rewrite(s3, slug, language)
    return True

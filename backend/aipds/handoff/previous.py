# backend/aipds/handoff/previous.py — a rebuild edits the last vision.md instead of writing it anew.
#
# **Why it exists.** Regenerating from the same material rewrote the whole document: observed (two projects, two builds each), only
# 6–8% of the lines came back as they were — the same sections, in other words and with other picks — and the PM had to read all
# of it again to find what a change did. Given the last version and what changed in the material, the model kept 98–100% of the
# lines and touched only the 3–4 the change was about (observed: one handoff answer added, in both projects).
#
# **What changed is the material's diff.** Each build stores the material vision.md read — the originals the zip holds and the
# decision ledger (package.vision_material) — by content, next to a basis that pairs those texts with that vision.md. The ledger
# carries the question-file answers and the handoff answers, so a changed decision shows up as a ledger line, and nothing else
# needs a record of its own.
#
# **Writing anew stays possible and is the fallback.** No basis, a vision.md the basis does not describe, or changes too large
# to be an edit: the document is written anew, as before. The PM can also ask for it (a version they want rethought).
from __future__ import annotations

import difflib
import hashlib
import logging
import re
from collections.abc import Mapping

from pydantic import BaseModel

from aipds.handoff import open_rows
from aipds.s3store import S3StoreLike

_log = logging.getLogger("aipds.handoff")

#: The last build's basis: which material texts (by hash) the stored vision.md was written from.
BASIS_KEY = "handoff/basis.json"
#: Material texts by content. Under the handoff prefix, so resetting the handoff tab clears them too.
MATERIAL_PREFIX = "handoff/material/"
#: Past this many characters of diff, the change is a rewrite, not an edit — the document is written anew.
MAX_CHANGE_CHARS = 60_000
_CONTEXT_LINES = 2
#: Marks of the earlier layout (before every answer counted as the PM's) — a previous version may still carry them.
_LEGACY_MARKS = re.compile(r"\s*\((?:AI 제안, PM 미확인|AI suggestion, not confirmed by the PM)\)")


class Basis(BaseModel):
    #: sha256 of the stored vision.md this basis describes.
    vision: str
    #: Material path → sha256 of its text.
    material: dict[str, str]


class Previous(BaseModel):
    """What an edit is given: the last version, and how the material changed since."""
    vision: str
    changes: str


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def save(s3: S3StoreLike, *, vision: str, material: Mapping[str, str]) -> None:
    """Stores the material this vision.md was written from and the basis pairing them. Texts already stored are not put again."""
    digests = {path: _digest(text) for path, text in material.items()}
    known = set(await s3.list(MATERIAL_PREFIX))
    for path, text in material.items():
        key = MATERIAL_PREFIX + digests[path]
        if key not in known:
            await s3.put(key, text)
    await s3.put(BASIS_KEY, Basis(vision=_digest(vision), material=digests).model_dump_json())


async def load(s3: S3StoreLike, *, vision: str | None, material: Mapping[str, str]) -> Previous | None:
    """The last version and the material's changes since — or None, and the document is written anew."""
    if not vision:
        return None
    try:
        basis = Basis.model_validate_json(await s3.get(BASIS_KEY))
    except (FileNotFoundError, ValueError):
        return None
    if basis.vision != _digest(vision):
        _log.info("handoff vision: the stored version is not the one its basis describes — writing anew")
        return None
    parts: list[str] = []
    for path in sorted(set(basis.material) | set(material)):
        before_digest, now = basis.material.get(path), material.get(path)
        name = open_rows.cite(path)
        if now is None:
            parts.append(f"- Removed from the material: {name}. A line that relies on it no longer holds.")
        elif before_digest is None:
            parts.append(f"- New in the material: {name} (its text is in the source files above).")
        elif before_digest != _digest(now):
            try:
                before = await s3.get(MATERIAL_PREFIX + before_digest)
            except FileNotFoundError:
                _log.info("handoff vision: the last text of %s is gone — writing anew", path)
                return None
            parts.append(_diff(name, before, now))
    changes = "\n".join(parts)
    if len(changes) > MAX_CHANGE_CHARS:
        _log.info("handoff vision: %d characters changed — writing anew", len(changes))
        return None
    return Previous(vision=_without_code_parts(vision), changes=changes)


def _diff(name: str, before: str, now: str) -> str:
    lines = difflib.unified_diff(before.splitlines(), now.splitlines(), lineterm="", n=_CONTEXT_LINES)
    body = "\n".join(list(lines)[2:])   # drop the ---/+++ header: the marker names the file
    return f"<<<CHANGED {name}>>>\n{body}\n<<<END {name}>>>"


def _without_code_parts(vision: str) -> str:
    """The last version as the model edits it: without the Open Questions table (code renders it from its record every time)
    and without the marks of the earlier layout."""
    out: list[str] = []
    skipping = False
    for line in vision.splitlines():
        if re.match(r"^#{2,4}\s+Open Questions\b", line, re.IGNORECASE):
            out.append(line)
            skipping = True
            continue
        if skipping and re.match(r"^#{1,6}\s", line):
            skipping = False
        if not skipping:
            out.append(_LEGACY_MARKS.sub("", line))
    return "\n".join(out).rstrip() + "\n"


def prompt_section(previous: Previous, vision_name: str) -> str:
    """Appended to the vision prompt: edit the last version, keep what still holds."""
    changes = previous.changes or "- Nothing in the material changed."
    return f"""
## The previous version

The package was built before. Below is that version of {vision_name}. Write this version as
an edit of it, not anew: copy every line that still holds word for word and in the same place.
Change a line only where what changed makes it no longer hold, add a line only for what is new,
and remove a line only when it no longer holds. Do not reword, reorder or re-select lines that
still hold — a person reviews this version against the last one, and every needless change costs
that review. The rules above apply to every line you change or add. The Open Questions section
stays the heading only, as before; the open-questions JSON is written as the instructions above say.

What changed in the material since that version ("-" lines were in it then, "+" lines are in it
now; the decision ledger carries the PM's answers, including those given at handoff):

{changes}

<<<PREVIOUS {vision_name}>>>
{previous.vision}<<<END PREVIOUS>>>
"""


def describe(previous: Previous | None) -> str:
    """For the log."""
    if previous is None:
        return "anew"
    return f"edit ({len(previous.changes):,} characters of change)"


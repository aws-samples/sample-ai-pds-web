# backend/aipds/handoff/fill.py — the Discovery document's go-to-market targets vision.md left out go back in, checked by code.
#
# **Why it exists.** With the whole Discovery document in its material, the model still chose what to carry, and chose
# differently each time: observed (one project, two builds from the same originals), both builds left out the staged success
# criteria (30/60/90 days) and the remediation triggers. These are what the team needs to call the launch a success or act on
# it, and they sit in the document's Go-to-Market part — Part 3, which the rules always append last.
#
# **Code finds what is missing; the model decides whether it belongs.** Code takes the Part 3 lines that carry numbers (table
# rows and list items) and keeps those whose numbers are not all in vision.md. One call decides, for each, "add" (with the line
# it goes after) or "skip" (with a reason) — background, already said in other words, or about how the package was assembled.
# Code takes an added line only if it has the shape of the line it follows, keeps the item's numbers, cites the item's
# heading, and stays out of the Open Questions table. Observed (two projects, four documents): the 30/60/90-day criteria were
# added each time, the skips were the right ones, and no line was refused.
#
# **It never blocks.** On any failure the document stays as written — the same rule as the line rewrite (package._rewrite_flagged).
from __future__ import annotations

import json
import re
from collections.abc import Sequence

from pydantic import BaseModel

#: A number with its unit. Each number counts alone, so "2–3명" is two values a line must both carry.
_NUM = re.compile(r"\d+(?:[.,]\d+)?\s*(?:%|건|일|주|개월|분기|시간|명|개|회|배|원|분|"
                  r"days?|weeks?|months?|hours?|minutes?|people|times)", re.IGNORECASE)
#: The Go-to-Market part. The rules write `# Part 3: Go-to-Market`; a project may translate the title but keeps the number.
_PART3 = re.compile(r"^#{1,2}\s*(?:Part\s*3\b|.*Go-to-Market).*$", re.MULTILINE | re.IGNORECASE)
_HEADING = re.compile(r"^#{1,6}\s+(.*?)\s*$")
_TABLE_RULE = re.compile(r"^\|?\s*:?-{3,}")
_LIST = re.compile(r"^\s*([-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)")
_OPEN = re.compile(r"^#{2,4}\s+Open Questions\b", re.IGNORECASE)
#: More than this many items is not a gap to fill but a document that missed its Go-to-Market part — left to the checks.
MAX_ITEMS = 30


class Item(BaseModel):
    heading: str
    line: str
    numbers: list[str]


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", text)


def items(document: str) -> list[Item]:
    """The Discovery document's Part 3 lines that carry numbers — table rows and list items — under their heading."""
    match = _PART3.search(document)
    if match is None:
        return []
    heading, out = "", []
    for raw in document[match.start():].splitlines():
        if h := _HEADING.match(raw):
            heading = h.group(1).replace("**", "").strip()
            continue
        line = raw.strip()
        if not line or _TABLE_RULE.match(line):
            continue
        if not (line.startswith("|") or re.match(r"^(?:[-*+]|\d+[.)])\s", line)):
            continue
        numbers = sorted({_compact(n) for n in _NUM.findall(line)})
        if numbers:
            out.append(Item(heading=heading, line=line, numbers=numbers))
    return out


def missing(found: Sequence[Item], vision: str) -> list[Item]:
    """Items whose numbers vision.md does not all carry."""
    text = _compact(vision)
    return [i for i in found if not all(n in text for n in i.numbers)]


def build_prompt(*, language: str, vision: str, todo: Sequence[Item]) -> str:
    lang_name = "Korean" if language == "ko" else "English"
    numbered = "\n".join(f"{n:>4}  {line}" for n, line in enumerate(vision.splitlines(), 1))
    listed = "\n".join(f"G{k}. [{i.heading}] {i.line}" for k, i in enumerate(todo, 1))
    return f"""vision.md below was written from a product's discovery material, and code then checked it
against the Discovery document. The items after it are lines of the Discovery document's
Go-to-Market part — launch plan, success criteria and monitoring, remediation triggers,
go-to-market risks — whose numbers do not all appear in vision.md.

For each item decide one of two:
- "add": it is a target, a success or remediation criterion, a threshold, a date or a scope
  boundary that a development team building the product needs, and vision.md does not already
  say it in other words. Give one new line and the existing line it goes after.
- "skip": it is background, already said in vision.md in other words, or not for the team that
  builds the product (how the analysis or the handoff package was put together). If a line of
  vision.md already says the item and only some of its numbers are missing, skip it rather
  than add a second line that says the same. Give the reason in a few words.

A new line:
1. Has the shape of the line it goes after: a list item after a list item with the same mark
   (and a checkbox if that line has one), a table row after a table row with the same number
   of cells.
2. Goes into the section the item belongs to, never under "### Open Questions".
3. Keeps the item's numbers exactly. It is written in {lang_name} and says WHAT, never HOW: no
   technology, no identifiers internal to the source (H3, R4).
4. Ends with its citation in square brackets — inside the last cell for a table row:
   [discovery-document.md · <the item's heading as given>]
5. Several new lines for one table or list go in the order of the items, after the same line —
   so a staged series (30, 60, 90 days) reads in order.

Output one JSON object and nothing else:
{{"items": [{{"id": "G1", "action": "add", "after": 57, "text": "..."}},
            {{"id": "G2", "action": "skip", "reason": "..."}}]}}

## vision.md (line numbers on the left are not part of the text)

{numbered}

## Items

{listed}
"""


def _shape(line: str) -> tuple[str, object]:
    text = line.strip()
    if text.startswith("|"):
        return "row", len(text.strip("|").split("|"))
    match = _LIST.match(line)
    return ("list", match.group(1).strip()) if match else ("text", None)


def apply(vision: str, todo: Sequence[Item], reply: str) -> tuple[str, int]:
    """vision.md with the added lines that hold → (document, lines added). Raises ValueError on an unreadable reply."""
    match = re.search(r"\{.*\}", reply, re.DOTALL)
    if match is None:
        raise ValueError("fill reply has no JSON object")
    data = json.loads(match.group(0))
    lines = vision.split("\n")
    open_at = next((n for n, line in enumerate(lines, 1) if _OPEN.match(line)), len(lines) + 1)
    adds: dict[int, list[str]] = {}
    for entry in data.get("items", []) if isinstance(data, dict) else []:
        if not isinstance(entry, dict) or entry.get("action") != "add":
            continue
        number = re.fullmatch(r"G(\d+)", str(entry.get("id", "")))
        if number is None or not 1 <= int(number.group(1)) <= len(todo):
            continue
        item = todo[int(number.group(1)) - 1]
        after, text = entry.get("after"), str(entry.get("text", "")).strip()
        if (not isinstance(after, int) or not 1 <= after < open_at or "\n" in text or not text
                or _shape(text) != _shape(lines[after - 1])
                or not all(n in _compact(text) for n in item.numbers)
                or f"discovery-document.md · {item.heading}" not in text):
            continue
        adds.setdefault(after, []).append(text)
    out: list[str] = []
    for n, line in enumerate(lines, 1):
        out.append(line)
        out += adds.get(n, [])
    return "\n".join(out), sum(len(v) for v in adds.values())

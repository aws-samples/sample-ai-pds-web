# backend/aipds/handoff/estimates.py — keeps a value the originals mark as an estimate or an assumption marked in vision.md.
#
# **Why it exists.** A number the Discovery material estimated ("연 약 1,584시간, 담당자 추정") or assumed ("CS Lead 1명으로
# 가정") reads, once copied without its mark, as a measured fact — and development builds a target or a baseline on it. The
# instructions ask the model to keep the mark (vision rule 7), and in the builds measured it did; this makes it certain. Code
# restores the mark, without a model call, on a line that cites a file marking that value.
#
# **Only what the file itself marks, next to the number.** A marking word alone is not enough: "추정" is also the name of a
# feature ("유형 추정 수락률 90%" is a target, not an estimate). A value counts only when the mark sits with it — in the same
# parentheses after it, or leading it ("(추정 2~3회)", "(가정: 5분 …)"), right after it ("1,584시간 (담당자 추정)"), or in "N으로
# 추정·가정", "추정치 N". And a line is checked only against the files it cites, so a common number ("100%") is not taken
# for the estimate another file made. A single digit is too common even within one file — observed (a workshop run): the
# material assumed "CS Lead 1명", and vision.md's "PM 1명" was not that value — so only ranges and longer numbers count.
from __future__ import annotations

import re
from collections.abc import Mapping

from aipds.handoff import open_rows

#: A number with its unit. Ranges ("2~3회", "1,460~2,190회") are one value.
_NUM = (r"\d[\d,.]*(?:\s*[~～–-]\s*\d[\d,.]*)?\s*"
        r"(?:%|건|일|주|개월|분기|시간|명|개|회|배|원|분|곳|종|단어|문장|영업일|FTE|"
        r"hours?|days?|weeks?|months?|people|users|times)")
_ESTIMATE = r"(?:추정|estimat\w*)"
_ASSUMED = r"(?:가정|assum\w*)"
_MARK = rf"(?:{_ESTIMATE}|{_ASSUMED})"
_PAREN = re.compile(r"\(([^()]*)\)")
_AFTER = [
    re.compile(rf"({_NUM})\s*\([^()]{{0,12}}?({_MARK})", re.IGNORECASE),                     # 1,584시간 (추정, (담당자 추정
    re.compile(rf"({_NUM})\s*(?:으로|로)\s*({_MARK})", re.IGNORECASE),                       # 2~3회로 추정, 1명으로 가정
    re.compile(rf"(추정치|추정값|estimated(?: at)?)\s*:?\s*(?:약\s*)?({_NUM})", re.IGNORECASE),  # 추정치 300건
]
#: How near a mark must be to the number in vision.md for the line to keep it — the same clause, in practice.
_NEAR = 25
_CITED = re.compile(r"[\w./-]+\.md\b")
_LABELS = {"ko": {"estimate": "추정", "assumed": "가정"},
           "en": {"estimate": "estimated", "assumed": "assumed"}}


def _key(number: str) -> str:
    return re.sub(r"\s+", "", number)


def _distinctive(number: str) -> bool:
    """A range, or a number of two digits or more — enough to tell one value from the same small count said of something else."""
    digits = re.match(r"[\d,.]+", _key(number))
    return bool(re.search(r"[~～–-]", number)) or (digits is not None and len(re.sub(r"\D", "", digits.group(0))) >= 2)


def _kind(mark: str) -> str:
    return "assumed" if re.fullmatch(_ASSUMED, mark, re.IGNORECASE) else "estimate"


def marked_values(text: str) -> dict[str, str]:
    """Values a text marks as estimated or assumed → "estimate" | "assumed"."""
    found: dict[str, str] = {}
    for paren in _PAREN.finditer(text):
        inner = paren.group(1)
        marks = list(re.finditer(_MARK, inner, re.IGNORECASE))
        if not marks:
            continue
        for number in re.finditer(_NUM, inner):
            # The mark comes after the number, or leads it — directly ("추정 2~3회") or as a heading ("가정: 5분 ≈ 700단어") —
            # not as a feature name before it ("추정 유형 수락률 90%").
            lead = next((m for m in marks if m.end() <= number.start()
                         and (re.fullmatch(r"[\s:,]*", inner[m.end():number.start()])
                              or inner[m.end():].lstrip().startswith(":"))), None)
            after = next((m for m in marks if m.start() >= number.end()), None)
            if (mark := lead or after) and _distinctive(number.group(0)):
                found.setdefault(_key(number.group(0)), _kind(mark.group(0)))
    for pattern in _AFTER:
        for match in pattern.finditer(text):
            number, mark = ((match.group(1), match.group(2)) if pattern is not _AFTER[2]
                            else (match.group(2), match.group(1)))
            if _distinctive(number):
                found.setdefault(_key(number), _kind(mark))
    return found


def restore(doc: str, material: Mapping[str, str], language: str) -> tuple[str, int]:
    """vision.md with the estimate marks the cited originals give a value put back where a line dropped them → (document,
    how many were restored). Headings and the Open Questions table (code's own rows) are left as they are."""
    labels = _LABELS.get(language, _LABELS["ko"])
    by_file = {open_rows.cite(p): t for p, t in material.items()}
    cache: dict[str, dict[str, str]] = {}
    out: list[str] = []
    restored = 0
    in_open = False
    for line in doc.split("\n"):
        if line.startswith("#"):
            in_open = bool(re.match(r"^#{2,4}\s+Open Questions\b", line, re.IGNORECASE))
            out.append(line)
            continue
        cited = [_cite_path(p) for p in _CITED.findall(line)]
        values: dict[str, str] = {}
        for path in cited:
            if path in by_file:
                values |= {k: v for k, v in cache.setdefault(path, marked_values(by_file[path])).items() if k not in values}
        if in_open or not values:
            out.append(line)
            continue
        line, count = _mark_line(line, values, labels)
        restored += count
        out.append(line)
    return "\n".join(out), restored


def _cite_path(path: str) -> str:
    return open_rows.cite(path.removeprefix("discovery/"))


def _mark_line(line: str, values: Mapping[str, str], labels: Mapping[str, str]) -> tuple[str, int]:
    """Adds "(<label>)" right after each value the line carries without a mark near it — or ", <label>" when the value closes a
    parenthesis already ("(약 0.75 FTE)" → "(약 0.75 FTE, 추정)"). A citation is not a value."""
    spans = [m.span() for m in re.finditer(r"\[[^\[\]]*\]", line)]
    inserts: list[tuple[int, str]] = []
    for number in re.finditer(_NUM, line):
        start, end = number.span()
        if any(a <= start < b for a, b in spans):
            continue
        kind = values.get(_key(number.group(0)))
        if kind is None:
            continue
        near = line[max(0, start - _NEAR):end + _NEAR]
        if re.search(_MARK, near, re.IGNORECASE):
            continue
        closes = line[end:].lstrip().startswith(")") and line.rfind("(", 0, start) > line.rfind(")", 0, start)
        inserts.append((end, f", {labels[kind]}" if closes else f" ({labels[kind]})"))
    for at, text in reversed(inserts):
        line = line[:at] + text + line[at:]
    return line, len(inserts)

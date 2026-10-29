# backend/aipds/proto/design_choice.py — does the user's design-context answer opt this
# prototype into the admin brand profile?
#
# **Why this exists.** The upstream Step 2 question
# (`prototype-validation.md`, "What should this prototype look like?") offers
# "B) Match my organization's brand" next to "A) Clean and modern". The brand profile, however,
# was applied to every build whenever an admin had uploaded one, so a user who answered A got
# the brand anyway — the builder recorded the conflict in change-history.md and followed the
# profile. The web was overriding an answer the upstream workflow had collected. This module
# reads that answer so the web follows it instead.
#
# **Three outcomes, not two.** `True` (the brand option was chosen) and `False` (another
# lettered option was chosen) are decisions. `None` means "no decision we can read": the file is
# missing (Path B, or a project from before Step 2), Question 1 has no brand option, it is
# unanswered, or the answer is `X` (free text, which may well ask for the brand). On `None` the
# caller keeps the earlier behaviour — the profile applies — so nothing changes for projects
# whose answer cannot be read.
from __future__ import annotations

import logging
import re

from aipds.parsers.questions import parse_question_file
from aipds.proto import layout

_log = logging.getLogger(__name__)

#: The upstream question is fixed as Question 1 of the design-context file.
_APPEARANCE_QUESTION = 1

#: Words that mark the brand option. Matched against option text, not the letter — the letter is
#: upstream's (`B`) but an agent writing the file may reorder or reword the options.
_BRAND_WORDS = re.compile(r"brand|브랜드", re.IGNORECASE)

#: A leading option letter: `B`, `B)`, `B.`, `B -`, `b`. A letter glued to more letters
#: (`Brand`) is prose, not a choice.
_LEADING_LETTER = re.compile(r"^\s*([A-Ja-jXx])(?![A-Za-z])")


def brand_choice(markdown: str) -> bool | None:
    """True / False / None for one design-context file (see the module header)."""
    qf = parse_question_file(layout.DESIGN_CONTEXT, markdown)
    if not qf.parse_ok:
        return None
    question = next((q for q in qf.questions if q.number == _APPEARANCE_QUESTION), None)
    if question is None:
        return None
    brand_letters = {o.letter for o in question.options
                     if not o.is_other and _BRAND_WORDS.search(o.text)}
    if not brand_letters:
        return None
    match = _LEADING_LETTER.match(question.answer or "")
    if match is None:
        return None
    letter = match.group(1).upper()
    if letter == "X":
        return None
    if letter not in {o.letter for o in question.options}:
        return None
    return letter in brand_letters


async def brand_opted_in(s3, prototype_id: str) -> bool | None:
    """Reads this prototype's design-context file and returns `brand_choice` for it.

    Fail-soft like DesignProfileStore.load(): any read failure is `None`, so a broken lookup
    falls back to the earlier behaviour instead of blocking a build or a re-host.
    """
    key = layout.design_context_key(prototype_id)
    try:
        markdown = await s3.get(key)
    except FileNotFoundError:
        return None
    except Exception:
        _log.exception("design-context read failed at %s; brand choice unknown", key)
        return None
    try:
        return brand_choice(markdown)
    except Exception:
        _log.exception("design-context parse failed at %s; brand choice unknown", key)
        return None


async def effective_profile(profile, s3, prototype_id: str):
    """The profile to apply to this prototype: None when the user chose a non-brand look.

    Both call sites (build session start, hosting) go through this one function so they cannot
    disagree on whether a prototype is branded — the same two-call-site discipline as
    design_sync.sync_design.
    """
    if profile is None:
        return None
    if await brand_opted_in(s3, prototype_id) is False:
        _log.info("brand profile skipped for %s: the design-context answer chose a "
                  "non-brand look", prototype_id)
        return None
    return profile

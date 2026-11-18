# backend/aipds/proto/attachments.py — files the user attaches in the build chat.
#
# Requested in a workshop run: teams wanted to hand the builder a logo and reference material
# from the build chat itself. Discovery's uploads (parsers/uploads.py) never reach the build
# session — it runs in its own directory and gets only the documents start() plants.
#
# **Images and Markdown only.** Anything in the build tree spreads further than a Discovery
# upload: into every source generation in S3, the downloadable archive, the project export, and,
# once the builder copies it into `prototype/`, the hosted preview that the share link opens to
# survey participants. Real business data does not belong there, so data files (xlsx, csv) and
# documents that usually carry it (docx, pdf, pptx) are refused — a prototype's data is
# generated sample data, which the build rules already ask for.
#
# Files land in `attachments/{uuid8}/{name}` under the build directory: inside the tree the
# agent may read and copy from, outside `prototype/` so attaching does not count as a build
# change (store.output_digest) and nothing is served until the builder puts it to use.
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Literal

from aipds.parsers.uploads import _IMAGE_KINDS, _KIND_EXT, _image_kind, _safe_name

#: Accepted extensions. Images must also be one of these formats by their bytes.
IMAGE_EXTS = frozenset(_IMAGE_KINDS)
MARKDOWN_EXTS = frozenset({".md"})
ALLOWED = IMAGE_EXTS | MARKDOWN_EXTS

#: Per-file cap. Lower than Discovery's 10MB: a logo or a page of notes is small, and every
#: file is copied into each source generation.
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

ATTACHMENTS_DIR = "attachments"

Kind = Literal["image", "markdown"]


@dataclass(frozen=True)
class PreparedAttachment:
    #: Path relative to the build directory (what the agent is told to read).
    rel: str
    kind: Kind
    data: bytes


def _ext(filename: str) -> str:
    dot = filename.rfind(".")
    return filename[dot:].lower() if dot >= 0 else ""


def prepare(filename: str, data: bytes) -> PreparedAttachment:
    """Validate one attachment and decide where it goes. ValueError if it is not accepted.

    The error sentences follow parsers/uploads.py, so the frontend reads them the same way
    (`unsupported extension`, `cannot parse`).
    """
    ext = _ext(filename or "")
    if ext not in ALLOWED:
        raise ValueError(f"unsupported extension: {ext or '(none)'}")
    name = _safe_name(filename)
    folder = f"{ATTACHMENTS_DIR}/{uuid.uuid4().hex[:8]}"
    if ext in IMAGE_EXTS:
        kind = _image_kind(data)
        if kind is None:
            raise ValueError(f"cannot parse {ext} file: corrupted or invalid")
        if _IMAGE_KINDS[ext] != kind:
            # Named by what the bytes are, so the browser serves it with the right type.
            name = name[:len(name) - len(ext)] + _KIND_EXT[kind]
        return PreparedAttachment(f"{folder}/{name}", "image", data)
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        raise ValueError(f"cannot parse {ext} file: not UTF-8 text") from None
    return PreparedAttachment(f"{folder}/{name}", "markdown", data)

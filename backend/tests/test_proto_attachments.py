# backend/tests/test_proto_attachments.py — what the build chat accepts as an attachment.
from __future__ import annotations

import re
from pathlib import Path

import pytest

from aipds.proto.attachments import ALLOWED, MAX_ATTACHMENT_BYTES, prepare

_REPO = Path(__file__).resolve().parents[2]
_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
_JPEG = b"\xff\xd8\xff" + b"\x00" * 8


def test_only_images_and_markdown():
    """Real data stays out of the build tree (proto/attachments.py header)."""
    assert ALLOWED == {".png", ".jpg", ".jpeg", ".gif", ".webp", ".md"}


def test_an_image_is_named_by_what_its_bytes_are():
    assert prepare("logo.png", _JPEG).rel.endswith("/logo.jpg")


def test_each_attachment_gets_its_own_folder():
    a, b = prepare("logo.png", _PNG), prepare("logo.png", _PNG)
    assert a.rel != b.rel
    assert re.fullmatch(r"attachments/[0-9a-f]{8}/logo\.png", a.rel)


def test_a_name_cannot_climb_out_of_its_folder():
    assert prepare("../../etc/x.md", b"# x").rel.count("/") == 2


@pytest.mark.parametrize("name,data", [("x.svg", b"<svg/>"), ("x.csv", b"a,b"),
                                       ("x.png", b"not png"), ("x.md", b"\xff\xfe")])
def test_refused(name, data):
    with pytest.raises(ValueError):
        prepare(name, data)


def test_the_frontend_filters_by_the_same_rules():
    """lib/uploads.ts keeps a copy to filter before uploading (same discipline as
    test_uploads_parser's check of the Discovery uploads)."""
    ts = (_REPO / "frontend/lib/uploads.ts").read_text(encoding="utf-8")
    exts = re.search(r"export const BUILD_ATTACH_EXTENSIONS = \[(.*?)\] as const", ts, re.S)
    assert exts, "lib/uploads.ts의 BUILD_ATTACH_EXTENSIONS를 찾지 못했다"
    assert set(re.findall(r'"(\.[a-z0-9]+)"', exts.group(1))) == set(ALLOWED)
    mb = re.search(r"export const BUILD_ATTACH_MAX_BYTES = (\d+) \* 1024 \* 1024;", ts)
    assert mb and int(mb.group(1)) * 1024 * 1024 == MAX_ATTACHMENT_BYTES

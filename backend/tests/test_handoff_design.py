# backend/tests/test_handoff_design.py — the brand a prototype applied reaches the handoff package (design/)
from __future__ import annotations

import asyncio
import json

from aipds.handoff import package
from aipds.proto import design_sync
from aipds.proto.source import design_entries
from aipds.proto.store import source_prefix
from fakes.in_memory_s3 import FakeS3Store

THEME = ":root {\n  --primary: #0a5;\n}\n"
STUB = design_sync.stub_css()
PROSE = "# 브랜드\n\n여백을 넉넉히 둔다.\n"


def _entries(build_dir, s3=None, slug="prototype"):
    return asyncio.run(design_entries(build_dir=build_dir, s3=s3 or FakeS3Store(), slug=slug))


def test_a_branded_build_tree_gives_its_guide_and_its_tokens(tmp_path):
    (tmp_path / "DESIGN.md").write_text(PROSE, encoding="utf-8")
    (tmp_path / "aipds-theme.css").write_text(THEME, encoding="utf-8")
    assert _entries(tmp_path) == {"DESIGN.md": PROSE.encode(), "aipds-theme.css": THEME.encode()}


def test_a_design_md_without_the_web_s_theme_file_is_the_agent_s_own_notes(tmp_path):
    (tmp_path / "DESIGN.md").write_text("# 메모\n", encoding="utf-8")
    assert _entries(tmp_path) == {}


def test_a_profile_without_tokens_gives_the_guide_alone(tmp_path):
    (tmp_path / "DESIGN.md").write_text(PROSE, encoding="utf-8")
    (tmp_path / "aipds-theme.css").write_text(STUB, encoding="utf-8")
    assert _entries(tmp_path) == {"DESIGN.md": PROSE.encode()}


def test_an_unbranded_prototype_gives_nothing(tmp_path):
    # The user chose another look: the stub stays, DESIGN.md was removed (design_sync).
    (tmp_path / "aipds-theme.css").write_text(STUB, encoding="utf-8")
    assert _entries(tmp_path) == {}


def test_without_a_local_tree_the_current_generation_in_s3_is_read(tmp_path):
    s3 = FakeS3Store()
    base = source_prefix("triage")

    async def seed():
        await s3.put(base + "current.json", json.dumps({"gen": 3, "hash": "h"}))
        await s3.put_bytes(base + "000002/DESIGN.md", b"# old\n")
        await s3.put_bytes(base + "000003/DESIGN.md", PROSE.encode())
        await s3.put_bytes(base + "000003/aipds-theme.css", THEME.encode())
    asyncio.run(seed())
    assert _entries(tmp_path / "missing", s3, "triage") == {
        "DESIGN.md": PROSE.encode(), "aipds-theme.css": THEME.encode()}


def test_branded_prototypes_share_one_folder_unless_their_brand_differs():
    one = {"DESIGN.md": b"a", "aipds-theme.css": b"t"}
    assert package.design_archive({}) == {}
    assert package.design_archive({"a": {}, "b": {}}) == {}
    assert package.design_archive({"a": one, "b": dict(one), "c": {}}) == {
        "design/DESIGN.md": b"a", "design/aipds-theme.css": b"t"}
    assert package.design_archive({"a": one, "b": {"DESIGN.md": b"z"}}) == {
        "design/a/DESIGN.md": b"a", "design/a/aipds-theme.css": b"t", "design/b/DESIGN.md": b"z"}


def test_the_readme_and_start_prompt_point_at_design_only_when_it_is_there():
    for language in ("ko", "en"):
        assert "design/" not in package.readme(language)
        assert "design/" in package.readme(language, design=True)
        assert "{design}" not in package.readme(language) + package.readme(language, design=True)
        assert "design/" not in package.start_prompt(language, "p-handoff")
        prompt = package.start_prompt(language, "p-handoff", design=True)
        # Both requests carry it — with and without a technical environment document.
        assert prompt.count("./p-handoff/design/") == 2

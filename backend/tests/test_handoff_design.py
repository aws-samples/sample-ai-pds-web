# backend/tests/test_handoff_design.py — the brand guide a prototype applied reaches the handoff package as reference (design/)
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


def test_a_branded_build_tree_gives_its_guide_but_not_its_theme_file(tmp_path):
    """The theme file is CSS variables wired into the prototype's own stack — a technical artifact, like the build instructions."""
    (tmp_path / "DESIGN.md").write_text(PROSE, encoding="utf-8")
    (tmp_path / "aipds-theme.css").write_text(THEME, encoding="utf-8")
    assert _entries(tmp_path) == {"DESIGN.md": PROSE.encode()}


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
    assert _entries(tmp_path / "missing", s3, "triage") == {"DESIGN.md": PROSE.encode()}


def test_branded_prototypes_share_one_folder_unless_their_brand_differs():
    one = {"DESIGN.md": b"a", "aipds-theme.css": b"t"}
    assert package.design_archive({}) == {}
    assert package.design_archive({"a": {}, "b": {}}) == {}
    assert package.design_archive({"a": one, "b": dict(one), "c": {}}) == {
        "design/DESIGN.md": b"a", "design/aipds-theme.css": b"t"}
    assert package.design_archive({"a": one, "b": {"DESIGN.md": b"z"}}) == {
        "design/a/DESIGN.md": b"a", "design/a/aipds-theme.css": b"t", "design/b/DESIGN.md": b"z"}


def test_the_readme_names_design_as_reference_and_the_start_prompt_leaves_it_to_the_team():
    """A brand guide is a company standard: which one to follow is the team's to set in its technical environment document."""
    for language in ("ko", "en"):
        assert "design/" not in package.readme(language)
        with_design = package.readme(language, design=True)
        assert "design/" in with_design and "technical environment" in with_design
        assert "{design}" not in package.readme(language) + with_design
        assert "design/" not in package.start_prompt(language, "p-handoff")

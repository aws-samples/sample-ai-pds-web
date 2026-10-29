# backend/tests/test_token_usage.py — per-project token metering (aipds/token_usage.py),
# its prices (aipds/pricing.py), its wiring into the Discovery reader and the build loop,
# and the admin route.
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

import aipds.app as app_module
from aipds import pricing, token_usage
from aipds.agent.claude_driver import _MessageReader
from aipds.auth.deps import require_admin, require_user
from aipds.auth.models import Principal
from aipds.project_bundle import bundle_path_to_s3_key, s3_key_to_bundle_path
from aipds.proto.builder import PrototypeBuilder
from aipds.token_usage import USAGE_KEY, UsageRecorder
from aipds.workspace import ProjectRegistry
from fakes.fake_sdk import AssistantMessage, FakeSdkClient, ResultMessage, TextBlock
from tests.fakes.in_memory_s3 import FakeS3Store


def _usage(inp=0, out=0, w5=0, w1=0, read=0) -> dict:
    return {"input_tokens": inp, "output_tokens": out,
            "cache_creation_input_tokens": w5 + w1,
            "cache_creation": {"ephemeral_5m_input_tokens": w5,
                               "ephemeral_1h_input_tokens": w1},
            "cache_read_input_tokens": read}


def _msg(mid, usage, model="claude-opus-5-5", parent=None):
    return AssistantMessage(content=[TextBlock("x")], usage=usage, message_id=mid,
                            model=model, parent_tool_use_id=parent)


async def _stored(s3) -> dict:
    return json.loads(await s3.get(USAGE_KEY))


def _bucket(data, source="discovery", model="claude-opus-5-5", tier="standard"):
    return data["sources"][source][model][tier]


# ---- pricing ----

@pytest.mark.parametrize("model_id", [
    "global.anthropic.claude-opus-5-5", "apac.anthropic.claude-opus-5-5",
    "claude-opus-5-5", "global.anthropic.claude-opus-5-5[1m]",
    "anthropic.claude-opus-5-5-v1:0",
])
def test_base_model_strips_every_id_form(model_id):
    assert pricing.base_model(model_id) == "claude-opus-5-5"


def test_base_model_strips_a_date_snapshot():
    assert pricing.base_model("anthropic.claude-haiku-4-5-20251001-v1:0") == "claude-haiku-4-5"


def test_global_profiles_are_not_regional():
    assert not pricing.is_regional("global.anthropic.claude-opus-5-5")
    assert not pricing.is_regional(None)
    assert pricing.is_regional("apac.anthropic.claude-opus-5-5")


def test_cost_uses_each_token_kind_at_its_own_rate():
    counts = {"input": 1_000_000, "output": 1_000_000, "cache_write_5m": 1_000_000,
              "cache_write_1h": 1_000_000, "cache_read": 1_000_000}
    # Opus 5.5: 4 + 20 + 5 + 8 + 0.2
    assert pricing.cost_usd("claude-opus-5-5", "standard", counts) == pytest.approx(37.2)


def test_regional_usage_carries_the_markup():
    counts = {"input": 1_000_000}
    assert pricing.cost_usd("claude-opus-5-5#regional", "standard", counts) == \
        pytest.approx(4.0 * pricing.REGIONAL_MARKUP)


def test_unknown_model_has_no_cost():
    assert pricing.cost_usd("claude-unknown-9", "standard", {"input": 5}) is None


def test_only_haiku_5_5_has_a_long_context_tier():
    assert pricing.tier_of("claude-haiku-5-5", 100_001) == "long"
    assert pricing.tier_of("claude-haiku-5-5", 100_000) == "standard"
    # Opus is billed at one rate up to 1M on Bedrock — 750K is still standard.
    assert pricing.tier_of("claude-opus-5-5", 750_000) == "standard"


# ---- metering ----

@pytest.mark.asyncio
async def test_blocks_of_one_response_count_once():
    s3 = FakeS3Store()
    rec = UsageRecorder(s3, "p1", "discovery")
    u = _usage(inp=2, out=462, w5=12322, read=15445)
    for _ in range(3):  # thinking, tool_use, tool_use — the same usage on each
        rec.observe(_msg("m1", u))
    await rec.flush()
    b = _bucket(await _stored(s3))
    assert b == {"requests": 1, "input": 2, "output": 462, "cache_write_5m": 12322,
                 "cache_write_1h": 0, "cache_read": 15445}


@pytest.mark.asyncio
async def test_a_growing_usage_adds_only_the_difference():
    s3 = FakeS3Store()
    rec = UsageRecorder(s3, "p1", "discovery")
    rec.observe(_msg("m1", _usage(inp=10, out=5)))
    rec.observe(_msg("m1", _usage(inp=10, out=50)))
    await rec.flush()
    b = _bucket(await _stored(s3))
    assert (b["requests"], b["input"], b["output"]) == (1, 10, 50)


@pytest.mark.asyncio
async def test_a_response_seen_again_after_a_flush_is_not_recounted():
    s3 = FakeS3Store()
    rec = UsageRecorder(s3, "p1", "discovery")
    rec.observe(_msg("m1", _usage(inp=10, out=5)))
    await rec.flush()
    rec.observe(_msg("m1", _usage(inp=10, out=5)))
    await rec.flush()
    assert _bucket(await _stored(s3))["requests"] == 1


@pytest.mark.asyncio
async def test_subagent_responses_are_metered():
    s3 = FakeS3Store()
    rec = UsageRecorder(s3, "p1", "discovery")
    rec.observe(_msg("m1", _usage(inp=1, out=1)))
    rec.observe(_msg("m2", _usage(inp=1, out=1), model="claude-haiku-5-5", parent="toolu_1"))
    await rec.flush()
    data = await _stored(s3)
    assert _bucket(data)["requests"] == 1
    assert _bucket(data, model="claude-haiku-5-5")["requests"] == 1


@pytest.mark.asyncio
async def test_the_tier_is_decided_per_request():
    s3 = FakeS3Store()
    rec = UsageRecorder(s3, "p1", "discovery")
    rec.observe(_msg("a", _usage(inp=10, read=50_000), model="claude-haiku-5-5"))
    rec.observe(_msg("b", _usage(inp=10, read=150_000), model="claude-haiku-5-5"))
    await rec.flush()
    data = await _stored(s3)
    assert _bucket(data, model="claude-haiku-5-5")["cache_read"] == 50_000
    assert _bucket(data, model="claude-haiku-5-5", tier="long")["cache_read"] == 150_000


@pytest.mark.asyncio
async def test_usage_without_the_ttl_breakdown_counts_as_5m_writes():
    s3 = FakeS3Store()
    rec = UsageRecorder(s3, "p1", "discovery")
    rec.observe(_msg("m1", {"input_tokens": 1, "output_tokens": 1,
                            "cache_creation_input_tokens": 700}))
    await rec.flush()
    assert _bucket(await _stored(s3))["cache_write_5m"] == 700


@pytest.mark.asyncio
async def test_a_regional_project_is_keyed_apart():
    s3 = FakeS3Store()
    rec = UsageRecorder(s3, "p1", "discovery", model_id="apac.anthropic.claude-opus-5-5")
    rec.observe(_msg("m1", _usage(inp=1)))
    await rec.flush()
    assert "claude-opus-5-5#regional" in (await _stored(s3))["sources"]["discovery"]


@pytest.mark.asyncio
async def test_the_result_message_schedules_the_write():
    s3 = FakeS3Store()
    rec = UsageRecorder(s3, "p1", "discovery")
    rec.observe(_msg("m1", _usage(inp=3)))
    rec.observe(ResultMessage())
    await rec.wait()
    assert _bucket(await _stored(s3))["input"] == 3


@pytest.mark.asyncio
async def test_sources_and_writes_accumulate_in_one_record():
    s3 = FakeS3Store()
    a = UsageRecorder(s3, "p1", "discovery")
    b = UsageRecorder(s3, "p1", "prototype")
    a.observe(_msg("m1", _usage(inp=1)))
    b.observe(_msg("m2", _usage(inp=2)))
    await a.flush()
    await b.flush()
    a.observe(_msg("m3", _usage(inp=4)))
    await a.flush()
    data = await _stored(s3)
    assert _bucket(data)["input"] == 5
    assert _bucket(data, source="prototype")["input"] == 2


@pytest.mark.asyncio
async def test_a_failed_write_keeps_the_counts_for_the_next_one():
    class FlakyS3(FakeS3Store):
        fail = True

        async def put(self, key, content):
            if self.fail:
                raise RuntimeError("s3 down")
            return await super().put(key, content)

    s3 = FlakyS3()
    rec = UsageRecorder(s3, "p1", "discovery")
    rec.observe(_msg("m1", _usage(inp=7)))
    await rec.flush()  # swallowed
    s3.fail = False
    rec.observe(_msg("m2", _usage(inp=1)))
    await rec.flush()
    b = _bucket(await _stored(s3))
    assert (b["requests"], b["input"]) == (2, 8)


@pytest.mark.asyncio
async def test_converse_usage_from_one_shot_calls():
    s3 = FakeS3Store()
    rec = UsageRecorder(s3, "p1", "survey", model_id="global.anthropic.claude-sonnet-5-5")
    rec.add_converse({"inputTokens": 900, "outputTokens": 300, "totalTokens": 1200,
                      "cacheReadInputTokens": 0, "cacheWriteInputTokens": 0})
    await rec.flush()
    b = _bucket(await _stored(s3), source="survey", model="claude-sonnet-5-5")
    assert (b["requests"], b["input"], b["output"]) == (1, 900, 300)


# ---- summary ----

def test_summary_prices_totals_and_flags_unpriced_models():
    data = {"sources": {
        "discovery": {"claude-opus-5-5": {"standard": {
            "requests": 2, "input": 1_000_000, "output": 0, "cache_write_5m": 0,
            "cache_write_1h": 0, "cache_read": 3_000_000}}},
        "survey": {"claude-mystery": {"standard": {
            "requests": 1, "input": 10, "output": 10, "cache_write_5m": 0,
            "cache_write_1h": 0, "cache_read": 0}}},
    }}
    s = token_usage.summarize(data)
    assert s["requests"] == 3
    assert s["cost_usd"] == pytest.approx(4.0 + 0.6)  # the unpriced model adds nothing
    assert s["unpriced_models"] == ["claude-mystery"]
    assert s["by_source"]["discovery"]["cache_hit_rate"] == pytest.approx(0.75)
    assert s["by_source"]["survey"]["cost_usd"] == 0
    # A project runs on one model, so there is no per-model view.
    assert "by_model" not in s


def test_summary_of_nothing_is_zero():
    s = token_usage.summarize(None)
    assert s["requests"] == 0 and s["cost_usd"] == 0 and s["cache_hit_rate"] is None


# ---- wiring ----

@pytest.mark.asyncio
async def test_the_discovery_reader_meters_every_message_it_reads():
    s3 = FakeS3Store()
    rec = UsageRecorder(s3, "p1", "discovery")

    async def stream():
        yield _msg("m1", _usage(inp=5))
        yield _msg("m1", _usage(inp=5))
        yield ResultMessage()

    reader = _MessageReader(stream(), usage=rec)
    await reader.task  # nobody pumps it — an abandoned turn is metered all the same
    await rec.wait()
    assert _bucket(await _stored(s3))["requests"] == 1


@pytest.mark.asyncio
async def test_the_build_loop_meters_its_turn(tmp_path):
    s3 = FakeS3Store()
    rec = UsageRecorder(s3, "p1", "prototype")
    client = FakeSdkClient([_msg("m1", _usage(inp=11, out=3)), ResultMessage()])
    builder = PrototypeBuilder(workspace=str(tmp_path), config_dir=str(tmp_path / "config"),
                               session_id="11111111-2222-3333-4444-555555555555",
                               resume=False, client_factory=lambda: client, usage=rec)
    [ev async for ev in builder.run("build it")]
    await rec.wait()
    b = _bucket(await _stored(s3), source="prototype")
    assert (b["input"], b["output"]) == (11, 3)


def test_usage_is_not_carried_by_export_or_import():
    assert s3_key_to_bundle_path(USAGE_KEY, transcript_prefix="t/") is None
    assert bundle_path_to_s3_key("project/" + USAGE_KEY, transcript_prefix="t/") is None


# ---- route ----

@pytest.fixture()
def as_role(monkeypatch):
    s3s: dict[str, FakeS3Store] = {}
    monkeypatch.setattr(app_module, "durable_projects_enabled", lambda: True)
    monkeypatch.setattr(app_module, "s3_store_factory",
                        lambda pid: s3s.setdefault(pid, FakeS3Store()))
    prices = FakeS3Store()
    monkeypatch.setattr(app_module, "pricing_root_s3_factory", lambda: prices)

    def login(role: str):
        me = Principal(username=f"{role}@aipds.local", sub=f"s-{role}", role=role)
        app_module.app.dependency_overrides[require_user] = lambda: me
        if role == "admin":
            app_module.app.dependency_overrides[require_admin] = lambda: me
        return s3s
    yield login
    app_module.app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_admin_sees_each_project_most_expensive_first(as_role, monkeypatch):
    s3s = as_role("admin")
    registry = ProjectRegistry()
    registry.register("u-1", "First", owner="pm@aipds.local")
    registry.register("u-2", "Second", owner="pm@aipds.local")
    monkeypatch.setattr(app_module, "registry", registry)
    # u-2 is listed second by the registry but costs more — it must come first.
    rec = UsageRecorder(app_module.s3_store_factory("u-2"), "u-2", "discovery")
    rec.observe(_msg("m1", _usage(inp=1_000_000)))
    await rec.flush()
    body = TestClient(app_module.app).get("/admin/usage").json()
    assert [p["project_id"] for p in body["projects"]] == ["u-2", "u-1"]
    assert body["projects"][0]["usage"]["cost_usd"] == pytest.approx(4.0)
    assert body["projects"][1]["usage"]["requests"] == 0
    assert (body["total"], body["page"], body["size"]) == (2, 1, 10)
    assert body["estimate"] is True
    assert body["pricing"]["source"] == "builtin"
    assert set(s3s) >= {"u-1", "u-2"}


@pytest.mark.asyncio
async def test_the_route_prices_with_the_refreshed_snapshot(as_role, monkeypatch):
    as_role("admin")
    snapshot = FakeS3Store()
    rates = {"input": 1.0, "output": 1.0, "cache_write_5m": 1.0, "cache_write_1h": 1.0,
             "cache_read": 1.0}
    await snapshot.put(pricing.SNAPSHOT_KEY, json.dumps({
        "fetched_at": "2026-11-01T00:00:00+00:00", "region": "ap-northeast-2",
        "models": {"claude-opus-5-5": {"standard": rates}}}))
    monkeypatch.setattr(app_module, "pricing_root_s3_factory", lambda: snapshot)
    registry = ProjectRegistry()
    registry.register("u-1", "First", owner="pm@aipds.local")
    monkeypatch.setattr(app_module, "registry", registry)
    rec = UsageRecorder(app_module.s3_store_factory("u-1"), "u-1", "discovery")
    rec.observe(_msg("m1", _usage(inp=1_000_000)))
    await rec.flush()
    body = TestClient(app_module.app).get("/admin/usage").json()
    # The snapshot's rate, not the built-in 4.0.
    assert body["projects"][0]["usage"]["cost_usd"] == pytest.approx(1.0)
    assert body["pricing"] == {"source": "price_list", "as_of": "2026-11-01T00:00:00+00:00",
                               "region": "ap-northeast-2"}


@pytest.mark.asyncio
async def test_pages_are_cut_after_sorting_by_cost(as_role, monkeypatch):
    as_role("admin")
    registry = ProjectRegistry()
    for i in range(5):
        registry.register(f"p-{i}", owner="pm@aipds.local")
    monkeypatch.setattr(app_module, "registry", registry)
    for i in range(5):  # p-4 costs the most, p-0 the least
        rec = UsageRecorder(app_module.s3_store_factory(f"p-{i}"), f"p-{i}", "discovery")
        rec.observe(_msg("m", _usage(inp=(i + 1) * 1000)))
        await rec.flush()
    client = TestClient(app_module.app)
    first = client.get("/admin/usage?page=1&size=2").json()
    last = client.get("/admin/usage?page=3&size=2").json()
    assert [p["project_id"] for p in first["projects"]] == ["p-4", "p-3"]
    assert [p["project_id"] for p in last["projects"]] == ["p-0"]
    assert first["total"] == last["total"] == 5


@pytest.mark.asyncio
async def test_one_projects_usage_for_its_dashboard(as_role, monkeypatch):
    as_role("admin")
    registry = ProjectRegistry()
    registry.register("u-1", "First", owner="pm@aipds.local")
    monkeypatch.setattr(app_module, "registry", registry)
    rec = UsageRecorder(app_module.s3_store_factory("u-1"), "u-1", "prototype")
    rec.observe(_msg("m1", _usage(inp=1_000_000)))
    await rec.flush()
    body = TestClient(app_module.app).get("/admin/usage/u-1").json()
    assert body["project_id"] == "u-1" and body["name"] == "First"
    assert body["usage"]["by_source"]["prototype"]["cost_usd"] == pytest.approx(4.0)
    assert body["pricing"]["source"] == "builtin"


def test_an_unknown_project_is_404(as_role, monkeypatch):
    as_role("admin")
    monkeypatch.setattr(app_module, "registry", ProjectRegistry())
    assert TestClient(app_module.app).get("/admin/usage/nope").status_code == 404


@pytest.mark.parametrize("path", ["/admin/usage", "/admin/usage/u-1"])
def test_a_non_admin_is_refused(as_role, path):
    as_role("pm")
    assert TestClient(app_module.app).get(path).status_code == 403

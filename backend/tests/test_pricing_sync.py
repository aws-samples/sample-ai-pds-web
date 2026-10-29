# backend/tests/test_pricing_sync.py — the Bedrock price snapshot: parsing the AWS Price List
# (aipds/pricing_sync.py) and laying it over the built-in table (aipds/pricing.py).
from __future__ import annotations

import json

import pytest

from aipds import pricing, pricing_sync
from tests.fakes.in_memory_s3 import FakeS3Store


def _item(model: str, usagetype: str, usd: float, *, unit: str = "1M tokens",
          feature: str = "On-demand Inference", provider: str = "Anthropic") -> str:
    """One Price List entry, in the shape GetProducts returns (a JSON string)."""
    return json.dumps({
        "product": {"attributes": {
            "model": model, "provider": provider, "feature": feature,
            "usagetype": f"APN2-MP:APN2_{usagetype}-Units",
            "servicename": f"{model} (Amazon Bedrock Edition)"}},
        "terms": {"OnDemand": {"t": {"priceDimensions": {"d": {
            "unit": unit, "pricePerUnit": {"USD": str(usd)}}}}}},
    })


def _new_style(model: str, rates: tuple, *, long: bool = False) -> list[str]:
    suffix = "_long_ctx_global_standard" if long else "_global_standard"
    names = ("input_tokens", "output_tokens", "cache_write_tokens", "cache_write_tokens_1h",
             "cache_read_tokens")
    return [_item(model, n + suffix, r) for n, r in zip(names, rates)]


def _old_style(model: str, rates: tuple) -> list[str]:
    names = ("InputTokenCount_Global", "OutputTokenCount_Global",
             "CacheWriteInputTokenCount_Global", "CacheWrite1hInputTokenCount_Global",
             "CacheReadInputTokenCount_Global")
    return [_item(model, n, r) for n, r in zip(names, rates)]


def _full_list() -> list[str]:
    """Every built-in model at its built-in rates — what a healthy price list looks like."""
    items: list[str] = []
    for name, price in pricing.PRICES.items():
        display = "Claude " + " ".join(name.split("-")[1:2]).title() + " " + \
            ".".join(name.split("-")[2:])
        s = price.standard
        items += _new_style(display, (s.input, s.output, s.cache_write_5m, s.cache_write_1h,
                                      s.cache_read))
        if price.long:
            lr = price.long
            items += _new_style(display, (lr.input, lr.output, lr.cache_write_5m,
                                          lr.cache_write_1h, lr.cache_read), long=True)
    return items


def test_model_names_match_the_bare_ids():
    assert pricing_sync.model_name("Claude Opus 5.5") == "claude-opus-5-5"
    assert pricing_sync.model_name("Claude Haiku 4.5") == "claude-haiku-4-5"


def test_both_usage_type_generations_parse():
    models = pricing_sync.parse(_new_style("Claude Opus 5.5", (4, 20, 5, 8, 0.2))
                                + _old_style("Claude Opus 4.6", (5, 25, 6.25, 10, 0.5)))
    assert models["claude-opus-5-5"]["standard"] == {
        "input": 4, "output": 20, "cache_write_5m": 5, "cache_write_1h": 8, "cache_read": 0.2}
    assert models["claude-opus-4-6"]["standard"]["cache_write_1h"] == 10


def test_long_context_rates_are_their_own_tier():
    models = pricing_sync.parse(_new_style("Claude Haiku 5.5", (0.1, 0.5, 0.125, 0.2, 0.01))
                                + _new_style("Claude Haiku 5.5", (0.5, 2.5, 0.625, 1, 0.05),
                                             long=True))
    assert models["claude-haiku-5-5"]["long"]["input"] == 0.5


def test_a_model_missing_a_rate_is_dropped():
    models = pricing_sync.parse(_new_style("Claude Opus 5.5", (4, 20, 5, 8, 0.2))[:4])
    assert models == {}


@pytest.mark.parametrize("kw", [
    {"feature": "Batch Inference"}, {"unit": "1M TPM Hour"}, {"provider": "Meta"},
])
def test_other_tiers_units_and_providers_are_ignored(kw):
    items = [_item("Claude Opus 5.5", n, 99, **kw)
             for n in ("input_tokens_global_standard", "output_tokens_global_standard",
                       "cache_write_tokens_global_standard",
                       "cache_write_tokens_1h_global_standard",
                       "cache_read_tokens_global_standard")]
    assert pricing_sync.parse(items) == {}


def test_regional_rates_are_not_read_as_global():
    items = [_item("Claude Opus 5", "input_tokens_standard", 5.5)]
    assert pricing_sync.parse(items) == {}


def test_a_result_with_too_few_known_models_is_refused():
    models = pricing_sync.parse(_new_style("Claude Opus 5.5", (4, 20, 5, 8, 0.2)))
    assert "format may have changed" in pricing_sync.refusal(models)
    assert pricing_sync.refusal({}) is not None
    assert pricing_sync.refusal(pricing_sync.parse(_full_list())) is None


@pytest.mark.asyncio
async def test_sync_writes_the_snapshot_and_reports_changes():
    store = FakeS3Store()
    items = _full_list() + _new_style("Claude Opus 4.6", (5, 25, 6.25, 10, 0.5))
    written, report = await pricing_sync.sync(store, "ap-northeast-2", items)
    assert written
    assert "+ claude-opus-4-6" in report
    snap = json.loads(await store.get(pricing.SNAPSHOT_KEY))
    assert snap["region"] == "ap-northeast-2" and "claude-opus-4-6" in snap["models"]


@pytest.mark.asyncio
async def test_a_price_change_is_reported_against_the_previous_snapshot():
    store = FakeS3Store()
    await pricing_sync.sync(store, "ap-northeast-2", _full_list())
    cheaper = [i.replace('"4.0"', '"3.0"') if "Opus 5.5" in i and "input_tokens" in i else i
               for i in _full_list()]
    _written, report = await pricing_sync.sync(store, "ap-northeast-2", cheaper)
    assert "~ claude-opus-5-5 standard input: 4.0 -> 3.0" in report


@pytest.mark.asyncio
async def test_a_refused_or_dry_run_writes_nothing():
    store = FakeS3Store()
    written, report = await pricing_sync.sync(store, "ap-northeast-2", [])
    assert not written and report[0].startswith("refused")
    written, _ = await pricing_sync.sync(store, "ap-northeast-2", _full_list(), dry_run=True)
    assert not written
    with pytest.raises(FileNotFoundError):
        await store.get(pricing.SNAPSHOT_KEY)


def test_main_reports_a_price_list_it_cannot_reach(monkeypatch, capsys):
    def boom(region):
        raise RuntimeError("AccessDenied: pricing:GetProducts")
    monkeypatch.setattr(pricing_sync, "fetch", boom)
    assert pricing_sync.main(["--bucket", "b", "--region", "ap-northeast-2"]) == 1
    assert "AccessDenied" in capsys.readouterr().err


# ---- overlay ----

def test_the_snapshot_overrides_and_extends_the_builtin_table():
    table = pricing.overlay({"models": {
        "claude-opus-5-5": {"standard": {"input": 3, "output": 15, "cache_write_5m": 4,
                                         "cache_write_1h": 6, "cache_read": 0.15}},
        "claude-new-6": {"standard": {"input": 1, "output": 2, "cache_write_5m": 1,
                                      "cache_write_1h": 2, "cache_read": 0.1}},
    }})
    assert table["claude-opus-5-5"].standard.input == 3
    assert table["claude-new-6"].standard.output == 2
    # A model the snapshot lacks keeps its built-in price.
    assert table["claude-sonnet-5-5"] == pricing.PRICES["claude-sonnet-5-5"]


def test_long_rates_need_a_known_threshold():
    rates = {"input": 1, "output": 1, "cache_write_5m": 1, "cache_write_1h": 1, "cache_read": 1}
    table = pricing.overlay({"models": {
        "claude-haiku-5-5": {"standard": rates, "long": {**rates, "input": 5}},
        "claude-new-6": {"standard": rates, "long": rates},
    }})
    assert table["claude-haiku-5-5"].long.input == 5
    assert table["claude-haiku-5-5"].long_threshold == 100_000
    assert table["claude-new-6"].long is None


def test_a_malformed_snapshot_entry_is_skipped():
    table = pricing.overlay({"models": {"claude-opus-5-5": {"standard": {"input": "x"}}}})
    assert table["claude-opus-5-5"] == pricing.PRICES["claude-opus-5-5"]


@pytest.mark.asyncio
async def test_price_table_says_where_its_prices_came_from():
    store = FakeS3Store()
    _table, source = await pricing.price_table(store)
    assert source == {"source": "builtin", "as_of": pricing.BUILTIN_PRICES_AS_OF}
    await pricing_sync.sync(store, "ap-northeast-2", _full_list())
    _table, source = await pricing.price_table(store)
    assert source["source"] == "price_list" and source["region"] == "ap-northeast-2"

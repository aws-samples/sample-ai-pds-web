# backend/aipds/pricing.py — Bedrock on-demand token prices, for the admin cost estimate.
#
# **An estimate, not the bill.** Prices are the AWS Price List API's on-demand rates
# (service AmazonBedrockFoundationModels), in USD per million tokens. Batch, reserved, and
# priority tiers are not here — this deployment calls none of them. Usage is stored as token
# counts (token_usage.py) and cost is computed at read time, so a price change applies to past
# usage too.
#
# **Two layers.** `PRICES` below is the built-in table (ap-northeast-2, read on
# BUILTIN_PRICES_AS_OF). `aipds-update` refreshes a snapshot from the Price List API into
# `pricing/bedrock.json` on every run (aipds/pricing_sync.py), and `price_table` lays it over
# the built-in table: a model the snapshot has uses the snapshot's rates, a model it lacks
# keeps the built-in ones. So a failed or partial refresh degrades to the built-in table,
# never to "no price". The long-context threshold is not in the price list — it stays here.
#
# Why not the CLI's `ResultMessage.total_cost_usd`: it is computed from Anthropic's
# first-party price list, which is not Bedrock's (Sonnet 5.5 cache reads differ, for one),
# and the one-shot Strands calls have no such field at all. One table for every path keeps
# the three sources comparable.
#
# **Global vs regional.** A `global.` inference profile and a regional one (`apac.`, `us.`,
# or a bare model id) are priced differently — the regional rate was 10% higher wherever
# the price list carried both (Opus 5, Sonnet 5). Only global rates are tabled; regional
# usage is the global rate × REGIONAL_MARKUP.
#
# **Long context.** Of the models below only Haiku 5.5 has a long-context tier (every rate
# ×5 once a request's prompt exceeds 100K tokens). Opus and Sonnet are billed at one rate
# up to 1M on Bedrock, so the 1M window this deployment turns on (cli_settings,
# AIPDS_LONG_CONTEXT) adds no premium there. The tier is decided **per API request**, which
# is why token_usage.py meters each request instead of the turn total.
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Literal, Mapping

from aipds.s3store import S3StoreLike

_log = logging.getLogger(__name__)

Tier = Literal["standard", "long"]

#: The token kinds metered per request, in the order the admin screen lists them.
TOKEN_FIELDS = ("input", "output", "cache_write_5m", "cache_write_1h", "cache_read")

#: The regional rate over the global rate (see the header).
REGIONAL_MARKUP = 1.1

#: Suffix token_usage.py adds to a model key for usage that went through a regional endpoint.
REGIONAL_SUFFIX = "#regional"


@dataclass(frozen=True)
class Rates:
    """USD per million tokens."""
    input: float
    output: float
    cache_write_5m: float
    cache_write_1h: float
    cache_read: float


@dataclass(frozen=True)
class ModelPrice:
    standard: Rates
    #: Rates for a request whose prompt exceeds `long_threshold`. None = a single tier.
    long: Rates | None = None
    long_threshold: int | None = None


#: When the built-in table was read from the price list.
BUILTIN_PRICES_AS_OF = "2026-10-29"

#: Key of the refreshed snapshot, relative to the `pricing/` store (aipds/pricing_sync.py).
SNAPSHOT_KEY = "bedrock.json"

PriceTable = Mapping[str, ModelPrice]

#: Keyed by the bare model name — the form the CLI reports in `AssistantMessage.model`.
PRICES: dict[str, ModelPrice] = {
    "claude-fable-5-1": ModelPrice(Rates(10.0, 50.0, 12.5, 20.0, 0.25)),
    "claude-opus-5-5": ModelPrice(Rates(4.0, 20.0, 5.0, 8.0, 0.2)),
    "claude-opus-5": ModelPrice(Rates(5.0, 25.0, 6.25, 10.0, 0.5)),
    "claude-opus-4-8": ModelPrice(Rates(5.0, 25.0, 6.25, 10.0, 0.5)),
    "claude-opus-4-7": ModelPrice(Rates(5.0, 25.0, 6.25, 10.0, 0.5)),
    "claude-sonnet-5-5": ModelPrice(Rates(2.0, 10.0, 2.5, 4.0, 0.1)),
    "claude-sonnet-5": ModelPrice(Rates(2.0, 10.0, 2.5, 4.0, 0.2)),
    "claude-haiku-5-5": ModelPrice(Rates(0.1, 0.5, 0.125, 0.2, 0.01),
                                   long=Rates(0.5, 2.5, 0.625, 1.0, 0.05),
                                   long_threshold=100_000),
    "claude-haiku-4-5": ModelPrice(Rates(1.0, 5.0, 1.25, 2.0, 0.1)),
}

# `global.anthropic.claude-opus-5-5`, `apac.anthropic.claude-sonnet-5-v1:0[1m]`,
# `anthropic.claude-haiku-4-5-20251001-v1:0`, `claude-opus-5-5` → the bare name.
_VERSION_SUFFIX = re.compile(r"(-\d{8})?(-v\d+(:\d+)?)?$")


def base_model(model_id: str) -> str:
    """The bare model name of any id form the deployment or the CLI uses."""
    name = model_id.strip()
    if name.endswith("]") and "[" in name:
        name = name[:name.rindex("[")]
    if "anthropic." in name:
        name = name[name.index("anthropic.") + len("anthropic."):]
    return _VERSION_SUFFIX.sub("", name)


def is_regional(model_id: str | None) -> bool:
    """Whether a configured model id goes through a regional endpoint. None (env default) → global,
    which is what the deployment default is (MODEL in infra/lib/backend-permissions.ts)."""
    return bool(model_id) and not model_id.strip().startswith("global.")


def tier_of(model: str, prompt_tokens: int) -> Tier:
    price = PRICES.get(base_model(model))
    if price is None or price.long is None or price.long_threshold is None:
        return "standard"
    return "long" if prompt_tokens > price.long_threshold else "standard"


def cost_usd(model_key: str, tier: str, counts: dict,
             prices: PriceTable = PRICES) -> float | None:
    """Cost of one (model key, tier) bucket. None if the model is not in the table."""
    regional = model_key.endswith(REGIONAL_SUFFIX)
    name = model_key[:-len(REGIONAL_SUFFIX)] if regional else model_key
    price = prices.get(base_model(name))
    if price is None:
        return None
    rates = price.long if tier == "long" and price.long is not None else price.standard
    total = sum(int(counts.get(f, 0)) * getattr(rates, f) for f in TOKEN_FIELDS) / 1_000_000
    return total * REGIONAL_MARKUP if regional else total


def _rates(raw: Any) -> Rates | None:
    if not isinstance(raw, dict):
        return None
    try:
        values = {f: float(raw[f]) for f in TOKEN_FIELDS}
    except (KeyError, TypeError, ValueError):
        return None
    return Rates(**values) if all(v >= 0 for v in values.values()) else None


def overlay(snapshot: dict | None) -> dict[str, ModelPrice]:
    """The built-in table with a snapshot's models laid over it (see the header).

    A snapshot model with long-context rates gets the built-in threshold; without a known
    threshold those rates cannot be applied, so the model is priced at one tier.
    """
    table = dict(PRICES)
    models = (snapshot or {}).get("models")
    if not isinstance(models, dict):
        return table
    for name, entry in models.items():
        standard = _rates((entry or {}).get("standard")) if isinstance(entry, dict) else None
        if standard is None:
            continue
        builtin = PRICES.get(name)
        threshold = builtin.long_threshold if builtin else None
        long = _rates(entry.get("long")) if threshold is not None else None
        table[name] = ModelPrice(standard, long=long,
                                 long_threshold=threshold if long is not None else None)
    return table


async def load_snapshot(s3: S3StoreLike) -> dict | None:
    """The refreshed snapshot. None if there is none or it is unreadable."""
    try:
        data = json.loads(await s3.get(SNAPSHOT_KEY))
    except FileNotFoundError:
        return None
    except Exception:
        _log.warning("unreadable price snapshot: %s", SNAPSHOT_KEY, exc_info=True)
        return None
    return data if isinstance(data, dict) else None


async def price_table(s3: S3StoreLike | None) -> tuple[dict[str, ModelPrice], dict]:
    """The table to price with, and where it came from (shown on the admin screen)."""
    snapshot = await load_snapshot(s3) if s3 is not None else None
    if snapshot is None:
        return dict(PRICES), {"source": "builtin", "as_of": BUILTIN_PRICES_AS_OF}
    return overlay(snapshot), {"source": "price_list",
                               "as_of": snapshot.get("fetched_at"),
                               "region": snapshot.get("region")}

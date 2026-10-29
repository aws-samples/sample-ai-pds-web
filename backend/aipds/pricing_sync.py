# backend/aipds/pricing_sync.py — refresh the Bedrock price snapshot from the AWS Price List API.
#
#   python -m aipds.pricing_sync --bucket <bucket> --region <region> [--dry-run]
#
# `aipds-update` runs this on every update (infra/scripts/aipds-update), and the admin usage
# screen prices with the result (aipds/pricing.py lays it over the built-in table). Nothing
# restarts: cost is computed at read time, so the next page load uses the new prices.
#
# **What is read.** On-demand, `global.` inference-profile rates for Anthropic models in the
# deployment region — the profiles this deployment calls (backend-permissions.ts). Two
# generations of usage types are in the list, and both are parsed:
#   older:  InputTokenCount_Global, CacheWrite1hInputTokenCount_Global, ...
#   newer:  input_tokens_global_standard, cache_write_tokens_1h_long_ctx_global_standard, ...
# A model is kept only if all five rates of its standard tier were found — a partial model
# would price some token kinds at zero, which is worse than the built-in rate.
#
# **When nothing is written.** If no model parses, or fewer than half of the built-in table's
# models are found, the price list's format has probably moved under the parser: the run
# fails (exit 1) and the previous snapshot stays. `aipds-update` reports that and carries on —
# a price refresh must never block a code update.
#
# This module does not import aipds.app: it runs outside the backend process, without the
# backend's environment (Cognito settings and the rest).
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from datetime import datetime, timezone
from typing import Any, Iterable

import boto3

from aipds import pricing
from aipds.s3store import S3Store, S3StoreLike

#: The Price List API is served from a few regions only; us-east-1 answers for every region.
PRICE_LIST_REGION = "us-east-1"
SERVICE_CODE = "AmazonBedrockFoundationModels"

_NEW = re.compile(r"(input|output|cache_read|cache_write)_tokens(_1h)?(_long_ctx)?_global_standard")
_OLD = re.compile(r"(Input|Output|CacheReadInput|CacheWriteInput|CacheWrite1hInput)TokenCount_Global")
_OLD_FIELD = {"Input": "input", "Output": "output", "CacheReadInput": "cache_read",
              "CacheWriteInput": "cache_write_5m", "CacheWrite1hInput": "cache_write_1h"}


def _field(usagetype: str) -> tuple[str, str] | None:
    """`APN2-MP:APN2_input_tokens_global_standard-Units` → ("standard", "input"). None = not ours."""
    name = usagetype.split(":", 1)[-1]
    name = name.split("_", 1)[1] if "_" in name else name  # drop the region code
    if name.endswith("-Units"):
        name = name[:-len("-Units")]
    m = _NEW.fullmatch(name)
    if m:
        kind, one_hour, long_ctx = m.groups()
        field = {"cache_write": "cache_write_1h" if one_hour else "cache_write_5m"}.get(kind, kind)
        if one_hour and kind != "cache_write":
            return None
        return ("long" if long_ctx else "standard", field)
    m = _OLD.fullmatch(name)
    if m:
        return ("standard", _OLD_FIELD[m.group(1)])
    return None


def model_name(display: str) -> str:
    """`Claude Opus 5.5` → `claude-opus-5-5` (the bare name pricing.py keys on)."""
    return re.sub(r"[\s.]+", "-", display.strip().lower())


def parse(price_list: Iterable[Any]) -> dict[str, dict[str, dict[str, float]]]:
    """Price List entries → {model: {"standard": rates, "long"?: rates}}, complete tiers only."""
    found: dict[str, dict[str, dict[str, float]]] = {}
    for item in price_list:
        d = json.loads(item) if isinstance(item, str) else item
        attrs = d.get("product", {}).get("attributes", {})
        if attrs.get("provider") != "Anthropic" or attrs.get("feature") != "On-demand Inference":
            continue
        hit = _field(attrs.get("usagetype", ""))
        if hit is None or not attrs.get("model"):
            continue
        tier, field = hit
        for term in d.get("terms", {}).get("OnDemand", {}).values():
            for dim in term.get("priceDimensions", {}).values():
                if dim.get("unit") != "1M tokens":
                    continue
                try:
                    usd = float(dim["pricePerUnit"]["USD"])
                except (KeyError, TypeError, ValueError):
                    continue
                found.setdefault(model_name(attrs["model"]), {}) \
                     .setdefault(tier, {})[field] = usd
    complete: dict[str, dict[str, dict[str, float]]] = {}
    for name, tiers in found.items():
        kept = {t: r for t, r in tiers.items() if set(r) == set(pricing.TOKEN_FIELDS)}
        if "standard" in kept:
            complete[name] = kept
    return complete


def refusal(models: dict) -> str | None:
    """Why this result must not be written. None if it is fine."""
    if not models:
        return "no Anthropic on-demand price parsed"
    known = [m for m in pricing.PRICES if m in models]
    if len(known) * 2 < len(pricing.PRICES):
        return (f"only {len(known)} of {len(pricing.PRICES)} built-in models found "
                "— the price list format may have changed")
    return None


def changes(previous: dict | None, models: dict) -> list[str]:
    """Human-readable differences from the previous snapshot (or the built-in table)."""
    before = pricing.overlay(previous) if previous else pricing.PRICES
    lines: list[str] = []
    for name in sorted(models):
        old = before.get(name)
        new = pricing.overlay({"models": {name: models[name]}})[name]
        if old is None:
            lines.append(f"+ {name}")
            continue
        for tier in ("standard", "long"):
            a, b = getattr(old, tier), getattr(new, tier)
            for f in pricing.TOKEN_FIELDS:
                va, vb = (getattr(a, f) if a else None), (getattr(b, f) if b else None)
                if va != vb:
                    lines.append(f"~ {name} {tier} {f}: {va} -> {vb}")
    for name, tiers in models.items():
        if "long" in tiers and (pricing.PRICES.get(name) is None
                                or pricing.PRICES[name].long_threshold is None):
            lines.append(f"! {name} has long-context rates but no known threshold "
                         "(pricing.PRICES) — priced at the standard rate")
    return lines


def fetch(region: str, client: Any = None) -> list[Any]:
    client = client or boto3.client("pricing", region_name=PRICE_LIST_REGION)
    items: list[Any] = []
    for page in client.get_paginator("get_products").paginate(
            ServiceCode=SERVICE_CODE,
            Filters=[{"Type": "TERM_MATCH", "Field": "regionCode", "Value": region}]):
        items.extend(page.get("PriceList", []))
    return items


async def sync(store: S3StoreLike, region: str, price_list: list[Any],
               dry_run: bool = False) -> tuple[bool, list[str]]:
    """Parse, check, and write. Returns (written, report lines)."""
    models = parse(price_list)
    reason = refusal(models)
    if reason:
        return False, [f"refused: {reason}"]
    previous = await pricing.load_snapshot(store)
    report = changes(previous, models) or ["no price changes"]
    if dry_run:
        return False, report
    snapshot = {
        "source": "aws-price-list",
        "service": SERVICE_CODE,
        "region": region,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "models": models,
    }
    await store.put(pricing.SNAPSHOT_KEY, json.dumps(snapshot, ensure_ascii=False, indent=1))
    return True, [f"{len(models)} models", *report]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="aipds.pricing_sync", description=__doc__)
    ap.add_argument("--bucket", required=True)
    ap.add_argument("--region", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    try:
        price_list = fetch(args.region)
    except Exception as e:  # permissions, network — reported, never raised into aipds-update
        print(f"pricing_sync: price list unavailable: {e}", file=sys.stderr)
        return 1
    store = S3Store(bucket=args.bucket, prefix="pricing/",
                    client=boto3.client("s3", region_name=args.region))
    try:
        written, report = asyncio.run(sync(store, args.region, price_list, args.dry_run))
    except Exception as e:
        print(f"pricing_sync: snapshot write failed: {e}", file=sys.stderr)
        return 1
    for line in report:
        print(f"pricing_sync: {line}")
    return 0 if written or args.dry_run else 1


if __name__ == "__main__":
    sys.exit(main())

# backend/aipds/routes/usage.py — token usage and estimated cost per project (admins).
#
#   GET /admin/usage?page=&size=  — projects' usage, most expensive first, one page
#   GET /admin/usage/{pid}        — one project's usage (the project dashboard's cost card)
#
# Admin only, by the router (the same discipline as admin_users.py). A project's owner does
# not see its cost: cost is an operating concern of the deployment, not of the workshop
# participant.
#
# The counts come from each project's `usage/tokens.json` (aipds/token_usage.py) and the
# cost from aipds/pricing.py at read time — the refreshed price snapshot over the built-in
# table, read once per request. A project whose record cannot be read shows as
# zero instead of failing the page — the screen is a report, and one bad file must not hide
# all the others.
#
# **The list reads every project, then pages.** The order is by cost, and cost is only known
# once a project's record is read — paging first would sort each page on its own and put the
# most expensive project wherever the registry happened to list it.
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query

from aipds import pricing, token_usage
from aipds.auth.deps import require_admin

admin_router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


async def _prices() -> tuple[pricing.PriceTable, dict]:
    import aipds.app as app_module
    durable = app_module.durable_projects_enabled()
    return await pricing.price_table(app_module.pricing_root_s3_factory() if durable else None)


async def _project_usage(pid: str, prices: pricing.PriceTable) -> dict:
    import aipds.app as app_module
    data = None
    if app_module.durable_projects_enabled():
        data = await token_usage.load_usage(app_module.s3_store_factory(pid))
    return token_usage.summarize(data, prices)


def _row(pid: str, usage: dict) -> dict:
    import aipds.app as app_module
    registry = app_module.registry
    return {"project_id": pid, "name": registry.get_name(pid),
            "owner": registry.get_owner(pid),
            "created_at": registry.get_created_at(pid),
            "model_id": registry.get_model_id(pid),
            "usage": usage}


@admin_router.get("/usage")
async def admin_usage(page: int = Query(1, ge=1), size: int = Query(10, ge=1, le=50)):
    import aipds.app as app_module
    ids = app_module.registry.list_ids()
    prices, source = await _prices()
    summaries = await asyncio.gather(*(_project_usage(pid, prices) for pid in ids))
    rows = sorted((_row(pid, usage) for pid, usage in zip(ids, summaries)),
                  key=lambda r: r["usage"]["cost_usd"], reverse=True)
    return {
        "projects": rows[(page - 1) * size: page * size],
        "total": len(rows),
        "page": page,
        "size": size,
        # Shown next to the numbers: the cost is the on-demand list price, not the bill.
        "estimate": True,
        # Where the prices came from: {"source": "price_list"|"builtin", "as_of", "region"?}.
        "pricing": source,
    }


@admin_router.get("/usage/{pid}")
async def admin_project_usage(pid: str):
    import aipds.app as app_module
    # Only registered projects — an arbitrary id would otherwise become an S3 key prefix.
    if not app_module.registry.is_registered(pid):
        raise HTTPException(status_code=404, detail="project not found")
    prices, source = await _prices()
    return {**_row(pid, await _project_usage(pid, prices)),
            "estimate": True, "pricing": source}

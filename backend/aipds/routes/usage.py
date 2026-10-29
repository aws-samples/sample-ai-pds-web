# backend/aipds/routes/usage.py — token usage and estimated cost per project (admins).
#
#   GET /admin/usage — every registered project's usage, plus the grand total
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
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends

from aipds import pricing, token_usage
from aipds.auth.deps import require_admin

admin_router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


async def _project_usage(pid: str, prices: pricing.PriceTable) -> dict:
    import aipds.app as app_module
    data = None
    if app_module.durable_projects_enabled():
        data = await token_usage.load_usage(app_module.s3_store_factory(pid))
    return token_usage.summarize(data, prices)


@admin_router.get("/usage")
async def admin_usage():
    import aipds.app as app_module
    registry = app_module.registry
    ids = registry.list_ids()
    durable = app_module.durable_projects_enabled()
    prices, source = await pricing.price_table(
        app_module.pricing_root_s3_factory() if durable else None)
    summaries = await asyncio.gather(*(_project_usage(pid, prices) for pid in ids))
    projects = [
        {"project_id": pid, "name": registry.get_name(pid),
         "owner": registry.get_owner(pid),
         "created_at": registry.get_created_at(pid),
         "model_id": registry.get_model_id(pid),
         "usage": usage}
        for pid, usage in zip(ids, summaries)
    ]
    return {
        "projects": projects,
        "total": token_usage.combine([p["usage"] for p in projects]),
        # Shown next to the numbers: the cost is the on-demand list price, not the bill.
        "estimate": True,
        # Where the prices came from: {"source": "price_list"|"builtin", "as_of", "region"?}.
        "pricing": source,
    }


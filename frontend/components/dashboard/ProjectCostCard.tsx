"use client";
// The project dashboard's cost card — admins only.
//
// The role comes from /api/auth/me, the same source UserMenu reads (the token is an httpOnly
// cookie). The usage call is made only for an admin: a pm would get a 403 from
// /admin/usage/{pid} anyway, but asking first keeps every pm dashboard load from logging a
// refused request. The backend is still the gate — this check only decides what to draw.
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/provider";
import { getProjectUsage, totalTokens, type ProjectUsageReport } from "@/lib/api/usage";
import { UsageBreakdown, pricingLine, useUsageFormat } from "@/components/usage/UsageBreakdown";

export function ProjectCostCard({ projectId }: { projectId: string }) {
  const t = useT();
  const f = useUsageFormat();
  const [report, setReport] = useState<ProjectUsageReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const me = await fetch("/api/auth/me", { credentials: "include" });
        const body = me.ok ? await me.json() : null;
        if (!alive || body?.role !== "admin") return;
        const usage = await getProjectUsage(projectId);
        if (alive) setReport(usage);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  if (failed) {
    return <p className="mb-8 text-xs text-slate-400">{t("usage.loadFailed")}</p>;
  }
  if (report === null) return null;
  const u = report.usage;

  return (
    <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5"
             aria-label={t("usage.dashTitle")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            {t("usage.dashTitle")} · <span className="text-slate-400">{t("usage.dashAdminOnly")}</span>
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{f.usd(u.cost_usd)}</p>
          <p className="mt-1 text-xs text-slate-500">
            {t("usage.colTokens")} {f.num(totalTokens(u))} · {t("usage.colRequests")}{" "}
            {f.num(u.requests)} · {t("usage.colCacheHit")} {f.pct(u.cache_hit_rate)}
          </p>
          <p className="mt-1 text-xs text-slate-400">{pricingLine(t, report.pricing)}</p>
        </div>
        {u.requests > 0 && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="shrink-0 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            {open ? t("usage.dashHide") : t("usage.dashShow")}
          </button>
        )}
      </div>
      {(open || u.requests === 0) && (
        <div className="mt-4">
          <UsageBreakdown usage={u} />
        </div>
      )}
    </section>
  );
}

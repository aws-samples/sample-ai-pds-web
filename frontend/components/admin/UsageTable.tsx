"use client";
import { Fragment, useState } from "react";
import { useT } from "@/lib/i18n/provider";
import { totalTokens, type ProjectUsage } from "@/lib/api/usage";
import { UsageBreakdown, useUsageFormat } from "@/components/usage/UsageBreakdown";

// Rows arrive already sorted by cost (the backend sorts across every page). No total row:
// the screen answers "what does each project cost", and a total of one page would mislead.
export function UsageTable({ projects }: { projects: ProjectUsage[] }) {
  const t = useT();
  const f = useUsageFormat();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500">
        <tr className="border-b border-slate-200">
          <th className="py-2 font-medium">{t("usage.colProject")}</th>
          <th className="py-2 font-medium">{t("usage.colOwner")}</th>
          <th className="py-2 text-right font-medium">{t("usage.colRequests")}</th>
          <th className="py-2 text-right font-medium">{t("usage.colTokens")}</th>
          <th className="py-2 text-right font-medium" title={t("usage.cacheHitHelp")}>
            {t("usage.colCacheHit")}
          </th>
          <th className="py-2 text-right font-medium">{t("usage.colCost")}</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((p) => (
          <Fragment key={p.project_id}>
            <tr
              className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
              onClick={() => setOpen(open === p.project_id ? null : p.project_id)}
              aria-expanded={open === p.project_id}
            >
              <td className="py-3">
                <div className="font-medium">{p.name ?? p.project_id}</div>
                <div className="text-xs text-slate-400">{p.project_id}</div>
              </td>
              <td className="py-3 text-slate-600">{p.owner ?? "—"}</td>
              <td className="py-3 text-right tabular-nums">{f.num(p.usage.requests)}</td>
              <td className="py-3 text-right tabular-nums">{f.num(totalTokens(p.usage))}</td>
              <td className="py-3 text-right tabular-nums">{f.pct(p.usage.cache_hit_rate)}</td>
              <td className="py-3 text-right font-medium tabular-nums">{f.usd(p.usage.cost_usd)}</td>
            </tr>
            {open === p.project_id && (
              <tr className="border-b border-slate-100 bg-slate-50">
                <td colSpan={6} className="px-4 py-4">
                  <UsageBreakdown usage={p.usage} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

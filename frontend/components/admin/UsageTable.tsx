"use client";
import { Fragment, useMemo, useState } from "react";
import type { Dict } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/provider";
import {
  TOKEN_FIELDS, USAGE_SOURCES, totalTokens,
  type ProjectUsage, type TokenField, type UsageBucket, type UsageReport, type UsageSource,
} from "@/lib/api/usage";

const SOURCE_KEY: Record<UsageSource, keyof Dict> = {
  discovery: "usage.sourceDiscovery",
  prototype: "usage.sourcePrototype",
  survey: "usage.sourceSurvey",
  handoff: "usage.sourceHandoff",
};

const FIELD_KEY: Record<TokenField, keyof Dict> = {
  input: "usage.fieldInput",
  output: "usage.fieldOutput",
  cache_write_5m: "usage.fieldCacheWrite5m",
  cache_write_1h: "usage.fieldCacheWrite1h",
  cache_read: "usage.fieldCacheRead",
};

const REGIONAL = "#regional";

function useFormat() {
  const locale = useLocale();
  return useMemo(() => {
    const num = new Intl.NumberFormat(locale);
    const usd = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
    return {
      num: (n: number) => num.format(n),
      // Under a cent rounds to $0.00, which reads as "free" — say "< $0.01" instead.
      usd: (n: number) => (n > 0 && n < 0.01 ? `< ${usd.format(0.01)}` : usd.format(n)),
      pct: (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`),
    };
  }, [locale]);
}

export function UsageTable({ report }: { report: UsageReport }) {
  const t = useT();
  const f = useFormat();
  const [open, setOpen] = useState<string | null>(null);
  // Most expensive first — the question this screen answers is "where is the money going".
  const rows = useMemo(
    () => [...report.projects].sort((a, b) => b.usage.cost_usd - a.usage.cost_usd),
    [report.projects],
  );

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
        {rows.map((p) => (
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
                  <ProjectDetail project={p} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-slate-200 font-semibold">
          <td className="py-3" colSpan={2}>{t("usage.total")}</td>
          <td className="py-3 text-right tabular-nums">{f.num(report.total.requests)}</td>
          <td className="py-3 text-right tabular-nums">{f.num(totalTokens(report.total))}</td>
          <td className="py-3 text-right tabular-nums">{f.pct(report.total.cache_hit_rate)}</td>
          <td className="py-3 text-right tabular-nums">{f.usd(report.total.cost_usd)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function ProjectDetail({ project }: { project: ProjectUsage }) {
  const t = useT();
  const f = useFormat();
  const u = project.usage;
  if (u.requests === 0) {
    return <p className="text-sm text-slate-500">{t("usage.noUsage")}</p>;
  }
  const sources = USAGE_SOURCES.filter((s) => u.by_source[s]);
  const models = Object.entries(u.by_model).sort(([, a], [, b]) => b.cost_usd - a.cost_usd);

  return (
    <div className="space-y-4">
      <BucketTable
        title={t("usage.bySource")}
        rows={sources.map((s) => [t(SOURCE_KEY[s]), u.by_source[s] as UsageBucket])}
        format={f}
      />
      <BucketTable
        title={t("usage.byModel")}
        rows={models.map(([key, b]) => [
          key.endsWith(REGIONAL)
            ? `${key.slice(0, -REGIONAL.length)} (${t("usage.regional")})`
            : key,
          b,
        ])}
        format={f}
      />
      {u.unpriced_models.length > 0 && (
        <p className="text-xs text-amber-700">
          {t("usage.unpriced").replace("{models}", u.unpriced_models.join(", "))}
        </p>
      )}
      {u.long_context_requests > 0 && (
        <p className="text-xs text-slate-500">
          {t("usage.longContext").replace("{n}", f.num(u.long_context_requests))}
        </p>
      )}
    </div>
  );
}

function BucketTable({
  title, rows, format: f,
}: {
  title: string;
  rows: [string, UsageBucket][];
  format: ReturnType<typeof useFormat>;
}) {
  const t = useT();
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold text-slate-600">{title}</h3>
      <table className="w-full text-xs">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-1 font-medium" />
            <th className="py-1 text-right font-medium">{t("usage.colRequests")}</th>
            {TOKEN_FIELDS.map((k) => (
              <th key={k} className="py-1 text-right font-medium">{t(FIELD_KEY[k])}</th>
            ))}
            <th className="py-1 text-right font-medium">{t("usage.colCacheHit")}</th>
            <th className="py-1 text-right font-medium">{t("usage.colCost")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, b]) => (
            <tr key={label} className="border-t border-slate-200">
              <td className="py-1">{label}</td>
              <td className="py-1 text-right tabular-nums">{f.num(b.requests)}</td>
              {TOKEN_FIELDS.map((k) => (
                <td key={k} className="py-1 text-right tabular-nums">{f.num(b.tokens[k])}</td>
              ))}
              <td className="py-1 text-right tabular-nums">{f.pct(b.cache_hit_rate)}</td>
              <td className="py-1 text-right tabular-nums">{f.usd(b.cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

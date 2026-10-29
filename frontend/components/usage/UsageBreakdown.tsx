"use client";
// Pieces shared by the admin usage table and the project dashboard's cost card: number
// formatting, the per-feature breakdown, and the "where the prices came from" line.
import { useMemo } from "react";
import type { Dict } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/provider";
import {
  TOKEN_FIELDS, USAGE_SOURCES,
  type PricingSource, type ProjectUsageSummary, type TokenField, type UsageSource,
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

export type UsageFormat = ReturnType<typeof useUsageFormat>;

export function useUsageFormat() {
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

export function pricingLine(t: (key: keyof Dict) => string, p: PricingSource): string {
  const date = (p.as_of ?? "").slice(0, 10);
  return p.source === "price_list"
    ? t("usage.pricingPriceList").replace("{date}", date).replace("{region}", p.region ?? "")
    : t("usage.pricingBuiltin").replace("{date}", date);
}

/** Per-feature rows of one project, plus the notes about unpriced models and long context. */
export function UsageBreakdown({ usage }: { usage: ProjectUsageSummary }) {
  const t = useT();
  const f = useUsageFormat();
  if (usage.requests === 0) {
    return <p className="text-sm text-slate-500">{t("usage.noUsage")}</p>;
  }
  const sources = USAGE_SOURCES.filter((s) => usage.by_source[s]);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1 font-medium">{t("usage.bySource")}</th>
              <th className="py-1 text-right font-medium">{t("usage.colRequests")}</th>
              {TOKEN_FIELDS.map((k) => (
                <th key={k} className="py-1 text-right font-medium">{t(FIELD_KEY[k])}</th>
              ))}
              <th className="py-1 text-right font-medium">{t("usage.colCacheHit")}</th>
              <th className="py-1 text-right font-medium">{t("usage.colCost")}</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => {
              const b = usage.by_source[s]!;
              return (
                <tr key={s} className="border-t border-slate-200">
                  <td className="py-1">{t(SOURCE_KEY[s])}</td>
                  <td className="py-1 text-right tabular-nums">{f.num(b.requests)}</td>
                  {TOKEN_FIELDS.map((k) => (
                    <td key={k} className="py-1 text-right tabular-nums">{f.num(b.tokens[k])}</td>
                  ))}
                  <td className="py-1 text-right tabular-nums">{f.pct(b.cache_hit_rate)}</td>
                  <td className="py-1 text-right tabular-nums">{f.usd(b.cost_usd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {usage.unpriced_models.length > 0 && (
        <p className="text-xs text-amber-700">
          {t("usage.unpriced").replace("{models}", usage.unpriced_models.join(", "))}
        </p>
      )}
      {usage.long_context_requests > 0 && (
        <p className="text-xs text-slate-500">
          {t("usage.longContext").replace("{n}", f.num(usage.long_context_requests))}
        </p>
      )}
    </div>
  );
}

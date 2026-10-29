"use client";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { UsageTable } from "@/components/admin/UsageTable";
import { ApiError } from "@/lib/api/client";
import { getUsageReport, type PricingSource, type UsageReport } from "@/lib/api/usage";
import type { Dict } from "@/lib/i18n";
import { useT } from "@/lib/i18n/provider";

function pricingLine(t: (key: keyof Dict) => string, p: PricingSource): string {
  const date = (p.as_of ?? "").slice(0, 10);
  return p.source === "price_list"
    ? t("usage.pricingPriceList").replace("{date}", date).replace("{region}", p.region ?? "")
    : t("usage.pricingBuiltin").replace("{date}", date);
}

export default function AdminUsagePage() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const t = useT();
  const reload = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setReport(await getUsageReport());
    } catch (err) {
      // Same as the other admin pages: a 403 is a pm who typed the URL — the backend is the real gate.
      setError(err instanceof ApiError && err.status === 403
        ? t("admin.needAdmin")
        : t("usage.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void reload(); }, [reload]);

  return (
    <>
      <AppHeader activeTab="projects" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t("usage.title")}</h1>
            <p className="mt-1 text-sm text-slate-500">{t("usage.subtitle")}</p>
            {report !== null && (
              <p className="mt-1 text-xs text-slate-400">{pricingLine(t, report.pricing)}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {t("usage.refresh")}
          </button>
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        )}
        {loading && report === null && (
          <p className="text-sm text-slate-400">{t("admin.commonLoading")}</p>
        )}
        {report !== null && report.projects.length === 0 && (
          <p className="text-sm text-slate-500">{t("usage.noProjects")}</p>
        )}
        {report !== null && report.projects.length > 0 && (
          <>
            <UsageTable report={report} />
            {report.total.unpriced_models.length > 0 && (
              <p className="mt-3 text-xs text-amber-700">
                {t("usage.unpriced").replace("{models}", report.total.unpriced_models.join(", "))}
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}

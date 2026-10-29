"use client";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { UsageTable } from "@/components/admin/UsageTable";
import { pricingLine } from "@/components/usage/UsageBreakdown";
import { ApiError } from "@/lib/api/client";
import { getUsageReport, type UsageReport } from "@/lib/api/usage";
import { useT } from "@/lib/i18n/provider";

const PAGE_SIZE = 10;

export default function AdminUsagePage() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const t = useT();
  const load = useCallback(async (target: number) => {
    setError(null);
    setLoading(true);
    try {
      const next = await getUsageReport(target, PAGE_SIZE);
      // A page past the end (projects deleted since the last load) falls back to the last page.
      const last = Math.max(1, Math.ceil(next.total / next.size));
      if (target > last) {
        setPage(last);
        return;
      }
      setReport(next);
    } catch (err) {
      // Same as the other admin pages: a 403 is a pm who typed the URL — the backend is the real gate.
      setError(err instanceof ApiError && err.status === 403
        ? t("admin.needAdmin")
        : t("usage.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(page); }, [load, page]);

  const totalPages = report ? Math.max(1, Math.ceil(report.total / report.size)) : 1;

  return (
    <>
      <AppHeader activeTab="projects" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{t("usage.title")}</h1>
            <p className="mt-1 text-sm text-slate-500">{t("usage.subtitle")}</p>
            {report !== null && (
              <p className="mt-1 text-xs text-slate-400">{pricingLine(t, report.pricing)}</p>
            )}
          </div>
          {/* shrink-0: the subtitle is long, and without it flex squeezes the button. */}
          <button
            type="button"
            onClick={() => void load(page)}
            disabled={loading}
            className="shrink-0 whitespace-nowrap rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
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
        {report !== null && report.total === 0 && (
          <p className="text-sm text-slate-500">{t("usage.noProjects")}</p>
        )}
        {report !== null && report.total > 0 && (
          <>
            <UsageTable projects={report.projects} />
            {/* Same pager as the project list (components/ProjectList.tsx). */}
            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>{t("project.totalCount").replace("{n}", String(report.total))}</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label={t("project.prevPageAria")}
                  disabled={page <= 1 || loading}
                  onClick={() => setPage(page - 1)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                >
                  {t("project.prevPage")}
                </button>
                <span>{report.page} / {totalPages}</span>
                <button
                  type="button"
                  aria-label={t("project.nextPageAria")}
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage(page + 1)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                >
                  {t("project.nextPage")}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}

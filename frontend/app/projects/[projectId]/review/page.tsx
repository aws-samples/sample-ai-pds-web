"use client";
import { use, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { DocTree } from "@/components/review/DocTree";
import { DocumentPanel } from "@/components/review/DocumentPanel";
import { ApprovalStatus } from "@/components/review/ApprovalStatus";
import { VerificationSummary } from "@/components/review/VerificationSummary";
import { DocChanges } from "@/components/DocChanges";
import {
  listArtifacts,
  readArtifact,
  getAudit,
  listApprovalGates,
  downloadArtifactsArchive,
  getMissingReferences,
  ApiError,
} from "@/lib/api/client";
import { useAsync } from "@/lib/useAsync";
import { useProjectMeta } from "@/lib/useProjectModel";
import { useT } from "@/lib/i18n/provider";

// Client-side Blob download — saves the currently loaded markdown without a
// backend round trip.
function downloadMarkdown(path: string, content: string) {
  const name = path.slice(path.lastIndexOf("/") + 1) || "document.md";
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Zip download of all artifacts (aiplc-docs/**) — needs a backend round trip
// (unlike an individual .md, the server assembles the archive).
async function downloadZip(projectId: string) {
  const blob = await downloadArtifactsArchive(projectId);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectId}-artifacts.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const t = useT();
  const { modelLabel, language, readOnly } = useProjectMeta(projectId);

  const tree = useAsync(() => listArtifacts(projectId), [projectId]);
  const audit = useAsync(() => getAudit(projectId), [projectId]);
  // Where each stage's approval stands, read from the approval question files (backend aipds/approval_gates.py).
  // The screen reports it; approvals are answered in the workspace (components/review/ApprovalStatus.tsx header).
  // Re-read with the tree poll below, so an approval answered in another tab shows up here.
  const approvalGates = useAsync(() => listApprovalGates(projectId), [projectId]);

  // Default selection: once the artifact tree loads, select
  // discovery-document.md if present. Guarded by `selected === null` so a
  // later tree reload (e.g. after an approval turn) never clobbers the
  // user's own choice.
  useEffect(() => {
    if (selected !== null || !tree.data) return;
    const doc = tree.data.find((p) => p.endsWith("discovery-document.md"));
    if (doc) setSelected(doc);
  }, [tree.data, selected]);

  // A 404 file is treated as an empty document, not an error; any other
  // error must still surface (not be coalesced into the empty-doc state).
  const content = useAsync(
    () =>
      selected === null
        ? Promise.resolve("")
        : readArtifact(projectId, selected).catch((e) =>
            e instanceof ApiError && e.status === 404 ? "" : Promise.reject(e),
          ),
    [projectId, selected],
  );

  const contentLoadError = selected !== null && content.error !== null;
  const auditPath = tree.data?.find((p) => p.endsWith("aiplc-docs/audit.md")) ?? null;
  const isDiscoveryDocument = selected?.endsWith("discovery-document.md") ?? false;

  // Files that the entry document handed to the development org cites as evidence
  // but that do not exist. Surfaced right before the full download — the upstream
  // template has the reference written whether or not the file exists, so if no
  // one checks, it is handed over with broken links (backend
  // parsers/doc_references). Re-queried only when the list changes: tree.data is
  // a new array on every 5-second poll.
  const artifactsKey = (tree.data ?? []).join("\n");
  const missingRefs = useAsync(
    () => isDiscoveryDocument ? getMissingReferences(projectId) : Promise.resolve(null),
    [projectId, isDiscoveryDocument, artifactsKey, content.data],
  );
  const missing = missingRefs.data?.missing ?? [];

  // Destination of the change-request link — navigates to the workspace chat and
  // passes a draft containing the document name via ?draft=.
  const docName = selected ? selected.slice(selected.lastIndexOf("/") + 1) : "discovery-document.md";
  const reviseHref = `/projects/${projectId}/workspace?draft=${encodeURIComponent(`${docName} ${t("page.reviseDraftSuffix")}`)}`;

  // Auto-refresh the artifact list (spec: new documents should appear without
  // a manual reload). This route has no SSE stream — documents can be created
  // from the workspace chat or an async turn — so a gentle poll is the only
  // cross-route signal available. `tree.reload()` preserves the user's current
  // selection (the default-selection effect is guarded on `selected === null`),
  // and DocTree doesn't gate on `tree.loading`, so a reload never flashes the
  // pane empty. The approval status rides the same poll: an approval question
  // answered in the workspace tab shows up here without a reload.
  //
  // Also paused while the tab is hidden: a review tab left open behind the
  // workspace would otherwise list the bucket every 5s for nobody. Coming back
  // reloads once immediately, so the list is never a full interval stale.
  const reloadApprovals = approvalGates.reload;
  useEffect(() => {
    const refresh = () => {
      tree.reload();
      reloadApprovals();
    };
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id === null) id = setInterval(refresh, 5000);
    };
    const stop = () => {
      if (id !== null) clearInterval(id);
      id = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        refresh();
        start();
      }
    };
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tree.reload, reloadApprovals]);

  return (
    <>
      <AppHeader activeTab="review" projectId={projectId} modelLabel={modelLabel}
                 projectLanguage={language} readOnly={readOnly} />
      <main className="max-w-[1720px] mx-auto px-6 py-8">
        {/* Status only — approvals are answered in the workspace. Viewers see it too, without the links. */}
        {isDiscoveryDocument && !contentLoadError && (
          <ApprovalStatus
            gates={approvalGates.data ?? []}
            workspaceHref={`/projects/${encodeURIComponent(projectId)}/workspace`}
            reviseHref={reviseHref}
            readOnly={readOnly}
          />
        )}
        {actionError && <p className="text-sm text-rose-600 mb-4">{actionError}</p>}

        {/* Width: at max width (1720px), file list ≈330 · body ≈1015 · validation
            summary ≈275px. Minimum widths are set on the ratios so that on narrow
            lg screens they do not drop below 240px and 220px. */}
        <div className="grid lg:grid-cols-[minmax(240px,20%)_1fr] gap-6">
          <aside className="bg-white rounded-xl border border-slate-200 p-4">
            <DocTree paths={tree.data ?? []} selected={selected} onSelect={setSelected} />
          </aside>

          {contentLoadError ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <p className="text-sm text-rose-600">{t("page.docLoadFailed")}</p>
            </div>
          ) : selected === null ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <p className="text-sm text-slate-400">{t("page.pickDocument")}</p>
            </div>
          ) : (
            <div>
              {isDiscoveryDocument && missing.length > 0 && (
                <div role="alert"
                     className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-3 text-sm text-amber-900">
                  <p className="font-bold">{t("page.missingRefsTitle").replace("{n}", String(missing.length))}</p>
                  <ul className="list-disc pl-5 my-2">
                    {missing.map((ref) => <li key={ref}><code>{ref}</code></li>)}
                  </ul>
                  <p>{t("page.missingRefsBody")}</p>
                </div>
              )}
              <div className="flex justify-end mb-3">
                <button
                  type="button"
                  onClick={() => downloadZip(projectId).catch(() => setActionError(t("page.zipDownloadFailed")))}
                  className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 mr-2"
                >
                  {t("page.downloadAllZip")}
                </button>
                <button
                  type="button"
                  onClick={() => downloadMarkdown(selected, content.data ?? "")}
                  disabled={content.loading}
                  className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {t("page.downloadMd")}
                </button>
              </div>
              {isDiscoveryDocument ? (
                <div className="grid lg:grid-cols-[1fr_minmax(220px,21%)] gap-6">
                  <DocumentPanel projectId={projectId} path={selected} markdown={content.data ?? ""} />
                  <VerificationSummary
                    entries={audit.data ?? []}
                    onViewRaw={auditPath ? () => setSelected(auditPath) : undefined}
                  />
                </div>
              ) : (
                <article className="bg-white rounded-xl border border-slate-200 p-6">
                  <DocChanges projectId={projectId} path={selected} text={content.data ?? ""} />
                </article>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

"use client";
import Link from "next/link";
import type { ApprovalGate } from "@/lib/api/types";
import { useT } from "@/lib/i18n/provider";

// Where the Discovery approvals stand, at the top of the review screen.
//
// **It reports; it does not approve.** Approvals are given in the workspace, by answering the approval question the agent
// opens at the end of a stage. The screen used to carry its own "approve and continue" button, and it misled in two ways
// (observed across eight workshop exports): it never saw those answers, so it asked for an Envision approval the PM had
// already given; and pressing it sent the agent a bare "승인" while the agent was asking something else (backend
// aipds/approval_gates.py header). So this shows what was answered, and when an approval question is still open, points
// to the workspace where it is waiting.

/** The latest round of each gate — a re-approval round replaces the earlier one on screen. Workflow order is kept. */
function latestRounds(gates: ApprovalGate[]): ApprovalGate[] {
  const latest = new Map<string, ApprovalGate>();
  for (const g of gates) {
    const seen = latest.get(g.gate);
    if (!seen || g.round > seen.round) latest.set(g.gate, g);
  }
  return gates.filter((g) => latest.get(g.gate) === g);
}

/** `2026-11-18T04:36:58+00:00` → `2026-11-18 04:36 UTC` — the same shape the change history uses. */
function stamp(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function ApprovalStatus({
  gates,
  workspaceHref,
  reviseHref,
  readOnly,
}: {
  gates: ApprovalGate[];
  workspaceHref: string;
  // Destination of the change-request link — the workspace chat with a draft in the input (?draft=). Nothing is sent.
  reviseHref: string;
  // Viewer members can read the status but have nothing to answer.
  readOnly: boolean;
}) {
  const t = useT();
  const shown = latestRounds(gates);
  const pending = shown.filter((g) => g.status === "pending");
  const answered = shown.filter((g) => g.status === "answered");
  const stageName = (g: ApprovalGate) => t(`handoff.stage.${g.stage}` as Parameters<typeof t>[0]);

  return (
    <div className="mb-6 space-y-3">
      {pending.length > 0 && (
        <section
          aria-labelledby="approval-pending-heading"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
        >
          <div>
            <h1 id="approval-pending-heading" className="text-sm font-bold text-amber-900">
              {t("review.approvalPendingTitle")}
            </h1>
            <p className="text-sm text-amber-900 mt-1">
              {t("review.approvalPendingBody").replace("{stages}", pending.map(stageName).join(", "))}
            </p>
          </div>
          {!readOnly && (
            <Link
              href={workspaceHref}
              className="shrink-0 px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold"
            >
              {t("review.approvalAnswerInWorkspace")}
            </Link>
          )}
        </section>
      )}

      <section
        aria-labelledby="approval-status-heading"
        className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col lg:flex-row lg:items-start justify-between gap-4"
      >
        <div className="min-w-0">
          <h2 id="approval-status-heading" className="text-sm font-bold text-slate-800">
            {t("review.approvalStatusTitle")}
          </h2>
          {answered.length === 0 ? (
            <p className="text-sm text-slate-500 mt-1">{t("review.approvalNone")}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {answered.map((g) => (
                <li key={g.path} className="text-sm text-slate-700 flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-emerald-700">✓ {stageName(g)}</span>
                  {g.headline && <span className="min-w-0 break-words">{g.headline}</span>}
                  <span className="text-xs text-slate-400">
                    {g.answered_at ? stamp(g.answered_at) : null}
                    {g.round > 1 ? ` · ${t("review.approvalRound").replace("{n}", String(g.round))}` : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-400 mt-2">{t("review.approvalHowTo")}</p>
        </div>
        {!readOnly && (
          <Link
            href={reviseHref}
            className="shrink-0 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50"
          >
            {t("page.requestRevision")}
          </Link>
        )}
      </section>
    </div>
  );
}

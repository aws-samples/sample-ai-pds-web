"use client";
import Link from "next/link";

import { LANGUAGE_LABEL, type Locale } from "@/lib/i18n";
import { useT } from "@/lib/i18n/provider";

import { LanguageSwitcher } from "./LanguageSwitcher";
import { UserMenu } from "./UserMenu";

export type HeaderTab =
  | "dashboard" | "workspace" | "review" | "prototypes" | "handoff" | "projects"
  // The manual does not belong to a project. That is why it is a link on the right rather than
  // part of the tab row (Dashboard, Workspace, Document review, Prototype, Handoff) — those
  // five cannot be clicked without a project, and the manual is the opposite.
  | "manual";


// Ported from the shared <header> in files/ui/01–03. `projectId` is optional so
// the project-list screen (no project chosen yet) can render the header. When no
// project is selected the per-project tabs render DISABLED (non-clickable, not
// links) — they require a project, so a live link there would navigate to a
// dead `#/…` route and appear broken. Once a project is selected the tabs link
// into that project's routes.
export function AppHeader({
  activeTab,
  projectId,
  modelLabel,
  projectLanguage,
  readOnly,
}: {
  activeTab: HeaderTab;
  projectId?: string;
  // Display name of the model this project runs on. null/undefined draws no badge — either a
  // screen without a project, or no model specified (server env default).
  modelLabel?: string | null;
  // This project's **output language**. It may differ from the UI locale, and that is normal —
  // opening a Korean project with the English UI produces documents in Korean. This badge makes
  // that fact visible on screen. null/undefined draws nothing (a screen without a project, or
  // an old backend response that does not know the language).
  projectLanguage?: Locale | null;
  // A viewing member of this project. Explains in one place why the write buttons disappear on every screen.
  readOnly?: boolean;
}) {
  const t = useT();

  const tab = (key: HeaderTab, label: string, href: string) => {
    const active = key === activeTab;
    const base = "px-2.5 py-2 rounded-lg text-sm whitespace-nowrap";
    // Per-project tab with no project selected: disabled, not a link.
    if (!projectId) {
      return (
        <span
          className={`${base} text-slate-300 cursor-not-allowed select-none`}
          aria-disabled="true"
          title={t("nav.needProject")}
        >
          {label}
        </span>
      );
    }
    const cls = active
      ? `${base} bg-violet-50 text-violet-700 font-medium`
      : `${base} hover:bg-slate-100 text-slate-600`;
    return (
      <Link href={href} className={cls} aria-current={active ? "page" : undefined}>
        {label}
      </Link>
    );
  };

  const base = `/projects/${projectId}`;
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
      {/* Every item is nowrap: the English labels are longer than the Korean ones, and letting
          flex shrink them wraps text onto two lines and breaks the 64px row. When space is
          short, the low-priority badges below collapse or truncate instead. */}
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6 shrink-0">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg text-violet-700 whitespace-nowrap">
            <span className="w-8 h-8 rounded-lg bg-violet-600 text-white flex items-center justify-center text-sm font-bold">
              WEB
            </span>
            AI-PDS
          </Link>
          <nav className="hidden md:flex items-center gap-1" aria-label={t("nav.ariaLabel")}>
            {tab("dashboard", t("nav.dashboard"), `${base}/dashboard`)}
            {tab("workspace", t("nav.workspace"), `${base}/workspace`)}
            {tab("review", t("nav.review"), `${base}/review`)}
            {tab("prototypes", t("nav.prototypes"), `${base}/prototypes`)}
            {tab("handoff", t("nav.handoff"), `${base}/handoff`)}
          </nav>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          {readOnly && (
            <span
              data-testid="read-only-badge"
              title={t("header.readOnlyTitle")}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200"
            >
              {t("header.readOnlyBadge")}
            </span>
          )}
          {projectLanguage && (
            <span
              data-testid="language-badge"
              title={t("header.languageBadgeTitle")}
              className="hidden lg:inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs px-2.5 py-1 rounded-full bg-slate-50 text-slate-600 border border-slate-200"
            >
              {LANGUAGE_LABEL[projectLanguage]}
            </span>
          )}
          {modelLabel && (
            <span
              data-testid="model-badge"
              // The label is the one item allowed to shrink (truncated with an ellipsis), so the
              // full name goes in the tooltip too.
              title={`${t("header.modelBadgeTitle")}: ${modelLabel}`}
              className="hidden lg:inline-flex min-w-0 items-center text-xs px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200"
            >
              <span className="truncate">{modelLabel}</span>
            </span>
          )}
          {/* The green dot already says "connected", so only the product name is shown — the full
              sentence ("Bedrock connected") did not fit next to the English tabs. It stays in the
              tooltip and for screen readers. Below xl it is dropped first — it is a static marker. */}
          <span
            title={t("header.bedrockConnected")}
            className="hidden xl:inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="sr-only">{t("header.bedrockConnected")}</span>
            <span aria-hidden="true">Bedrock</span>
          </span>
          {/* On the manual screen itself, show it only as the current location — leaving a
              clickable link to the same place makes it confusing where you are. */}
          {activeTab === "manual" ? (
            <span
              aria-current="page"
              className="shrink-0 whitespace-nowrap px-2.5 py-1 text-sm font-medium text-violet-700"
            >
              {t("nav.manual")}
            </span>
          ) : (
            <Link
              href="/manual"
              className="shrink-0 whitespace-nowrap px-2.5 py-1 text-sm text-slate-500 rounded-lg hover:bg-slate-100"
            >
              {t("nav.manual")}
            </Link>
          )}
          <LanguageSwitcher />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

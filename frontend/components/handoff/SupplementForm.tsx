// Supplementary questions — ask only where there is no material (the conditions in the server's handoff/supplement header). Fixed
// questions for empty sections, plus the PM decisions the last PRD left as open questions that must be settled before the build.
// Decisions that can be settled during the build are collapsed — the PRD has written down how to build in the meantime.
//
// Questions are not pre-filled with AI defaults. In measurement, PMs picked the displayed default 89% of the time — a marked
// default steers the choice. For pre-build decisions, the server gives
// options grounded in the sources without a recommendation, and the screen preselects nothing. With no options, it is a
// blank field. Either way, there are "직접 입력" (enter my own) and "모름" (don't know).
//
// Discovery answers are not asked again. Every one of them is the PM's pick — the question form preselects nothing — so an
// answer that matches the option the AI marked is a decision too, not something left to confirm (server handoff/ledger).
// They are listed, folded by stage, only so the PM can change one: changing goes to where the decision lives — the question
// file's `[Answer]:` tag, which the web writes — and the agent then carries it through the documents (routes/handoff.revise_answer).
"use client";
import { useMemo, useState, type ReactNode } from "react";
import { STAGE_ORDER } from "@/lib/api/handoff";
import type {
  Decision, OpenOption, OpenQuestion, SupplementQuestion, SupplementQuestionId, SupplementUpdate, SupplementView,
} from "@/lib/api/handoff";
import type { Dict } from "@/lib/i18n";
import { useT } from "@/lib/i18n/provider";
import { QuestionCard } from "@/components/questions/QuestionCard";
import { sectionLabel } from "./ReadinessPanel";

/** `custom` is screen state — "직접 입력" was chosen on a question with options. It is not saved.
 *  `pending_with` is the "who is confirming it" of an external-confirmation question. */
type Draft = Record<string, { text: string; unknown: boolean; custom?: boolean; pending_with?: string }>;

function initialDraft(view: SupplementView): Draft {
  const out: Draft = {};
  for (const q of view.questions) {
    out[q.id] = { text: q.answer?.text ?? "", unknown: q.answer?.unknown ?? false };
  }
  for (const q of openAll(view)) {
    const text = q.answer?.text ?? "";
    out[q.key] = { text, unknown: q.answer?.unknown ?? false,
                   custom: !!text && !q.options.some((o) => o.text === text),
                   pending_with: q.answer?.pending_with ?? "" };
  }
  return out;
}

const openAll = (view: SupplementView) =>
  [...view.open_questions, ...view.open_deferred, ...view.open_answered];

const filled = (d: Draft[string] | undefined) =>
  !!d && (d.unknown || !!d.text.trim() || !!d.pending_with?.trim());

export function toUpdate(view: SupplementView, draft: Draft): SupplementUpdate {
  const answers: SupplementUpdate["answers"] = {};
  for (const q of view.questions) {
    const d = draft[q.id];
    if (filled(d)) answers[q.id as SupplementQuestionId] = d;
  }
  // Answers already superseded are sent too. Saving is a replacement, so anything left out is erased from the record.
  for (const q of view.superseded) {
    if (q.answer) answers[q.id] = { text: q.answer.text, unknown: q.answer.unknown };
  }
  // Questions answered earlier and dropped from the PRD are sent for the same reason. What was fixed stays fixed.
  const open_answers: SupplementUpdate["open_answers"] = {};
  for (const q of openAll(view)) {
    const d = draft[q.key];
    if (filled(d)) {
      open_answers[q.key] = { question: q.question, text: d.text, unknown: d.unknown,
                              pending_with: d.pending_with ?? "" };
    }
  }
  return { answers, open_answers };
}

export function SupplementForm({
  view, busy, message, onSave, onSaveAndGenerate, onBack, onRevise, readOnly = false,
}: {
  view: SupplementView;
  busy: boolean;
  message: string | null;
  onSave: (update: SupplementUpdate) => void;
  onSaveAndGenerate: (update: SupplementUpdate) => void;
  onBack: () => void;
  /** Changes a Discovery decision (the server writes it to the question file and starts the turn that carries it through). The
   *  web owns the `[Answer]:` tags, so this — not a chat request — is how a decision changes; without it the list has no
   *  change action. */
  onRevise?: (d: Decision, answer: string) => void;
  /** Viewing member. Answers are visible but cannot be edited. */
  readOnly?: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(view));
  // The decision whose answer is being changed (`file#number`), and the answer picked so far.
  const [revising, setRevising] = useState<string | null>(null);
  const [next, setNext] = useState("");

  const groups = useMemo(() => {
    const bySection = new Map<string, SupplementQuestion[]>();
    for (const q of view.questions) {
      bySection.set(q.section, [...(bySection.get(q.section) ?? []), q]);
    }
    return [...bySection.entries()];
  }, [view.questions]);

  // Progress counts only blank questions — the gaps and the PM's before-build decisions. Discovery decisions are not to-dos.
  const total = view.questions.length + view.open_questions.length;
  const done = view.questions.filter((q) => filled(draft[q.id])).length
    + view.open_questions.filter((q) => filled(draft[q.key])).length;

  const stages = useMemo(() => {
    const byStage = new Map<string, Decision[]>();
    for (const d of view.decisions) byStage.set(d.stage, [...(byStage.get(d.stage) ?? []), d]);
    return STAGE_ORDER.filter((st) => byStage.has(st)).map((st) => [st, byStage.get(st)!] as const);
  }, [view.decisions]);

  // One Discovery decision: the question, the decision in words, the PM's note, and — on request — the question asked again.
  // Drawn by a function, not a component — a component defined inside render is a new type every time, so the list
  // would remount.
  const renderDecision = (d: Decision) => {
    const key = `${d.file}#${d.number}`;
    return (
      <li key={key} className="px-4 py-3 border-t border-slate-100 first:border-t-0">
        <p className="text-[13px] font-semibold text-slate-900">{d.ask}</p>
        <p className="mt-1 text-[13px] text-slate-800">
          <span className="mr-1.5 text-xs text-slate-400">{t("handoff.supp.decisions.chosen")}</span>
          {d.choices.join(" / ")}
        </p>
        {d.remark && (
          <p className="mt-0.5 text-xs text-slate-600">
            <span className="mr-1.5 text-slate-400">{t("handoff.supp.decisions.remark")}</span>{d.remark}
          </p>
        )}
        {onRevise && (
          <button type="button" aria-expanded={revising === key}
                  onClick={() => { setRevising(revising === key ? null : key); setNext(d.answer); }}
                  className="mt-2 px-2.5 py-1 rounded-lg border border-slate-300 text-xs text-slate-600">
            {t("handoff.supp.decisions.revise")}
          </button>
        )}
        {revising === key && onRevise && (
          <div className="mt-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200">
            <p className="mb-2 text-xs text-slate-600">{t("handoff.supp.decisions.reviseHint")}</p>
            <QuestionCard question={{ number: d.number, category: null, text: d.ask, options: d.options,
                                      answer: d.answer, multi_select: d.multi_select }}
                          value={next} onChange={setNext} />
            <div className="mt-2 flex justify-end gap-1.5">
              <button type="button" onClick={() => setRevising(null)}
                      className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs text-slate-600">
                {t("handoff.supp.decisions.reviseCancel")}
              </button>
              <button type="button" disabled={busy || !next.trim() || next.trim() === d.answer.trim()}
                      onClick={() => onRevise(d, next.trim())}
                      className="px-2.5 py-1 rounded-lg bg-violet-600 text-white text-xs font-bold disabled:opacity-45">
                {t("handoff.supp.decisions.reviseSubmit")}
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  // One answer field. With options, it is one of the options · enter my own · don't know; without, a blank field and don't know.
  const renderAnswer = (id: string, label: ReactNode, hint: string | null,
                        options: OpenOption[] = [], external = false) => {
    const d = draft[id] ?? { text: "", unknown: false };
    const domId = `q-${id.replace(/[^\w-]/g, "-")}`;
    const typing = !options.length || !!d.custom;
    return (
      <div key={id} className={`bg-white border rounded-xl px-4 py-3.5 mb-2.5 ${
        d.unknown ? "border-dashed border-slate-300" : d.text.trim() ? "border-sky-200" : "border-slate-200"}`}>
        {options.length ? (
          <p id={domId} className="text-sm font-semibold text-slate-900">{label}</p>
        ) : (
          <label htmlFor={domId} className="block text-sm font-semibold text-slate-900">{label}</label>
        )}
        {hint && <p className="mb-2 text-xs text-slate-400">{hint}</p>}
        {options.length > 0 && (
          <div role="radiogroup" aria-labelledby={domId} className={`space-y-1 ${hint ? "" : "mt-2"}`}>
            {options.map((o) => (
              <label key={o.text} className="flex items-start gap-2 text-[13px] text-slate-800 cursor-pointer">
                <input type="radio" name={domId} className="mt-0.5" disabled={d.unknown}
                       checked={!d.unknown && !d.custom && d.text === o.text}
                       onChange={() => set(id, { text: o.text, custom: false })} />
                <span>
                  {o.text}
                  <span className="ml-1.5 text-[11px] text-slate-400">{t("handoff.supp.option.source")}: {o.source}</span>
                </span>
              </label>
            ))}
            <label className="flex items-start gap-2 text-[13px] text-slate-800 cursor-pointer">
              <input type="radio" name={domId} className="mt-0.5" disabled={d.unknown}
                     checked={!d.unknown && !!d.custom}
                     onChange={() => set(id, { text: "", custom: true })} />
              {t("handoff.supp.option.custom")}
            </label>
          </div>
        )}
        {typing && (
          <textarea id={options.length ? undefined : domId} aria-label={options.length ? t("handoff.supp.option.custom") : undefined}
                    value={d.unknown ? "" : d.text} disabled={d.unknown}
                    maxLength={4000} rows={options.length ? 2 : 3}
                    onChange={(e) => set(id, { text: e.target.value })}
                    className={`w-full rounded-lg border border-slate-300 px-2.5 py-2 text-[13px] disabled:bg-slate-50 ${hint && !options.length ? "" : "mt-2"}`} />
        )}
        {external && (
          <label className="block mt-2 text-xs text-slate-600">
            {t("handoff.supp.external.pending")}
            <input type="text" value={d.unknown ? "" : d.pending_with ?? ""} disabled={d.unknown}
                   maxLength={200} placeholder={t("handoff.supp.external.pendingPlaceholder")}
                   onChange={(e) => set(id, { pending_with: e.target.value })}
                   className="mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13px] disabled:bg-slate-50" />
          </label>
        )}
        <label className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={d.unknown}
                 onChange={(e) => set(id, { unknown: e.target.checked })} />
          {t("handoff.supp.unknown")}
        </label>
      </div>
    );
  };
  const openLabel = (q: OpenQuestion) => (
    <>
      {q.id && <span className="mr-1.5 text-xs font-normal text-slate-400">{q.id}</span>}
      {q.external && (
        <span className="mr-1.5 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-[11px] font-normal text-amber-800">
          {t("handoff.supp.external.badge")}
        </span>
      )}
      {q.question}
    </>
  );

  const set = (id: string, patch: Partial<Draft[string]>) =>
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? { text: "", unknown: false }), ...patch } }));

  return (
    <section className="max-w-[960px]">
      {/* fieldset disabled: locks every input at once for viewing members. */}
      <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
      <div className="bg-white border border-slate-200 rounded-xl px-[18px] py-3.5 mb-4 text-[13px]">
        <b className="text-slate-900">{t("handoff.supp.rules.title")}</b>
        <ul className="mt-1.5 pl-5 list-disc space-y-0.5 text-slate-600">
          <li>{t("handoff.supp.rule.onlyGaps")}</li>
          <li>{t("handoff.supp.rule.grade")}</li>
          <li>{t("handoff.supp.rule.noDefault")}</li>
          <li>{t("handoff.supp.rule.unknown")}</li>
          <li>{t("handoff.supp.rule.owner")}</li>
        </ul>
      </div>

      {total === 0 ? (
        <p className="mb-4 text-sm text-slate-500">
          {t("handoff.supp.none")}
          {!view.has_package && <span className="block mt-0.5 text-xs">{t("handoff.supp.open.noPackage")}</span>}
        </p>
      ) : (
        <p className="mb-3.5 text-[13px] text-slate-500">
          {t("handoff.supp.progress").replace("{done}", String(done)).replace("{total}", String(total))}
        </p>
      )}

      {groups.map(([section, questions]) => (
        <div key={section} className="mb-[18px]">
          <h4 className="mb-2 text-[15px] font-semibold text-slate-900">
            {sectionLabel(t, section as SupplementQuestion["section"])}
          </h4>
          {questions.map((q) => renderAnswer(q.id, t(`handoff.q.${q.id}` as keyof Dict),
                                              t(`handoff.q.${q.id}.hint` as keyof Dict)))}
        </div>
      ))}

      {view.open_questions.length > 0 && (
        <div className="mb-[18px]">
          <h4 className="text-[15px] font-semibold text-slate-900">
            {t("handoff.supp.open.title").replace("{n}", String(view.open_questions.length))}
          </h4>
          <p className="mb-2.5 text-xs text-slate-500">{t("handoff.supp.open.hint")}</p>
          {view.open_questions.map((q) => renderAnswer(q.key, openLabel(q),
            q.external ? t("handoff.supp.external.hint") : null, q.options, q.external))}
        </div>
      )}

      {view.open_deferred.length > 0 && (
        <details className="mb-[18px]">
          <summary className="cursor-pointer text-[13px] font-semibold text-slate-700">
            {t("handoff.supp.open.deferred").replace("{n}", String(view.open_deferred.length))}
          </summary>
          <p className="mt-1 mb-2.5 text-xs text-slate-500">{t("handoff.supp.open.deferredHint")}</p>
          {view.open_deferred.map((q) => renderAnswer(q.key, openLabel(q),
            q.until ? `${t("handoff.supp.open.until")}: ${q.until}` : null))}
        </details>
      )}

      {view.open_answered.length > 0 && (
        <details className="mb-[18px]">
          <summary className="cursor-pointer text-[13px] font-semibold text-slate-700">
            {t("handoff.supp.open.answered").replace("{n}", String(view.open_answered.length))}
          </summary>
          <p className="mt-1 mb-2.5 text-xs text-slate-500">{t("handoff.supp.open.answeredHint")}</p>
          {view.open_answered.map((q) => renderAnswer(q.key, openLabel(q), null))}
        </details>
      )}

      {stages.length > 0 && (
        <div className="mb-[18px]">
          <h4 className="text-[15px] font-semibold text-slate-900">{t("handoff.supp.decisions.title")}</h4>
          <p className="mb-2.5 text-xs text-slate-500">{t("handoff.supp.decisions.hint")}</p>
          {stages.map(([stage, items]) => (
            <details key={stage} className="mb-2 bg-white border border-slate-200 rounded-xl">
              <summary className="px-4 py-2.5 cursor-pointer text-[13px] font-semibold text-slate-900">
                {t(`handoff.stage.${stage}` as keyof Dict)}{" "}
                <span className="font-normal text-slate-500">
                  {t("handoff.supp.decisions.count").replace("{n}", String(items.length))}
                </span>
              </summary>
              <ul>{items.map(renderDecision)}</ul>
            </details>
          ))}
        </div>
      )}

      {view.superseded.length > 0 && (
        <div className="mb-[18px] text-[13px] text-slate-500">
          <b className="text-slate-700">{t("handoff.supp.superseded.title")}</b>
          <p className="text-xs">{t("handoff.supp.superseded.hint")}</p>
          <ul className="mt-1 pl-5 list-disc">
            {view.superseded.map((q) => (
              <li key={q.id}>{t(`handoff.q.${q.id}` as keyof Dict)}: {q.answer?.unknown ? t("handoff.supp.unknown") : q.answer?.text}</li>
            ))}
          </ul>
        </div>
      )}

      </fieldset>

      <div className="flex items-center gap-3 mt-2 pt-3.5 border-t border-slate-200">
        <button type="button" onClick={onBack} className="text-[13px] text-violet-700 hover:underline">
          {t("handoff.supp.back")}
        </button>
        <span className="flex-1" />
        {message && <span className="text-xs text-slate-500">{message}</span>}
        {!readOnly && (<>
        <button type="button" disabled={busy} onClick={() => onSave(toUpdate(view, draft))}
                className="px-3 py-2 rounded-lg border border-slate-300 text-[13px] text-slate-600 disabled:opacity-45">
          {t("handoff.supp.save")}
        </button>
        <button type="button" disabled={busy} onClick={() => onSaveAndGenerate(toUpdate(view, draft))}
                className="px-4 py-2 rounded-lg bg-violet-600 text-white text-[13px] font-bold hover:bg-violet-700 disabled:opacity-45">
          {t("handoff.supp.saveAndGenerate")}
        </button>
        </>)}
      </div>
      <p className="mt-2 text-xs text-slate-400">{t("handoff.supp.foot")}</p>
    </section>
  );
}

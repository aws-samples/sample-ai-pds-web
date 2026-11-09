"use client";
// Step 1 of the pre-workshop card: download the form with its settings already filled in.
//
// The topic is required — answers can only be collected together when everyone answered about the
// same subject (collect.ts blocks a mixed topic). The company overview is asked here, once, rather
// than of every respondent: it is a fact, and five people writing the same fact in their own words
// only adds noise. No company name is asked for.
import { useState } from "react";
import { useT } from "@/lib/i18n/provider";
import type { Dict } from "@/lib/i18n";
import { FORM_URL, configureForm, formFileName, type FormSettings } from "@/lib/preInterview/formConfig";

const EMPTY: FormSettings = {
  type: "", topic: "", business: "", customers: "", team: "", due: "", contact: "", email: "", workshop: "",
};

type TextKey = Exclude<keyof FormSettings, "type">;

const OPTIONAL: { key: TextKey; label: keyof Dict }[] = [
  { key: "team", label: "preInterview.form.team" },
  { key: "due", label: "preInterview.form.due" },
  { key: "contact", label: "preInterview.form.contact" },
  { key: "email", label: "preInterview.form.email" },
  { key: "workshop", label: "preInterview.form.workshop" },
];

const input = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm";

export function PreInterviewFormStep() {
  const t = useT();
  const [s, setS] = useState<FormSettings>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const set = (key: keyof FormSettings) =>
    (e: { target: { value: string } }) => setS((prev) => ({ ...prev, [key]: e.target.value }));

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(FORM_URL, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const html = configureForm(await res.text(), s);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      a.download = formFileName(new Date());
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="font-semibold">{t("preInterview.step1")}</h3>
      <p className="mt-1 text-sm text-slate-600">{t("preInterview.form.body")}</p>
      <div className="mt-3 space-y-3 text-sm">
        <label className="block">
          <span className="font-medium">{t("preInterview.form.topic")}</span>
          <input className={input} value={s.topic} onChange={set("topic")} required
                 placeholder={t("preInterview.form.topicPlaceholder")} />
        </label>
        <label className="block">
          <span className="font-medium">{t("preInterview.form.type")}</span>
          <select className={input} value={s.type} onChange={set("type")}>
            <option value="">{t("preInterview.form.typeChoose")}</option>
            <option value="problem">{t("preInterview.type.problem")}</option>
            <option value="build">{t("preInterview.type.build")}</option>
            <option value="improve">{t("preInterview.type.improve")}</option>
          </select>
        </label>
        <p className="-mt-2 text-xs text-slate-500">{t("preInterview.form.typeHint")}</p>
        <label className="block">
          <span className="font-medium">{t("preInterview.form.business")}</span>
          <input className={input} value={s.business} onChange={set("business")}
                 placeholder={t("preInterview.form.businessPlaceholder")} />
        </label>
        <label className="block">
          <span className="font-medium">{t("preInterview.form.customers")}</span>
          <input className={input} value={s.customers} onChange={set("customers")}
                 placeholder={t("preInterview.form.customersPlaceholder")} />
        </label>
        <p className="text-xs text-slate-500">{t("preInterview.form.factsHint")}</p>
        <details>
          <summary className="cursor-pointer text-slate-600">{t("preInterview.form.more")}</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {OPTIONAL.map(({ key, label }) => (
              <label key={key} className="block">
                <span>{t(label)}</span>
                <input className={input} value={s[key]} onChange={set(key)} />
              </label>
            ))}
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void download()} disabled={busy || !s.topic.trim()}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white hover:bg-violet-700 disabled:opacity-50">
            {t("preInterview.form.download")}
          </button>
          {!s.topic.trim() && <span className="text-xs text-slate-500">{t("preInterview.form.topicNeeded")}</span>}
        </div>
        {failed && <p role="alert" className="text-rose-600">{t("preInterview.form.failed")}</p>}
        <p className="text-xs text-slate-500">{t("preInterview.form.koreanOnly")}</p>
      </div>
    </div>
  );
}

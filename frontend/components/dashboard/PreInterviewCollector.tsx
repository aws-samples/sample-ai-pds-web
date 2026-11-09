"use client";
// The dashboard card for the pre-workshop form: download the form with its settings filled in
// (PreInterviewFormStep), then turn the answer files into an attachment and a prompt.
//
// **It only hands out files.** Nothing is uploaded or sent from here: the team downloads the
// collected Markdown and the prompt, then attaches and sends them from the workspace the usual
// way, at the step where Envision asks for the business context. The answer files are read in this
// browser only (lib/preInterview/collect.ts), so they reach the server only if the user attaches
// the result.
//
// The outputs follow the project language, not the UI locale — they go to the agent, the same
// rule as lib/startMessage.ts.
import { useState } from "react";
import { useLocale, useT } from "@/lib/i18n/provider";
import { PreInterviewFormStep } from "./PreInterviewFormStep";
import type { Locale } from "@/lib/i18n";
import {
  MAX_FILES, MAX_FILE_BYTES, buildMarkdown, buildPrompt, canBuild, collect, outputNames,
  type Collection, type FileProblem, type InputFile,
} from "@/lib/preInterview/collect";

const PROBLEM_KEY = {
  tooLarge: "preInterview.problem.tooLarge",
  notJson: "preInterview.problem.notJson",
  notForm: "preInterview.problem.notForm",
} as const satisfies Record<FileProblem, string>;

const FIELD_KEY = {
  topic: "preInterview.field.topic",
  customer: "preInterview.field.customer",
  team: "preInterview.field.team",
} as const;

const TYPE_KEY = {
  improve: "preInterview.type.improve",
  build: "preInterview.type.build",
  problem: "preInterview.type.problem",
  "": "preInterview.type.none",
} as const;

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

async function readAll(files: File[]): Promise<InputFile[]> {
  // An oversized file is not read at all; collect() reports it from `size`.
  return Promise.all(files.map(async (f) => ({
    name: f.name,
    size: f.size,
    text: f.size > MAX_FILE_BYTES ? "" : await readText(f).catch(() => ""),
  })));
}

function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function PreInterviewCollector({ language }: { language: Locale | null }) {
  const t = useT();
  const uiLocale = useLocale();
  const [result, setResult] = useState<Collection | null>(null);
  const [tooMany, setTooMany] = useState(false);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const lang = language ?? uiLocale;

  async function onPick(list: FileList | null) {
    const files = Array.from(list ?? []);
    setCopied(null);
    if (!files.length) return;
    if (files.length > MAX_FILES) {
      setTooMany(true);
      setResult(null);
      return;
    }
    setTooMany(false);
    setResult(collect(await readAll(files)));
  }

  const ready = result !== null && canBuild(result);
  const names = outputNames(new Date());

  async function copyPrompt() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildPrompt(result, lang));
      setCopied("yes");
    } catch {
      // Without clipboard permission the download button still works.
      setCopied("failed");
    }
  }

  return (
    <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5"
             aria-labelledby="pre-interview-heading">
      <h2 id="pre-interview-heading" className="font-bold">{t("preInterview.title")}</h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("preInterview.body")}</p>

      <div className="mt-5 grid gap-8 lg:grid-cols-2">
        <PreInterviewFormStep />

        <div>
          <h3 className="font-semibold">{t("preInterview.step2")}</h3>
          <p className="mt-1 text-sm text-slate-600">{t("preInterview.collectBody")}</p>
          <label className="mt-3 inline-block cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
            {t("preInterview.pick")}
            <input type="file" accept=".json,application/json" multiple className="sr-only"
                   onChange={(e) => { void onPick(e.target.files); e.target.value = ""; }} />
          </label>

          {tooMany && (
            <p role="alert" className="mt-4 text-sm text-rose-600">
              {t("preInterview.tooMany").replace("{n}", String(MAX_FILES))}
            </p>
          )}

          {result && (
            <div className="mt-4 space-y-3 text-sm">
              {result.responses.length > 0 && (
                <div>
                  <p className="font-medium">
                    {t("preInterview.count").replace("{n}", String(result.responses.length))}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-slate-600">
                    {result.responses.map((r) => (
                      <li key={r.n}>
                        {t("preInterview.responseLine")
                          .replace("{n}", String(r.n))
                          .replace("{role}", r.role || t("preInterview.noRole"))
                          .replace("{type}", t(TYPE_KEY[r.type]))}
                        <span className="text-slate-400"> · {r.fileName}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.dropped.map((d) => (
                <p key={d.name} className="text-amber-700">
                  {t("preInterview.dropped").replace("{name}", d.name).replace("{kept}", d.keptName)}
                </p>
              ))}

              {result.rejected.map((r) => (
                <p key={r.name} className="text-rose-600">{r.name}: {t(PROBLEM_KEY[r.problem])}</p>
              ))}

              {result.mismatches.map((m) => (
                <p key={m.field} role="alert" className="text-rose-600">
                  {t("preInterview.mismatch")
                    .replace("{field}", t(FIELD_KEY[m.field]))
                    .replace("{values}", m.values.map((v) => v || t("preInterview.empty")).join(" / "))}
                </p>
              ))}

              {ready && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <button type="button"
                            onClick={() => download(names.markdown, buildMarkdown(result, lang), "text/markdown;charset=utf-8")}
                            className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white hover:bg-violet-700">
                      {t("preInterview.downloadFile")}
                    </button>
                    <button type="button"
                            onClick={() => download(names.prompt, buildPrompt(result, lang), "text/plain;charset=utf-8")}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50">
                      {t("preInterview.downloadPrompt")}
                    </button>
                    <button type="button" onClick={() => void copyPrompt()}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50">
                      {t("preInterview.copyPrompt")}
                    </button>
                    {copied && (
                      <span role="status" className="self-center text-xs text-slate-500">
                        {t(copied === "yes" ? "preInterview.copied" : "preInterview.copyFailed")}
                      </span>
                    )}
                  </div>
                  <div className="rounded-lg bg-slate-50 px-4 py-3 text-slate-700">
                    <p className="font-medium">{t("preInterview.whenTitle")}</p>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                      <li>{t("preInterview.when1")}</li>
                      <li>{t("preInterview.when2")}</li>
                      <li>{t("preInterview.when3")}</li>
                    </ol>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

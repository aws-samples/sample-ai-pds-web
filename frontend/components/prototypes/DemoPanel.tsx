"use client";
// frontend/components/prototypes/DemoPanel.tsx — record an in-person demo as validation feedback.
//
// The light route for one-day workshops: show the build to a few target users, then write down
// who took part (role and count, no names), what they tried and how it went. The backend renders
// every record into demo-notes.md next to the spec, which Discovery's Step 6 reads as the
// "interviews or demos" feedback the validation rule offers (backend proto/demo_notes.py). It is
// optional — nothing here blocks skipping validation.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  addDemoRecord, deleteDemoRecord, listDemoRecords,
  type DemoOutcome, type DemoParticipant, type DemoRecord, type DemoTask,
} from "@/lib/api/demoRecords";
import { useT } from "@/lib/i18n/provider";

const OUTCOMES: DemoOutcome[] = ["done", "stuck", "skipped"];
// The count is held as typed text so clearing the field does not snap it back to a number.
type ParticipantDraft = { role: string; count: string };
const EMPTY_PARTICIPANT: ParticipantDraft = { role: "", count: "1" };
const EMPTY_TASK: DemoTask = { task: "", outcome: "done", note: "" };

const input = "rounded-lg border border-slate-200 px-2 py-1 text-xs";
const smallButton = "px-2 py-1 rounded-lg border border-slate-200 text-xs hover:bg-slate-50 disabled:opacity-50";

export function DemoPanel({ projectId, slug, readOnly = false }: {
  projectId: string;
  slug: string;
  /** Viewer member — sees the records, cannot add or delete. */
  readOnly?: boolean;
}) {
  const t = useT();
  const [records, setRecords] = useState<DemoRecord[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [participants, setParticipants] = useState<ParticipantDraft[]>([{ ...EMPTY_PARTICIPANT }]);
  const [tasks, setTasks] = useState<DemoTask[]>([{ ...EMPTY_TASK }]);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    try {
      const body = await listDemoRecords(projectId, slug);
      setRecords(body.records);
      setPath(body.path);
    } catch {
      setError(t("demo.loadFailed"));
    }
  }, [projectId, slug, t]);

  useEffect(() => { void reload(); }, [reload]);

  const filledParticipants: DemoParticipant[] = participants
    .map((p) => ({ role: p.role.trim(), count: Number.parseInt(p.count, 10) }))
    .filter((p) => p.role && Number.isInteger(p.count) && p.count >= 1 && p.count <= 100);
  const filledTasks = tasks
    .map((x) => ({ ...x, task: x.task.trim(), note: x.note.trim() }))
    .filter((x) => x.task);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const body = await addDemoRecord(projectId, slug,
        { participants: filledParticipants, tasks: filledTasks, notes: notes.trim() });
      setPath(body.path);
      setParticipants([{ ...EMPTY_PARTICIPANT }]);
      setTasks([{ ...EMPTY_TASK }]);
      setNotes("");
      setSaved(true);
      await reload();
    } catch {
      setError(t("demo.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteDemoRecord(projectId, slug, id);
      await reload();
    } catch {
      setError(t("demo.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  const draft = path ? t("demo.reflectDraft").replace("{path}", path) : "";

  return (
    <section className="space-y-3" aria-label={t("demo.title")}>
      <div>
        <h2 className="font-bold">{t("demo.title")}</h2>
        <p className="text-xs text-slate-500 mt-1">{t("demo.hint")}</p>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {records.length > 0 && (
        <ul className="space-y-2" aria-label={t("demo.listLabel")}>
          {records.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 p-3 text-xs space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-700">
                  {r.at.replace("T", " ").slice(0, 16)} UTC
                  {r.gen !== null ? ` · gen ${r.gen}` : ""}
                </span>
                <span className="text-slate-500">
                  {r.participants.map((p) => `${p.role} ${p.count}`).join(", ")}
                </span>
                {!readOnly && (
                  <button type="button" onClick={() => void handleDelete(r.id)} disabled={busy}
                          aria-label={t("demo.deleteAria")}
                          className="ml-auto text-slate-400 hover:text-rose-600 disabled:opacity-50">
                    {t("demo.delete")}
                  </button>
                )}
              </div>
              {r.tasks.length > 0 && (
                <p className="text-slate-600">
                  {r.tasks.map((x) => `${x.task}: ${t(`demo.outcome.${x.outcome}`)}`).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {path && !readOnly && (saved || records.length > 0) && (
        <div className="rounded-lg bg-violet-50 p-3 space-y-2">
          <p className="text-xs text-slate-600 break-all">
            {t("demo.savedAt")} <code>{path}</code>
          </p>
          <Link href={`/projects/${projectId}/workspace?draft=${encodeURIComponent(draft)}`}
                className="inline-block px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium">
            {t("demo.reflect")}
          </Link>
        </div>
      )}

      {!readOnly && (
        <div className="rounded-lg border border-slate-200 p-3 space-y-3">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-slate-700">{t("demo.participants")}</legend>
            <p className="text-[11px] text-slate-500">{t("demo.participantsHint")}</p>
            {participants.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input className={`${input} flex-1`} value={p.role} maxLength={80}
                       aria-label={t("demo.role")} placeholder={t("demo.rolePlaceholder")}
                       onChange={(e) => setParticipants(participants.map((q, j) =>
                         j === i ? { ...q, role: e.target.value } : q))} />
                <input className={`${input} w-16`} type="number" min={1} max={100} value={p.count}
                       aria-label={t("demo.count")}
                       onChange={(e) => setParticipants(participants.map((q, j) =>
                         j === i ? { ...q, count: e.target.value } : q))} />
              </div>
            ))}
            <button type="button" className={smallButton}
                    onClick={() => setParticipants([...participants, { ...EMPTY_PARTICIPANT }])}>
              {t("demo.addParticipant")}
            </button>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-slate-700">{t("demo.tasks")}</legend>
            {tasks.map((x, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <input className={`${input} flex-1 min-w-40`} value={x.task} maxLength={200}
                       aria-label={t("demo.task")} placeholder={t("demo.taskPlaceholder")}
                       onChange={(e) => setTasks(tasks.map((q, j) =>
                         j === i ? { ...q, task: e.target.value } : q))} />
                <select className={input} value={x.outcome} aria-label={t("demo.outcome")}
                        onChange={(e) => setTasks(tasks.map((q, j) =>
                          j === i ? { ...q, outcome: e.target.value as DemoOutcome } : q))}>
                  {OUTCOMES.map((o) => <option key={o} value={o}>{t(`demo.outcome.${o}`)}</option>)}
                </select>
                <input className={`${input} flex-1 min-w-40`} value={x.note} maxLength={500}
                       aria-label={t("demo.note")} placeholder={t("demo.notePlaceholder")}
                       onChange={(e) => setTasks(tasks.map((q, j) =>
                         j === i ? { ...q, note: e.target.value } : q))} />
              </div>
            ))}
            <button type="button" className={smallButton}
                    onClick={() => setTasks([...tasks, { ...EMPTY_TASK }])}>
              {t("demo.addTask")}
            </button>
          </fieldset>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">{t("demo.notes")}</span>
            <textarea className={`${input} w-full h-20`} value={notes} maxLength={4000}
                      placeholder={t("demo.notesPlaceholder")}
                      onChange={(e) => setNotes(e.target.value)} />
          </label>

          <button type="button" onClick={() => void handleSave()}
                  disabled={busy || filledParticipants.length === 0}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium disabled:opacity-50">
            {busy ? t("demo.saving") : t("demo.save")}
          </button>
        </div>
      )}
    </section>
  );
}

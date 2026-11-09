// frontend/lib/preInterview/collect.ts — gathers answer files from the pre-workshop form
// (files/ai-pds-pre-interview-form.html, schema ai-pds-pre-interview-form/v1–v4) into one
// Markdown file and the prompt that goes with it.
//
// **It collects; it does not analyze.** No model call, no summary, no merging of answers: every
// answer is copied verbatim under its question, labeled with its response number and role. Reading
// the differences is the agent's job in Envision, under the steering rules — summarizing here would
// erase the very disagreements the form exists to surface.
//
// **Mixed types are kept, not rejected.** When the form is sent without a fixed type, respondents
// pick one themselves, and picking differently is itself a split in how they frame the work. The
// type-specific questions then go under fixed themes (THEMES below) so answers to similar questions
// sit side by side, each with the question it was actually asked under. Different topic, customer,
// or team means a different subject altogether, so those still block.
//
// The form's export is untrusted input (a user picks the files), so every field is narrowed to the
// shape below before use, and answers are written as blockquotes so a "#" line in an answer cannot
// open a heading in the collected file.
import type { Locale } from "@/lib/i18n";
import { MD, PROMPT, THEME_NAME, TYPE_NAME, type FormType, type ThemeKey } from "./outputText";

export const SCHEMAS = [
  "ai-pds-pre-interview-form/v1",
  "ai-pds-pre-interview-form/v2",
  "ai-pds-pre-interview-form/v3",
  "ai-pds-pre-interview-form/v4",
];

/** Same cap as the form's own import. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_FILES = 30;

export interface Field {
  type: "text" | "choice";
  name: string;
  label: string;
  answer: string;
  selected: string[];
  other: string;
}

export interface Item {
  id: string;
  group: string;
  question: string;
  shown: boolean;
  forType: string;
  fields: Field[];
}

export interface Response {
  /** 1-based, in saved order. */
  n: number;
  fileName: string;
  type: FormType | "";
  role: string;
  savedAt: string;
  items: Item[];
}

export type FileProblem = "tooLarge" | "notJson" | "notForm";

export interface Collection {
  responses: Response[];
  rejected: { name: string; problem: FileProblem }[];
  /** Older saves from the same respondent, superseded by `keptName`. */
  dropped: { name: string; keptName: string }[];
  /** Values that must agree across files but do not. Non-empty blocks building. */
  mismatches: { field: "topic" | "customer" | "team"; values: string[] }[];
  topic: string;
}

export interface InputFile {
  name: string;
  text: string;
  size?: number;
}

const TYPES: FormType[] = ["improve", "build", "problem"];

/** The role is already in the respondents table; older forms (v1–v3) also asked for a name here,
 *  which must not be carried into a file the whole team will read. */
const SKIP_ITEMS = new Set(["P1"]);

interface Source { item: string; fields?: string[]; solution?: boolean }

/** Which question, in each type, answers each theme. `fields` narrows to field names (the
 *  improve-type task block H1 spreads over several themes); without it the whole item counts.
 *  A type with no entry for a theme was never asked about it. */
const THEMES: { key: ThemeKey; sources: Partial<Record<FormType, Source[]>> }[] = [
  { key: "what", sources: {
    improve: [{ item: "H1", fields: ["H1.what"] }],
    problem: [{ item: "K1" }],
    build: [{ item: "N4", solution: true }],
  } },
  { key: "episode", sources: {
    improve: [{ item: "H1", fields: ["H1.steps", "H1.hard"] }],
    problem: [{ item: "K2" }],
    build: [{ item: "N2" }],
  } },
  { key: "load", sources: {
    improve: [{ item: "H1", fields: ["H1.freq", "H1.timec", "H1.time"] }],
    problem: [{ item: "K3" }],
  } },
  { key: "who", sources: {
    improve: [{ item: "H1", fields: ["H1.who"] }],
    problem: [{ item: "K4" }],
    build: [{ item: "N1" }],
  } },
  { key: "now", sources: {
    improve: [{ item: "H1", fields: ["H1.now", "H1.tried"] }],
    problem: [{ item: "K5" }],
    build: [{ item: "N3" }],
  } },
  { key: "cause", sources: { problem: [{ item: "K6" }] } },
  { key: "outcome", sources: { problem: [{ item: "K7" }], build: [{ item: "N6" }] } },
  { key: "quote", sources: {
    improve: [{ item: "H1", fields: ["H1.quote"] }],
    problem: [{ item: "K10" }],
  } },
];

// ---------------------------------------------------------------- reading

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()) : [];
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function readField(raw: unknown): Field | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const type = f.type === "choice" ? "choice" : f.type === "text" ? "text" : null;
  if (!type) return null;
  return {
    type,
    name: str(f.name),
    label: oneLine(str(f.label)),
    answer: typeof f.answer === "string" ? f.answer.replace(/\r\n?/g, "\n").trim() : "",
    selected: strList(f.selected).filter(Boolean),
    other: oneLine(str(f.other)),
  };
}

function readItem(raw: unknown): Item | null {
  if (!raw || typeof raw !== "object") return null;
  const it = raw as Record<string, unknown>;
  const id = str(it.id);
  if (!id || !Array.isArray(it.fields)) return null;
  return {
    id,
    group: oneLine(str(it.group)),
    question: oneLine(str(it.question)),
    // Absent in no released version, but an unknown value must not hide an answer.
    shown: it.shown !== false,
    forType: str(it.for_type),
    fields: it.fields.map(readField).filter((f): f is Field => f !== null),
  };
}

interface Parsed {
  response: Omit<Response, "n">;
  key: string;
  form: { topic: string; customer: string; team: string };
}

function parse(file: InputFile): Parsed | FileProblem {
  if ((file.size ?? file.text.length) > MAX_FILE_BYTES) return "tooLarge";
  let data: unknown;
  try {
    data = JSON.parse(file.text);
  } catch {
    return "notJson";
  }
  if (!data || typeof data !== "object") return "notForm";
  const d = data as Record<string, unknown>;
  if (!SCHEMAS.includes(str(d.schema)) || !Array.isArray(d.items)) return "notForm";
  const form = (d.form && typeof d.form === "object" ? d.form : {}) as Record<string, unknown>;
  const who = (d.respondent && typeof d.respondent === "object" ? d.respondent : {}) as Record<string, unknown>;
  const type = TYPES.find((t) => t === str(form.type)) ?? "";
  const roleBase = oneLine(str(who.role));
  const roleOther = oneLine(str(who.role_other));
  const role = roleOther ? `${roleBase || "-"}: ${roleOther}` : roleBase;
  const items = d.items.map(readItem).filter((i): i is Item => i !== null);
  const savedAt = str(d.saved_at);
  // Files without a respondent id (v1–v3) count once each; the content key only folds the same
  // file picked twice.
  const id = str(who.id);
  const key = id ? `id:${id}` : `content:${savedAt}|${JSON.stringify(d.state ?? null)}`;
  return {
    response: { fileName: file.name, type, role, savedAt, items },
    key,
    form: { topic: oneLine(str(form.topic)), customer: oneLine(str(form.customer)), team: oneLine(str(form.team)) },
  };
}

export function collect(files: InputFile[]): Collection {
  const rejected: Collection["rejected"] = [];
  const latest = new Map<string, Parsed>();
  const dropped: Collection["dropped"] = [];
  const superseded: { name: string; key: string }[] = [];

  for (const file of files) {
    const p = parse(file);
    if (typeof p === "string") {
      rejected.push({ name: file.name, problem: p });
      continue;
    }
    const prev = latest.get(p.key);
    if (!prev) {
      latest.set(p.key, p);
    } else if (p.response.savedAt > prev.response.savedAt) {
      superseded.push({ name: prev.response.fileName, key: p.key });
      latest.set(p.key, p);
    } else {
      superseded.push({ name: p.response.fileName, key: p.key });
    }
  }
  for (const s of superseded) {
    dropped.push({ name: s.name, keptName: latest.get(s.key)!.response.fileName });
  }

  const kept = [...latest.values()].sort((a, b) =>
    a.response.savedAt === b.response.savedAt
      ? a.response.fileName.localeCompare(b.response.fileName)
      : a.response.savedAt < b.response.savedAt ? -1 : 1);

  const mismatches: Collection["mismatches"] = [];
  for (const field of ["topic", "customer", "team"] as const) {
    const values = [...new Set(kept.map((p) => p.form[field]))];
    if (values.length > 1) mismatches.push({ field, values });
  }

  return {
    responses: kept.map((p, i) => ({ ...p.response, n: i + 1 })),
    rejected,
    dropped,
    mismatches,
    topic: kept[0]?.form.topic ?? "",
  };
}

export function canBuild(c: Collection): boolean {
  return c.responses.length > 0 && c.mismatches.length === 0;
}

// ---------------------------------------------------------------- writing

function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

function quote(text: string): string[] {
  return text.split("\n").map((l) => (l.trim() ? `> ${l}` : ">"));
}

/** Escapes a table cell. Backslashes go first: escaping only "|" turns an input \| into \\|, an escaped
 *  backslash followed by a bare pipe, which splits the cell. */
function cell(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function typeName(type: FormType | "", lang: Locale): string {
  return type ? TYPE_NAME[type][lang] : MD.noType[lang];
}

function fieldLines(f: Field, lang: Locale): string[] {
  if (f.type === "text") {
    if (!f.answer) return [];
    return f.label ? ["", `- ${f.label}:`, "", ...quote(f.answer), ""] : ["", ...quote(f.answer), ""];
  }
  if (!f.selected.length && !f.other) return [];
  const picks = f.selected.join(", ");
  const other = f.other ? ` (${MD.other[lang]}: ${f.other})` : "";
  // No blank line after a choice, so consecutive choices read as one list.
  return [`- ${f.label || MD.selected[lang]}: ${picks}${other}`];
}

function answerLines(fields: Field[], lang: Locale): string[] {
  const out = fields.flatMap((f) => fieldLines(f, lang));
  return out.length ? [...out, ""] : [`_${MD.noAnswer[lang]}_`, ""];
}

function responseHead(r: Response, lang: Locale, withType: boolean): string {
  const parts = [`**${MD.response[lang]} ${r.n}**`, r.role || MD.noRole[lang]];
  if (withType) parts.push(typeName(r.type, lang));
  return parts.join(" · ");
}

/** Item ids in form order across all responses: each file's own order, with ids first seen in a
 *  later file placed after the id that precedes them there. */
function mergedOrder(responses: Response[]): string[] {
  const order: string[] = [];
  for (const r of responses) {
    let at = -1;
    for (const it of r.items) {
      const i = order.indexOf(it.id);
      if (i >= 0) { at = i; continue; }
      order.splice(at + 1, 0, it.id);
      at += 1;
    }
  }
  return order;
}

function itemOf(r: Response, id: string): Item | undefined {
  return r.items.find((it) => it.id === id);
}

function firstItem(responses: Response[], id: string): Item | undefined {
  for (const r of responses) {
    const it = itemOf(r, id);
    if (it) return it;
  }
  return undefined;
}

/** One question with every response's answer beneath it, skipping responses that never saw it
 *  (a type-specific question left over after switching type). `pick` narrows the fields. */
function questionBlock(responses: Response[], id: string, lang: Locale, withType: boolean,
                       pick: (r: Response, it: Item) => Field[] = (_r, it) => it.fields): string[] {
  const head = firstItem(responses, id);
  if (!head) return [];
  const out = [`### ${head.question || id}`, ""];
  for (const r of responses) {
    const it = itemOf(r, id);
    if (!it || !it.shown) continue;
    out.push(responseHead(r, lang, withType), "", ...answerLines(pick(r, it), lang));
  }
  return out;
}

/** One entry per type in use, filled into `format` ({type}, {count}, {list}). */
function typeDistribution(responses: Response[], lang: Locale, format: string): string[] {
  const keys: (FormType | "")[] = [...TYPES, ""];
  return keys.flatMap((t) => {
    const ns = responses.filter((r) => r.type === t).map((r) => r.n);
    return ns.length ? [fill(format, { type: typeName(t, lang), count: ns.length, list: ns.join("·") })] : [];
  });
}

function isMixed(responses: Response[]): boolean {
  return new Set(responses.map((r) => r.type)).size > 1;
}

function themeSection(responses: Response[], lang: Locale): string[] {
  const out = [`## ${MD.themes[lang]}`, ""];
  // Fields the themes consumed, per item id, so whatever is left goes to the "other" section.
  const used = new Map<string, Set<string> | "all">();
  for (const theme of THEMES) {
    out.push(`### ${THEME_NAME[theme.key][lang]}`, "");
    for (const r of responses) {
      out.push(responseHead(r, lang, true), "");
      const sources = r.type ? theme.sources[r.type] ?? [] : [];
      if (!r.type || !sources.length) {
        out.push(`_${r.type ? MD.notAsked[lang] : MD.notAskedNoType[lang]}_`, "");
        continue;
      }
      for (const s of sources) {
        const prev = used.get(s.item);
        if (!s.fields) used.set(s.item, "all");
        else if (prev !== "all") used.set(s.item, new Set([...(prev ?? []), ...s.fields]));
        const it = itemOf(r, s.item);
        if (!it || !it.shown) {
          out.push(`_${MD.notAsked[lang]}_`, "");
          continue;
        }
        const note = s.solution ? ` (${MD.solutionNote[lang]})` : "";
        out.push(`- ${MD.askedAs[lang]}: ${it.question || it.id}${note}`, "");
        const fields = s.fields ? it.fields.filter((f) => s.fields!.includes(f.name)) : it.fields;
        out.push(...answerLines(fields, lang));
      }
    }
  }

  const rest: string[] = [];
  for (const id of mergedOrder(responses)) {
    const head = firstItem(responses, id);
    if (!head || !head.forType || SKIP_ITEMS.has(id)) continue;
    const u = used.get(id);
    if (u === "all") continue;
    const left = (it: Item) => (u ? it.fields.filter((f) => !u.has(f.name)) : it.fields);
    if (!responses.some((r) => { const it = itemOf(r, id); return it?.shown && left(it).length; })) continue;
    rest.push(...questionBlock(responses, id, lang, true, (_r, it) => left(it)));
  }
  if (rest.length) out.push(`## ${MD.rest[lang]}`, "", ...rest);
  return out;
}

export function buildMarkdown(c: Collection, lang: Locale): string {
  const rs = c.responses;
  const mixed = isMixed(rs);
  const out = [`# ${MD.title[lang]}`, ""];
  if (c.topic) out.push(`${MD.topic[lang]}: **${c.topic}**`, "");
  out.push(fill(MD.intro[lang], { n: rs.length }), "");

  out.push(`## ${MD.respondents[lang]}`, "",
    `| ${MD.response[lang]} | ${MD.role[lang]} | ${MD.type[lang]} |`, "|---|---|---|",
    ...rs.map((r) => `| ${MD.response[lang]} ${r.n} | ${cell(r.role || MD.noRole[lang])} | ${typeName(r.type, lang)} |`),
    "");

  out.push(`## ${MD.types[lang]}`, "");
  if (!mixed && rs[0]?.type) {
    out.push(fill(MD.sameType[lang], { type: typeName(rs[0].type, lang) }), "");
  } else {
    out.push(...typeDistribution(rs, lang, MD.typeCount[lang]).map((d) => `- ${d}`), "");
    if (mixed) out.push(MD.mixedNote[lang], "");
  }

  let group = "";
  let themesDone = false;
  for (const id of mergedOrder(rs)) {
    if (SKIP_ITEMS.has(id)) continue;
    const head = firstItem(rs, id);
    if (!head) continue;
    if (mixed && head.forType) {
      if (!themesDone) { out.push(...themeSection(rs, lang)); themesDone = true; group = ""; }
      continue;
    }
    if (!rs.some((r) => itemOf(r, id)?.shown)) continue;
    if (head.group && head.group !== group) {
      group = head.group;
      out.push(`## ${group}`, "");
    }
    out.push(...questionBlock(rs, id, lang, false));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function buildPrompt(c: Collection, lang: Locale): string {
  const rs = c.responses;
  const lines = [PROMPT.lead[lang], "", PROMPT.sourceHead[lang], fill(PROMPT.source[lang], { n: rs.length })];
  if (c.topic) lines.push(fill(PROMPT.topic[lang], { topic: c.topic }));
  if (isMixed(rs)) {
    const dist = typeDistribution(rs, lang, PROMPT.typeItem[lang]).join(", ");
    lines.push(fill(PROMPT.mixedType[lang], { dist }));
  } else if (rs[0]?.type) {
    lines.push(fill(PROMPT.sameType[lang], { type: typeName(rs[0].type, lang) }));
  }
  lines.push(PROMPT.use[lang], "", PROMPT.rulesHead[lang],
    PROMPT.r1[lang], PROMPT.r2[lang], PROMPT.r3[lang], PROMPT.r4[lang],
    PROMPT.r5[lang], PROMPT.r6[lang], PROMPT.r7[lang], PROMPT.r8[lang]);
  return lines.join("\n") + "\n";
}

export function outputNames(now: Date): { markdown: string; prompt: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return {
    markdown: `pre-interview-collected-${stamp}.md`,
    prompt: `pre-interview-prompt-${stamp}.txt`,
  };
}

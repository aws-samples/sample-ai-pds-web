// frontend/lib/preInterview/collect.ts — gathers answer files from the pre-workshop form
// (files/ai-pds-pre-interview-form.html, schema ai-pds-pre-interview-form/v1–v4) into one
// Markdown file and the prompt that goes with it.
//
// **It collects; it does not analyze.** No model call, no summary, no merging of answers: every
// answer is copied verbatim under its question, labeled with its response number and role. Reading
// the differences is the agent's job in Envision, under the steering rules — summarizing here would
// erase the very disagreements the form exists to surface.
//
// **It does count, mechanically.** AREAS below fixes which question answers which area Envision must
// cover, and the collected file opens with how many responses answered each. That is a count of
// non-empty answers, not a judgment of them, so the prompt states only what the count can prove: the
// areas the form never asks about, and those it asked that nobody answered. It does not tell the agent
// to skip an answered area — a non-empty answer may still be too thin, and the upstream rules already
// say not to re-ask what is covered.
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
import {
  AREA_NAME, AREA_NOTE, MD, PROMPT, STAGE_NAME, THEME_NAME, TYPE_NAME,
  type AreaKey, type FormType, type StageKey, type ThemeKey,
} from "./outputText";

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

interface Source { item: string; fields?: string[] }

/** Which question, in each type, answers each theme. `fields` narrows to field names (the
 *  improve-type task block H1 spreads over several themes); without it the whole item counts.
 *  A type with no entry for a theme was never asked about it. */
const THEMES: { key: ThemeKey; sources: Partial<Record<FormType, Source[]>> }[] = [
  { key: "what", sources: {
    improve: [{ item: "H1", fields: ["H1.what"] }],
    problem: [{ item: "K1" }],
    build: [{ item: "N4" }],
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

/** Which questions, in each type, answer each area Envision must cover. `common` applies to every
 *  response, typed or not. An area with no sources is one the form never asks about; an area with a
 *  note (AREA_NOTE) is asked only in part. Shared fields between areas are deliberate: the same
 *  answer can be evidence for a business-context area and a pain-point area. */
const AREAS: { key: AreaKey; stage: StageKey; sources: Partial<Record<FormType | "common", Source[]>> }[] = [
  { key: "industry", stage: "context", sources: {} },
  { key: "state", stage: "context", sources: { common: [{ item: "B1" }] } },
  { key: "challenges", stage: "context", sources: {
    improve: [{ item: "H1", fields: ["H1.what", "H1.hard"] }, { item: "H2" }],
    problem: [{ item: "K1" }],
    build: [{ item: "N2" }],
  } },
  { key: "customers", stage: "context", sources: { common: [{ item: "B1" }] } },
  { key: "approach", stage: "context", sources: {
    improve: [{ item: "H1", fields: ["H1.now", "H1.tried"] }],
    problem: [{ item: "K5" }],
    build: [{ item: "N3" }],
  } },
  { key: "segment", stage: "pain", sources: {
    improve: [{ item: "H1", fields: ["H1.who"] }],
    problem: [{ item: "K4", fields: ["K4.text1"] }],
    build: [{ item: "N1", fields: ["N1.text1"] }],
  } },
  { key: "problem", stage: "pain", sources: {
    improve: [{ item: "H1", fields: ["H1.what", "H1.steps", "H1.hard"] }],
    problem: [{ item: "K1" }, { item: "K2" }],
    build: [{ item: "N2" }],
  } },
  { key: "workaround", stage: "pain", sources: {
    improve: [{ item: "H1", fields: ["H1.now", "H1.tried"] }],
    problem: [{ item: "K5" }],
    build: [{ item: "N3" }],
  } },
  { key: "severity", stage: "pain", sources: {
    improve: [{ item: "H1", fields: ["H1.freq", "H1.timec", "H1.time"] }],
    problem: [{ item: "K3" }],
  } },
  // Only "what changes when it works". The idea to build (N4) and its must-haves (N7) are the
  // team's solution, a hypothesis the form deliberately keeps apart from the customer's view.
  { key: "ideal", stage: "pain", sources: {
    problem: [{ item: "K7" }],
    build: [{ item: "N6" }],
  } },
  { key: "market", stage: "pain", sources: {
    problem: [{ item: "K4", fields: ["K4.text2"] }],
    build: [{ item: "N1", fields: ["N1.text2"] }],
  } },
  { key: "pay", stage: "pain", sources: {} },
  // Tool names in K5/N3 say what is in use, not how alternatives fall short, so this is not asked.
  { key: "competitors", stage: "pain", sources: {} },
  { key: "switch", stage: "pain", sources: {} },
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

/** The team's own solution — the idea to build and its must-haves. The form tells respondents the
 *  workshop treats it as an unvalidated idea; marking it where it is quoted keeps the agent from
 *  reading it as what the customer needs. */
const HYPOTHESIS_ITEMS = new Set(["N4", "N7"]);

/** "K4 · question", so a question number in the coverage table can be found in the file, with the
 *  hypothesis mark on the team's idea in every layout (single type or grouped by theme). */
function titled(it: Item, lang: Locale): string {
  const base = it.question ? `${it.id} · ${it.question}` : it.id;
  return HYPOTHESIS_ITEMS.has(it.id) ? `${base} (${MD.hypothesis[lang]})` : base;
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
  const out = [`### ${titled(head, lang)}`, ""];
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
        out.push(`- ${MD.askedAs[lang]}: ${titled(it, lang)}`, "");
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

function hasAnswer(f: Field): boolean {
  return f.type === "text" ? !!f.answer : f.selected.length > 0 || !!f.other;
}

interface AreaCount {
  key: AreaKey;
  stage: StageKey;
  /** Question ids in use by these responses, in AREAS order. Empty: the form never asks. */
  ids: string[];
  received: number[];
  answered: number[];
}

/** For each area, which responses got a matching question and which wrote something in it. */
function coverage(responses: Response[]): AreaCount[] {
  return AREAS.map((a) => {
    const ids: string[] = [];
    const received: number[] = [];
    const answered: number[] = [];
    for (const r of responses) {
      const sources = [...(a.sources.common ?? []), ...(r.type ? a.sources[r.type] ?? [] : [])];
      let got = false;
      let wrote = false;
      for (const s of sources) {
        const it = itemOf(r, s.item);
        if (!it || !it.shown) continue;
        got = true;
        if (!ids.includes(s.item)) ids.push(s.item);
        const fields = s.fields ? it.fields.filter((f) => s.fields!.includes(f.name)) : it.fields;
        if (fields.some(hasAnswer)) wrote = true;
      }
      if (got) received.push(r.n);
      if (wrote) answered.push(r.n);
    }
    return { key: a.key, stage: a.stage, ids, received, answered };
  });
}

function coverageSection(responses: Response[], lang: Locale): string[] {
  const list = (ns: number[]) => (ns.length ? `${MD.response[lang]} ${ns.join("·")}` : MD.none[lang]);
  const rows = coverage(responses).map((a) => {
    const asked = a.ids.length > 0;
    const note = !asked ? MD.notInForm[lang] : (AREA_NOTE as Partial<Record<AreaKey, Record<Locale, string>>>)[a.key]?.[lang] ?? "";
    return `| ${STAGE_NAME[a.stage][lang]} | ${AREA_NAME[a.key][lang]} | ${asked ? a.ids.join(", ") : "-"} | ${asked ? list(a.received) : "-"} | ${asked ? list(a.answered) : "-"} | ${note} |`;
  });
  return [`## ${MD.coverage[lang]}`, "", MD.coverageIntro[lang], "",
    `| ${MD.stage[lang]} | ${MD.area[lang]} | ${MD.questions[lang]} | ${MD.received[lang]} | ${MD.answered[lang]} | ${MD.note[lang]} |`,
    "|---|---|---|---|---|---|", ...rows, ""];
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

  out.push(...coverageSection(rs, lang));

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
  lines.push(PROMPT.use[lang], PROMPT.coverage[lang]);
  const cov = coverage(rs);
  const names = (as: AreaCount[]) => as.map((a) => AREA_NAME[a.key][lang]).join(", ");
  const notAsked = cov.filter((a) => a.ids.length === 0);
  const blank = cov.filter((a) => a.ids.length > 0 && a.answered.length === 0);
  if (notAsked.length) lines.push(fill(PROMPT.notAsked[lang], { list: names(notAsked) }));
  if (blank.length) lines.push(fill(PROMPT.blank[lang], { list: names(blank) }));
  lines.push("", PROMPT.rulesHead[lang],
    PROMPT.r1[lang], PROMPT.r2[lang], PROMPT.r3[lang], PROMPT.r4[lang],
    PROMPT.r5[lang], PROMPT.r6[lang], PROMPT.r7[lang]);
  const ideas = rs.filter((r) => r.type === "build").length;
  if (ideas) lines.push(PROMPT.idea[lang]);
  // Comparing needs at least two ideas.
  if (ideas > 1) lines.push(PROMPT.ideaCompare[lang]);
  lines.push(PROMPT.inference[lang], PROMPT.r8[lang]);
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

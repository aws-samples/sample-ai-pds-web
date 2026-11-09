// frontend/lib/preInterview/formConfig.ts — fills the pre-workshop form's FORM_CONFIG so the team
// can send a ready file instead of editing HTML by hand.
//
// The form (public/pre-interview/ai-pds-pre-interview-form.html) reads every setting from one
// `window.FORM_CONFIG = { ... };` block. That block is replaced whole with a JSON literal. The values
// are typed by the user and land inside a <script> element, so "<" is written as \u003c: a topic
// containing "</script>" must stay a string, not end the script. U+2028/2029 are escaped too, since
// older engines treat them as line breaks inside a string literal.
import type { FormType } from "./outputText";

export const FORM_URL = "/pre-interview/ai-pds-pre-interview-form.html";

export interface FormSettings {
  type: FormType | "";
  topic: string;
  business: string;
  customers: string;
  team: string;
  due: string;
  contact: string;
  email: string;
  workshop: string;
}

const CONFIG_BLOCK = /window\.FORM_CONFIG = \{[\s\S]*?\n\};/g;

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function configureForm(html: string, s: FormSettings): string {
  const blocks = html.match(CONFIG_BLOCK) ?? [];
  if (blocks.length !== 1) throw new Error(`expected one FORM_CONFIG block, found ${blocks.length}`);
  // The form still reads `customer`; it is left empty on purpose (no company name is needed).
  const config = {
    type: s.type,
    customer: "",
    team: oneLine(s.team),
    business: oneLine(s.business),
    customers: oneLine(s.customers),
    due: oneLine(s.due),
    contact: oneLine(s.contact),
    email: oneLine(s.email),
    workshop: oneLine(s.workshop),
    topic: oneLine(s.topic),
  };
  const literal = JSON.stringify(config, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  // A function replacement, so "$&" or "$1" typed by the user is not read as a pattern.
  return html.replace(CONFIG_BLOCK, () => `window.FORM_CONFIG = ${literal};`);
}

export function formFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `ai-pds-pre-interview-form-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.html`;
}

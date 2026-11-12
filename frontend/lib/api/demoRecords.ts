// Demo records: in-person demo sessions recorded in the Prototypes tab
// (backend proto/demo_notes.py). Every change rewrites demo-notes.md next to
// the spec, which Discovery's Step 6 reads as interview/demo feedback.
import { apiFetch } from "./http";

export type DemoOutcome = "done" | "stuck" | "skipped";

export interface DemoParticipant { role: string; count: number }
export interface DemoTask { task: string; outcome: DemoOutcome; note: string }

export interface DemoRecordInput {
  participants: DemoParticipant[];
  tasks: DemoTask[];
  notes: string;
}

export interface DemoRecord extends DemoRecordInput {
  id: string;
  at: string;
  gen: number | null;
}

function base(pid: string, slug: string): string {
  return `/projects/${encodeURIComponent(pid)}/prototypes/${encodeURIComponent(slug)}/demo-records`;
}

export async function listDemoRecords(pid: string, slug: string): Promise<{
  records: DemoRecord[]; path: string | null;
}> {
  return (await apiFetch(base(pid, slug)))!;
}

export async function addDemoRecord(pid: string, slug: string, body: DemoRecordInput): Promise<{
  record: DemoRecord; path: string;
}> {
  return (await apiFetch(base(pid, slug), { method: "POST", body: JSON.stringify(body) }))!;
}

export async function deleteDemoRecord(pid: string, slug: string, id: string): Promise<void> {
  await apiFetch(`${base(pid, slug)}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

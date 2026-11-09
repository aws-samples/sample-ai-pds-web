import type { ManualSection } from "../types";

export const dashboard: ManualSection = {
  id: "dashboard",
  title: "Reading the dashboard",
  lede: "Where you are and what has been produced, on one screen.",
  blocks: [
    {
      kind: "mockup",
      id: "dashboard",
      caption: "The dashboard — summary cards and the phase timeline",
    },
    {
      kind: "md",
      md: `| Card | Meaning |
|---|---|
| Overall progress | Phases marked completed ÷ the phases on this project's path |
| Completed phases | How many phases are settled |
| Question records | Question sheets presented so far. You answer them in the workspace |
| Generated artifacts | How many documents and specs exist |

The timeline on the left is the state of each of the six phases — *Done* / *In progress* / *Not on
this path* / (unmarked = not yet). The same six appear in the workspace's left column.
When questions are waiting, **Continue answering →** appears and takes you to the workspace.

On a project you have just created, a *Nothing has started yet* notice sits above the cards and the
timeline reads *No stages have run yet.* Press **Go to Workspace →** in the notice, enter your
business context and answer the first questions, and Discovery begins. There is nothing to dismiss —
the notice goes away by itself once the first conversation has run.`,
    },
    { kind: "heading", id: "progress-meaning", text: "Do not read the percentage too literally" },
    {
      kind: "md",
      md: `Progress is only **the share of phases marked completed**. It is not a measure of how complete
the methodology is.

The AI tracks its work in finer steps than the six phases, and the screen rolls those steps up into
the phase they belong to — a phase is *Done* only when every step under it is. A phase the path does
not pass through is *Not on this path* and is left out of the total: starting from pain points (Path
A) skips Use Case Intake and Prioritize, and starting from use cases (Path B) or from an existing spec
skips Envision. Because the workflow adapts to the work, skipping a step can leave Discovery finished
short of 100%, and going back makes the percentage drop. Both are normal. **Judge whether you are
finished by the approval state in the Document Review tab.**`,
    },
    { kind: "heading", id: "pre-interview", text: "Pre-workshop form" },
    {
      kind: "md",
      md: `The dashboard's **Pre-workshop form** card has two steps.

**1. Get the form** — enter the topic to look at together (required) and the company overview (business and
industry, main customers), download the form (.html), and send the same file to everyone working on this.
Company facts are written once here and not asked of each respondent. Fixing the form type gives everyone
the same questions; letting respondents choose shows how differently they frame the work.

**2. Collect answers** — choose all the answer files (.json) team members sent back at once. It produces two things — a
**collected file (.md)** with every answer copied as written, question by question, and the **prompt** to
send with it. Nothing is summarized or edited, and the files are read in this browser only.

- When the same person saved again after editing, only the latest file is used.
- Files about a different topic, customer, or team cannot be mixed. Different chosen types (work
  improvement / something to build / a problem to solve) are fine — that is a split in how the team frames
  the work, so similar questions are grouped side by side.

Use them after starting AI-PLC in the Workspace with **Path A** and answering **A (describe it in your own
words)** when asked how you want to provide business context. In your next message, attach the collected
file and paste the prompt.`,
    },
    { kind: "heading", id: "recent", text: "Artifacts and recent activity" },
    {
      kind: "md",
      md: `**Generated artifacts** lists the documents written; selecting one takes you to it.
**Recent activity** is a chronological record of what happened when — coming back after a few days,
this is the fastest way to find where you left off.`,
    },
  ],
};

import type { ManualSection } from "../types";

export const review: ManualSection = {
  id: "review",
  title: "Document review and approval",
  lede: "The screen where you read what was written and decide whether it stands or goes back for changes.",
  blocks: [
    {
      kind: "md",
      md: `Documents are listed as a tree on the left and the one you select renders in the middle. For
the Discovery document (\`discovery-document.md\`), the AI verification summary sits in a column to its
right, and **Approvals by stage** is shown across the top of the screen.`,
    },
    {
      kind: "mockup",
      id: "approval-gate",
      caption: "Approvals by stage at the top, with the file list · the document · the AI verification summary below",
    },
    { kind: "heading", id: "gate", text: "Approvals by stage" },
    {
      kind: "md",
      md: `Approvals happen **in the workspace**. At the end of Envision, Prototype & Validation, Product
Strategy and Go-to-Market, the AI opens an approval question. Answering it settles that stage, and
the AI moves on to the next one.

This screen shows the results.

- **Approvals by stage** — each answered approval question, with the stage, the answer you chose and
  when you answered. If the same approval was asked again, the latest round is shown.
- **An approval question is waiting for your answer** — a yellow notice that appears only while the
  AI has opened an approval question you have not answered yet. **Answer in the workspace** takes
  you there.
- **✏️ Request a revision** — takes you to the workspace chat with a revision draft prefilled in the
  input. Nothing is sent until you write what should change and send it.

Answers to approval questions and revision requests are all recorded in \`audit.md\`. They also
appear under **Approval gate history**, below the verification summary.`,
    },
    { kind: "heading", id: "verification", text: "The AI verification summary" },
    {
      kind: "md",
      md: `Next to the document, the AI's own check of it appears — missing items, claims with thin
support, places that contradict earlier answers. **Read this before approving.** Sending what it
lists straight back as a revision request usually resolves the document in one pass.`,
    },
    { kind: "heading", id: "export", text: "Exporting" },
    {
      kind: "md",
      md: `| Button | What you get |
|---|---|
| ⬇ Download .md | Just the document you are reading |
| ⬇ Download all (.zip) | Every artifact in the project |

For a handoff to a build team, the \`.zip\` is the convenient one. If only the prototype specs are
wanted, pulling out the \`PROTOTYPE-*.md\` files is enough — a build can start from those files
alone in another environment. If Discovery has written \`spec-as-built.md\` next to a spec (the
approved spec with every later prototype change applied — see
[changing a prototype](/manual#modify)), hand that over too: once approved, it is the spec of record.

If the Discovery document cites a file as evidence (for example \`prototype/validation-results.md\`)
that is not among the artifacts, a yellow warning listing those files appears above the download
buttons. Before handing off, ask the Discovery chat to fix the references or rewrite the missing
documents.`,
    },
    {
      kind: "callout",
      tone: "note",
      md: `\`discovery-document.md\` grows as each stage is completed. An earlier stage's approval still stands
when a later stage writes into the document. If a part that was already approved is changed, the AI
may ask for that approval again, as another approval question.`,
    },
    {
      kind: "details",
      summary: "What ends up in the audit trail (audit.md)",
      md: `- Everything the user typed — verbatim, with timestamps
- Question sheet answers (both the options and the notes)
- Approval and revision decisions, and when they happened
- Stage start and completion records

Values that look like API keys or passwords are not recorded. Nothing is summarized or rewritten,
so this is the file you open when you need what was actually said.`,
    },
  ],
};

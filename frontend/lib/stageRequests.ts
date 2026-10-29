// frontend/lib/stageRequests.ts — chat drafts for "go back to a stage" and "change the scope".
//
// The upstream ruleset already defines how these changes are handled
// (`aws-aiplc-rule-details/common/workflow-changes.md`: assess impact, warn, get explicit
// confirmation, back up the artifacts, reset `aiplc-state.md`, log the change). So the web does
// not touch any file itself — it only drafts the request that starts that procedure, and the
// user sends it. The draft names the procedure so the agent follows it instead of improvising,
// and it leaves a "reason" line open because the procedure starts by understanding the concern.
//
// **It takes the project language, not the UI locale** — the same judgment as startMessage.ts:
// the text goes to the agent and stays in the transcript as a user bubble.
import type { Locale } from "@/lib/i18n";

export type StageRequestKind = "reopen" | "restart" | "scope";

/** `{stage}` is replaced with the capability name; `{rule}` with the rule file path. */
const TEMPLATES: Record<StageRequestKind, Record<Locale, string>> = {
  reopen: {
    ko: "이미 끝난 「{stage}」 단계를 다시 열고 싶어.\n이유: \n\n바로 고치지 말고 `{rule}`의 \"Restarting Previous Stage\" 절차를 따라줘 — 다시 해야 하는 이후 단계와 영향받는 산출물을 먼저 알려 주고, 내가 확인한 뒤에 진행해줘.",
    en: "I want to reopen the completed \"{stage}\" stage.\nReason: \n\nDo not change anything yet — follow \"Restarting Previous Stage\" in `{rule}`: tell me which later stages and artifacts would have to be redone, and proceed only after I confirm.",
  },
  restart: {
    ko: "지금 진행 중인 「{stage}」 단계를 다시 하고 싶어.\n이유: \n\n`{rule}`의 \"Restarting Current Stage\" 절차대로, 기존 산출물을 고칠지 처음부터 다시 할지 선택지를 먼저 보여줘.",
    en: "I want to redo the current \"{stage}\" stage.\nReason: \n\nFollow \"Restarting Current Stage\" in `{rule}` and first show me the options — modify the existing artifacts or start the stage over.",
  },
  scope: {
    ko: "범위를 바꾸고 싶어.\n바꿀 내용: \n\n`{rule}`의 절차대로, 이 변경이 어느 단계와 산출물에 영향을 주는지 먼저 정리해 주고 내 확인을 받은 뒤에 반영해줘. 변경 기록도 남겨줘.",
    en: "I want to change the scope.\nWhat changes: \n\nFollowing `{rule}`, first summarize which stages and artifacts this change affects, apply it only after I confirm, and log the change.",
  },
};

const RULE = "aws-aiplc-rule-details/common/workflow-changes.md";

export function stageRequestText(kind: StageRequestKind, stage: string, language: Locale): string {
  const template = TEMPLATES[kind][language] ?? TEMPLATES[kind].ko;
  return template.replace("{stage}", stage).replace("{rule}", RULE);
}

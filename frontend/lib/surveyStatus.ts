// frontend/lib/surveyStatus.ts — is a validation survey running anywhere in this project?
//
// The Discovery workspace shows this next to the Prototype stage. Observed (a workshop run): a
// survey had been collecting responses in the Prototypes tab for a day while the user told the
// Discovery chat that validation was done "without a survey", then took it back hours later. The
// survey lives on another tab, so nothing on the Discovery screen said it existed.
import type { PrototypeInfo } from "@/lib/api/prototypes";

export interface SurveyStatus {
  /** Prototypes with a survey that can take responses now (`has_survey`). */
  open: number;
  /** Responses across those prototypes, archived rounds included (`response_count`). */
  responses: number;
}

/** null when no prototype has a survey — the sidebar then says nothing. */
export function surveyStatus(prototypes: PrototypeInfo[]): SurveyStatus | null {
  const live = prototypes.filter((p) => p.has_survey);
  if (live.length === 0) return null;
  return { open: live.length, responses: live.reduce((n, p) => n + p.response_count, 0) };
}

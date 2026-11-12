import { describe, expect, it } from "vitest";
import type { PrototypeInfo } from "@/lib/api/prototypes";
import { surveyStatus } from "./surveyStatus";

// Only the two fields surveyStatus reads matter; the cast keeps this fixture from breaking
// whenever the card gains a field.
function card(overrides: Partial<PrototypeInfo>): PrototypeInfo {
  return {
    slug: "prototype", state: "running", response_count: 0, has_survey: false, ...overrides,
  } as PrototypeInfo;
}

describe("surveyStatus", () => {
  it("is null when no prototype has a survey", () => {
    expect(surveyStatus([])).toBeNull();
    // Responses left from a closed round do not make a running survey.
    expect(surveyStatus([card({ response_count: 4 })])).toBeNull();
  });

  it("counts open surveys and their responses", () => {
    expect(surveyStatus([
      card({ slug: "a", has_survey: true, response_count: 5 }),
      card({ slug: "b", has_survey: true, response_count: 0 }),
      card({ slug: "c", response_count: 9 }),
    ])).toEqual({ open: 2, responses: 5 });
  });
});

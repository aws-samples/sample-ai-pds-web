import { describe, it, expect } from "vitest";
import { stageRequestText } from "./stageRequests";

describe("stageRequestText", () => {
  it("names the upstream procedure and leaves the reason open", () => {
    const ko = stageRequestText("reopen", "Envision", "ko");
    expect(ko).toContain("「Envision」");
    expect(ko).toContain("Restarting Previous Stage");
    expect(ko).toContain("workflow-changes.md");
    expect(ko).toMatch(/이유: \n/);

    const en = stageRequestText("restart", "Prototype", "en");
    expect(en).toContain('"Prototype"');
    expect(en).toContain("Restarting Current Stage");
  });

  it("follows the project language, not the UI", () => {
    expect(stageRequestText("scope", "", "en")).toMatch(/^I want to change the scope/);
    expect(stageRequestText("scope", "", "ko")).toMatch(/^범위를 바꾸고 싶어/);
  });
});

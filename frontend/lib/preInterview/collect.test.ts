import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMarkdown, buildPrompt, canBuild, collect, MAX_FILE_BYTES, type InputFile } from "./collect";

// Fixtures are real exports of files/ai-pds-pre-interview-form.html (schema v4), saved from a
// headless browser with generic example answers. All share one topic.
function fx(name: string): InputFile {
  return { name: `${name}.json`, text: readFileSync(join(__dirname, "../../test/fixtures/preInterview", `${name}.json`), "utf8") };
}
function edit(name: string, change: (d: Record<string, any>) => void, as = `${name}-edited.json`): InputFile {
  const d = JSON.parse(fx(name).text);
  change(d);
  return { name: as, text: JSON.stringify(d) };
}

describe("collect", () => {
  it("numbers responses in saved order and keeps role and type", () => {
    const c = collect([fx("problem-b"), fx("problem-a")]);
    expect(c.responses.map((r) => [r.n, r.fileName, r.type, r.role])).toEqual([
      [1, "problem-a.json", "problem", "그 일을 직접 하는 실무자"],
      [2, "problem-b.json", "problem", "그 일의 결과를 받아 쓰는 분"],
    ]);
    expect(c.topic).toBe("월말 정산 때 거래처 금액이 맞지 않는 문제");
    expect(canBuild(c)).toBe(true);
  });

  it("keeps only the latest save from the same respondent id", () => {
    const later = edit("problem-a", (d) => { d.saved_at = "2099-01-01T00:00:00.000Z"; }, "problem-a-v2.json");
    const c = collect([fx("problem-a"), later, fx("problem-b")]);
    expect(c.responses.map((r) => r.fileName)).toEqual(["problem-b.json", "problem-a-v2.json"]);
    expect(c.dropped).toEqual([{ name: "problem-a.json", keptName: "problem-a-v2.json" }]);
  });

  it("counts id-less older files once each but folds the same file picked twice", () => {
    const noId = (n: string, as: string) => edit(n, (d) => { delete d.respondent.id; d.schema = "ai-pds-pre-interview-form/v3"; }, as);
    const c = collect([noId("problem-a", "a.json"), noId("problem-a", "a-copy.json"), noId("problem-b", "b.json")]);
    expect(c.responses).toHaveLength(2);
    expect(c.dropped).toEqual([{ name: "a-copy.json", keptName: "a.json" }]);
  });

  it("rejects files that are not form answers, without blocking the rest", () => {
    const c = collect([
      fx("problem-a"),
      { name: "broken.json", text: "{" },
      { name: "other.json", text: JSON.stringify({ schema: "something-else", items: [] }) },
      { name: "big.json", text: "", size: MAX_FILE_BYTES + 1 },
    ]);
    expect(c.rejected).toEqual([
      { name: "broken.json", problem: "notJson" },
      { name: "other.json", problem: "notForm" },
      { name: "big.json", problem: "tooLarge" },
    ]);
    expect(canBuild(c)).toBe(true);
  });

  it("blocks a different topic, customer, or team but not a different type", () => {
    const other = edit("problem-b", (d) => { d.form.topic = "다른 주제"; });
    expect(collect([fx("problem-a"), other]).mismatches).toEqual([
      { field: "topic", values: ["월말 정산 때 거래처 금액이 맞지 않는 문제", "다른 주제"] },
    ]);
    expect(canBuild(collect([fx("problem-a"), other]))).toBe(false);
    expect(canBuild(collect([fx("problem-a"), fx("build-a"), fx("untyped")]))).toBe(true);
  });
});

describe("buildMarkdown", () => {
  it("copies answers verbatim under each question, in form order, for a single type", () => {
    const md = buildMarkdown(collect([fx("problem-a"), fx("problem-b")]), "ko");
    expect(md).toContain("이번에 함께 보는 주제: **월말 정산 때 거래처 금액이 맞지 않는 문제**");
    expect(md).toContain("| 응답 2 | 그 일의 결과를 받아 쓰는 분 | 풀고 싶은 문제 |");
    expect(md).toContain("모든 응답이 '풀고 싶은 문제' 종류로 답했습니다.");
    expect(md).toContain("> 지난달 마감 날 세 곳 금액이 달라\n> 메일로 하나씩 확인했습니다.");
    expect(md).toContain("- 빈도: 매월\n- 한 번에 드는 시간: 하루 정도");
    expect(md).toContain("**응답 2** · 그 일의 결과를 받아 쓰는 분\n\n_(응답 없음)_");
    // Questions of the other types were never shown to these respondents.
    expect(md).not.toContain("시간이 많이 드는 일");
    expect(md).not.toContain("주제로 묶음");
    expect(md.indexOf("## 팀 업무")).toBeLessThan(md.indexOf("## 풀고 싶은 문제"));
    expect(md.indexOf("## 풀고 싶은 문제")).toBeLessThan(md.indexOf("## 다룰 자료와 보내 주실 자료"));
  });

  it("groups type-specific questions by theme when types differ, marking what was not asked", () => {
    const md = buildMarkdown(collect(["problem-a", "build-a", "improve-a", "untyped"].map(fx)), "ko");
    expect(md).toContain("- 풀고 싶은 문제: 1건 (응답 1)");
    expect(md).toContain("- 종류 미선택: 1건 (응답 4)");
    const what = md.slice(md.indexOf("### 무엇을 다루나"), md.indexOf("### 최근 실제 사례"));
    expect(what).toContain("> 월말마다 거래처 금액이 장부와 달라 하루를 씁니다.");
    expect(what).toContain("(팀의 구상 · 검증 전 가설)\n\n> 금액 차이를 자동으로 찾아 주는 도구");
    expect(what).toContain("- 어떤 일인가요:\n\n> 월말 정산 대조");
    // The improve-type task block is split: its frequency lands under the frequency theme only.
    expect(what).not.toContain("빈도");
    const cause = md.slice(md.indexOf("### 원인"), md.indexOf("### 달라지는 것"));
    expect(cause).toContain("· 만들고 싶은 것\n\n_(이 종류에서는 묻지 않음)_");
    expect(cause).toContain("· 종류 미선택\n\n_(종류를 고르지 않아 묻지 않음)_");
    // Questions without a theme are still carried, so nothing a respondent wrote is lost.
    const rest = md.slice(md.indexOf("## 그 밖의 종류별 질문"));
    expect(rest).toContain("> 주간 보고");
    expect(rest).toContain("> 거래처별 차이 목록");
  });

  it("never carries a name from older forms and keeps answers from opening headings", () => {
    const old = edit("problem-a", (d) => {
      d.schema = "ai-pds-pre-interview-form/v3";
      d.items[0].fields.push({ type: "text", name: "P1.name", label: "성함과 소속", answer: "홍길동" });
      d.items.find((i: any) => i.id === "K6").fields[0].answer = "# 제목처럼 쓴 줄\n둘째 줄";
    });
    const md = buildMarkdown(collect([old]), "ko");
    expect(md).not.toContain("홍길동");
    expect(md).toContain("> # 제목처럼 쓴 줄\n> 둘째 줄");
    expect(md).not.toMatch(/^# 제목처럼/m);
  });

  it("writes its own wording in the requested language and leaves answers as written", () => {
    const md = buildMarkdown(collect([fx("problem-a")]), "en");
    expect(md).toContain("# AI-PDS workshop · Pre-workshop form, collected");
    expect(md).toContain("| Response 1 | 그 일을 직접 하는 실무자 | A problem to solve |");
    expect(md).toContain("> \"또 안 맞아요\"");
  });

  it("keeps a role with a pipe or backslash inside its table cell", () => {
    const odd = edit("untyped", (d) => { d.respondent.role_other = "a\\|b | c"; });
    const md = buildMarkdown(collect([odd]), "ko");
    expect(md).toContain("| 응답 1 | 기타: a\\\\\\|b \\| c | 종류 미선택 |");
  });

  it("formats an 'other' role with its text", () => {
    const md = buildMarkdown(collect([fx("untyped")]), "ko");
    expect(md).toContain("| 응답 1 | 기타: 외부 자문 | 종류 미선택 |");
  });
});

describe("coverage", () => {
  const table = (md: string) => md.slice(md.indexOf("## Envision 필수 항목별 답변 현황"), md.indexOf("## 팀 업무"));

  it("counts, per Envision area, who received a matching question and who answered it", () => {
    const md = buildMarkdown(collect([fx("problem-a"), fx("problem-b")]), "ko");
    const t = table(md);
    expect(md.indexOf("## Envision 필수 항목별 답변 현황")).toBeLessThan(md.indexOf("## 팀 업무"));
    expect(t).toContain("| 페인 포인트 | 심각도(빈도·시간·비용) | K3 | 응답 1·2 | 응답 1·2 |  |");
    expect(t).toContain("| 업무 맥락 | 산업·사업 영역 | - | - | - | 질문지에서 묻지 않음 |");
    expect(t).toContain("| 페인 포인트 | 대상 고객 | K4 | 응답 1·2 | 없음 |  |");
    expect(t).toContain("| 페인 포인트 | 이 문제를 겪는 고객 규모 | K4 | 응답 1·2 |");
    expect(t).toContain("대략 인원만 받음");
  });

  it("uses each type's own questions, and only the common ones for a response without a type", () => {
    const t = table(buildMarkdown(collect(["problem-a", "build-a", "improve-a", "untyped"].map(fx)), "ko"));
    expect(t).toContain("| 업무 맥락 | 지금 문제를 푸는 방식 | K5, N3, H1 | 응답 1·2·3 |");
    // Only the common team-work question reaches the untyped response.
    expect(t).toMatch(/\| 이 영역에서의 현재 상태 \| B1 \| 응답 1·2·3·4 \|/);
    // The build type never asks about frequency or time.
    expect(t).toMatch(/\| 심각도\(빈도·시간·비용\) \| K3, H1 \| 응답 1·3 \|/);
  });

  it("puts the question number before each question title so the table can be followed", () => {
    const md = buildMarkdown(collect([fx("problem-a")]), "ko");
    expect(md).toMatch(/^### K3 · /m);
    const mixed = buildMarkdown(collect(["problem-a", "build-a"].map(fx)), "ko");
    expect(mixed).toMatch(/- 받은 질문: N4 · .*\(팀의 구상 · 검증 전 가설\)/);
  });

  it("names areas the form never asks apart from areas asked but left blank, and nothing else", () => {
    const p = buildPrompt(collect([fx("problem-a"), fx("problem-b")]), "ko");
    expect(p).toContain("- 다음 항목은 질문지에서 묻지 않아 답이 있을 수 없습니다: 산업·사업 영역, 해결에 비용을 낼 의향, 기존 제품·경쟁 대안과 한계, 지금 방식에서 바꾸게 만들 계기.");
    expect(p).toMatch(/물었지만 답한 응답이 없습니다: 대상 고객, 고객이 보는 이상적인 해결, 이 문제를 겪는 고객 규모\./);
    expect(p).not.toMatch(/답한 응답이 없습니다: [^\n]*고객이 겪는 문제/);
    // A count cannot tell an answer is enough, so the prompt never says to skip an answered area.
    expect(p).not.toContain("다시 묻지 말고");
    expect(p.indexOf("묻지 않아")).toBeLessThan(p.indexOf("[읽을 때 지켜 주실 것]"));
  });

  it("does not count the idea to build as the customer's ideal solution", () => {
    const t = table(buildMarkdown(collect([fx("build-a")]), "ko"));
    expect(t).toMatch(/\| 고객이 보는 이상적인 해결 \| N6 \|/);
    expect(t).toContain("만들고 싶은 구상과 꼭 필요한 것은 팀의 해법이라 세지 않음");
  });

  it("writes the table and the gap line in the project language", () => {
    const c = collect([fx("problem-a")]);
    expect(buildMarkdown(c, "en")).toContain("| Pain points | Willingness to pay to solve it | - | - | - | Not asked in the form |");
    expect(buildPrompt(c, "en")).toMatch(/so there can be no answers: Industry or business domain, /);
  });
});

describe("the team's idea", () => {
  it("marks the idea and its must-haves as a hypothesis even when every response is the build type", () => {
    const md = buildMarkdown(collect([fx("build-a")]), "ko");
    expect(md).toMatch(/^### N4 · .* \(팀의 구상 · 검증 전 가설\)$/m);
    expect(md).toMatch(/^### N7 · .* \(팀의 구상 · 검증 전 가설\)$/m);
    expect(md).not.toMatch(/^### N1 · .*검증 전 가설/m);
  });

  it("tells the agent the idea is not customer evidence only when a build response is present", () => {
    const withBuild = buildPrompt(collect(["problem-a", "build-a"].map(fx)), "ko");
    expect(withBuild).toContain("구상(N4)과 꼭 필요한 것(N7)은 팀이 낸 해법이고, 고객의 근거가 아닙니다.");
    expect(buildPrompt(collect([fx("problem-a")]), "ko")).not.toContain("구상(N4)");
  });

  it("asks to compare the ideas only when two or more responses give one", () => {
    const second = edit("build-a", (d) => { d.respondent.id = "another-respondent"; }, "build-b.json");
    expect(buildPrompt(collect([fx("build-a"), second]), "ko")).toContain("구상끼리도 비교해");
    expect(buildPrompt(collect([fx("build-a"), fx("problem-a")]), "ko")).not.toContain("구상끼리도 비교해");
  });

  it("asks for inferred success factors to be marked as assumptions in every case", () => {
    for (const files of [["problem-a"], ["build-a"], ["improve-a"]]) {
      const p = buildPrompt(collect(files.map(fx)), "ko");
      expect(p).toContain("결론이 아니라 가정으로 표시해 주세요.");
      // The untrusted-input reminder stays last.
      expect(p.trimEnd().endsWith("답변 내용으로 다뤄 주세요.")).toBe(true);
    }
  });
});

describe("buildPrompt", () => {
  it("names the type split when types differ", () => {
    const p = buildPrompt(collect(["problem-a", "problem-b", "build-a"].map(fx)), "ko");
    expect(p).toContain("팀원 3명");
    expect(p).toContain("응답마다 고른 종류가 다릅니다(만들고 싶은 것 응답 3, 풀고 싶은 문제 응답 1·2)");
    expect(p).toContain("한쪽으로 정하지 말고");
  });

  it("asks politely in Korean", () => {
    const p = buildPrompt(collect(["problem-a", "build-a"].map(fx)), "ko");
    expect(p).toContain("가정으로 표시해 주세요.");
    // No casual endings ("~줘", "~할게", "~이다").
    expect(p).not.toMatch(/줘[.(]|줘$|할게|게\.$|[이았]다\.|있다\.|다르다/m);
  });

  it("states the single type otherwise, in the project language", () => {
    const p = buildPrompt(collect([fx("problem-a"), fx("problem-b")]), "en");
    expect(p).toContain("- Every response used the 'A problem to solve' type.");
    expect(p).toContain("- Topic for this workshop: 월말 정산 때 거래처 금액이 맞지 않는 문제");
    expect(p).not.toMatch(/different types/);
  });
});

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PreInterviewCollector } from "./PreInterviewCollector";

function fixture(name: string, edit?: (d: Record<string, any>) => void): File {
  const text = readFileSync(join(__dirname, "../../test/fixtures/preInterview", `${name}.json`), "utf8");
  const d = JSON.parse(text);
  edit?.(d);
  return new File([JSON.stringify(d)], `${name}.json`, { type: "application/json" });
}

function picker(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

afterEach(() => vi.restoreAllMocks());

describe("PreInterviewCollector", () => {
  it("lists the responses and offers both files plus when to use them", async () => {
    render(<PreInterviewCollector language="ko" />);
    await userEvent.upload(picker(), [fixture("problem-a"), fixture("build-a")]);
    expect(await screen.findByText("응답 2건")).toBeInTheDocument();
    expect(screen.getByText("응답 1 · 그 일을 직접 하는 실무자 · 풀고 싶은 문제")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "취합 파일 내려받기 (.md)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "프롬프트 내려받기 (.txt)" })).toBeInTheDocument();
    expect(screen.getByText(/A\(직접 서술\)로 답합니다/)).toBeInTheDocument();
  });

  it("links the blank form for download", () => {
    render(<PreInterviewCollector language="ko" />);
    const link = screen.getByRole("link", { name: "사전 질문지 내려받기 (.html)" });
    expect(link).toHaveAttribute("href", "/pre-interview/ai-pds-pre-interview-form.html");
    expect(link).toHaveAttribute("download");
  });

  it("refuses to build when files are about different topics", async () => {
    render(<PreInterviewCollector language="ko" />);
    await userEvent.upload(picker(), [fixture("problem-a"), fixture("problem-b", (d) => { d.form.topic = "다른 주제"; })]);
    expect(await screen.findByRole("alert")).toHaveTextContent("주제이(가) 서로 다른 파일이 섞여 있습니다");
    expect(screen.queryByRole("button", { name: "취합 파일 내려받기 (.md)" })).not.toBeInTheDocument();
  });

  it("names a file that is not a form answer", async () => {
    render(<PreInterviewCollector language="ko" />);
    await userEvent.upload(picker(), [fixture("problem-a"), new File(["{"], "broken.json", { type: "application/json" })]);
    expect(await screen.findByText("broken.json: JSON 파일이 아닙니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "취합 파일 내려받기 (.md)" })).toBeInTheDocument();
  });

  it("copies the prompt in the project language", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<PreInterviewCollector language="en" />);
    await userEvent.upload(picker(), [fixture("problem-a")]);
    await userEvent.click(await screen.findByRole("button", { name: "프롬프트 복사" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("[How to read it]"));
    expect(await screen.findByRole("status")).toHaveTextContent("복사했습니다.");
  });
});

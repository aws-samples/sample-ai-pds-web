import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StageSidebar, latestCapabilities } from "./StageSidebar";
import { LocaleProvider } from "@/lib/i18n/provider";
import { projectState } from "@/test/fixtures/projectState";
import type { CapabilityState } from "@/lib/api/types";

const allDone: CapabilityState[] = projectState.capabilities.map((c) =>
  c.status === "not_applicable" ? c : { ...c, status: "completed", note: null },
);

describe("latestCapabilities", () => {
  it("uses the server snapshot when no live event carried one", () => {
    expect(latestCapabilities(projectState, [])).toBe(projectState.capabilities);
  });

  it("the newest event snapshot replaces the server's", () => {
    const events = [
      { stage: "Product Strategy", status: "completed" as const, summary: "", capabilities: projectState.capabilities },
      { stage: "Go-to-Market", status: "completed" as const, summary: "", capabilities: allDone },
    ];
    expect(latestCapabilities(projectState, events)).toBe(allDone);
  });

  it("skips events without a snapshot instead of blanking the list", () => {
    const events = [
      { stage: "Go-to-Market", status: "completed" as const, summary: "", capabilities: allDone },
      { stage: "Go-to-Market", status: "completed" as const, summary: "" },
    ];
    expect(latestCapabilities(projectState, events)).toBe(allDone);
  });

  it("is empty before anything has loaded", () => {
    expect(latestCapabilities(null, [])).toEqual([]);
  });
});

describe("StageSidebar", () => {
  // The agent wrote 8 stages, but the sidebar shows the official 6
  // (AI-PDS team feedback: PDS has 6, but the number on screen was different).
  it("renders the six official capabilities, not the agent's raw stage list", () => {
    render(<StageSidebar state={projectState} events={[]} />);
    expect(screen.getByLabelText("단계 진행 상황")).toBeInTheDocument();
    for (const c of projectState.capabilities) {
      expect(screen.getByText(c.name)).toBeInTheDocument();
    }
    expect(screen.queryByText("Workspace Detection")).toBeNull();
    expect(screen.queryByText("Discovery Mode Selection")).toBeNull();
    expect(screen.getAllByText("이 경로에 없음")).toHaveLength(2);
  });

  it("shows the in-progress capability's note", () => {
    render(<StageSidebar state={projectState} events={[]} />);
    expect(screen.getByText(/13개 질문 대기/)).toBeInTheDocument();
  });

  it("follows a live event's snapshot over the server's initial state", () => {
    render(
      <StageSidebar
        state={projectState}
        events={[{ stage: "Go-to-Market", status: "completed", summary: "", capabilities: allDone }]}
      />,
    );
    expect(screen.getByText(/4 \/ 4/)).toBeInTheDocument();
  });

  // This counter hardcoded "스테이지" (stages) as a literal without going through the dictionary —
  // in the English UI the heading and hint were English but that one line stayed Korean (the
  // 2026-08-04 screenshot shows "0 / 0 스테이지").
  it("renders the stage-count unit in the UI locale, not a hardcoded Korean literal", () => {
    render(
      <LocaleProvider locale="en">
        <StageSidebar state={projectState} events={[]} />
      </LocaleProvider>,
    );
    expect(screen.getByText(/2 \/ 4 phases/)).toBeInTheDocument();
    expect(screen.getAllByText("Not on this path")).toHaveLength(2);
    expect(screen.queryByText(/스테이지/)).toBeNull();
  });

  // Stage-change requests only draft a message (lib/stageRequests.ts) — the upstream
  // workflow-changes procedure does the rest once the user sends it.
  it("offers reopen on completed stages, redo on the current one, and a scope change", async () => {
    const user = userEvent.setup();
    const onRequest = vi.fn();
    render(<StageSidebar state={projectState} events={[]} onRequest={onRequest} />);

    expect(screen.getAllByRole("button", { name: "다시 열기" })).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "다시 열기" })[0]);
    expect(onRequest).toHaveBeenLastCalledWith("reopen", "Envision");

    await user.click(screen.getByRole("button", { name: "다시 하기" }));
    expect(onRequest).toHaveBeenLastCalledWith("restart", "Product Strategy");

    await user.click(screen.getByRole("button", { name: "범위 변경 요청" }));
    expect(onRequest).toHaveBeenLastCalledWith("scope", "");
  });

  it("shows no request buttons without a handler (read-only members)", () => {
    render(<StageSidebar state={projectState} events={[]} />);
    expect(screen.queryByRole("button", { name: "다시 열기" })).toBeNull();
    expect(screen.queryByRole("button", { name: "범위 변경 요청" })).toBeNull();
  });

  it("disables the request buttons while a turn is running", () => {
    render(<StageSidebar state={projectState} events={[]} onRequest={vi.fn()} busy />);
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });

  it("collapses to a rail that keeps each capability's status and the count", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(<StageSidebar state={projectState} events={[]} onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: "단계 패널 접기" }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<StageSidebar state={projectState} events={[]} onToggle={onToggle} collapsed onRequest={vi.fn()} />);
    expect(screen.getByLabelText("단계 진행 상황")).toBeInTheDocument();
    for (const c of projectState.capabilities) expect(screen.getByTitle(c.name)).toBeInTheDocument();
    // The rail has no room for the stage-request buttons or hints.
    expect(screen.queryByRole("button", { name: "다시 열기" })).toBeNull();
    expect(screen.queryByText("이 경로에 없음")).toBeNull();
    await user.click(screen.getByRole("button", { name: "단계 패널 펼치기" }));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("shows no collapse toggle without a handler", () => {
    render(<StageSidebar state={projectState} events={[]} />);
    expect(screen.queryByRole("button", { name: "단계 패널 접기" })).toBeNull();
  });
});

describe("StageSidebar survey status", () => {
  // Observed (a workshop run): a survey was collecting responses in the Prototypes tab while
  // the user told the Discovery chat there was none. The sidebar now says so.
  it("shows a running survey under the Prototype stage, with a link to its tab", () => {
    render(
      <LocaleProvider locale="ko">
        <StageSidebar state={projectState} events={[]}
                      survey={{ open: 1, responses: 5 }} prototypesHref="/projects/p1/prototypes" />
      </LocaleProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("검증 설문 진행 중 1개 · 응답 5건");
    expect(screen.getByRole("link", { name: "Prototypes 탭에서 보기" }))
      .toHaveAttribute("href", "/projects/p1/prototypes");
  });

  it("says nothing when no survey is running", () => {
    render(
      <LocaleProvider locale="ko">
        <StageSidebar state={projectState} events={[]} survey={null} />
      </LocaleProvider>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

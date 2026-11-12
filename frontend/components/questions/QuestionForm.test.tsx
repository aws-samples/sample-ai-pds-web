import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuestionForm } from "./QuestionForm";
import { strategyQuestions } from "@/test/fixtures/strategyQuestions";

describe("QuestionForm", () => {
  it("renders the preamble and a progress count", () => {
    render(<QuestionForm file={strategyQuestions} onSubmit={vi.fn()} submitting={false} />);
    expect(screen.getByText(/추천 기본값/)).toBeInTheDocument();
    expect(screen.getByText(/13 답변/)).toBeInTheDocument();
  });

  it("shows the progress bar inside the sticky submit bar", () => {
    render(<QuestionForm file={strategyQuestions} onSubmit={vi.fn()} submitting={false} />);
    const submit = screen.getByRole("button", { name: /답변 제출/ });
    expect(submit.parentElement).toContainElement(screen.getByRole("progressbar"));
  });

  it("submits an answers map keyed by question number", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<QuestionForm file={strategyQuestions} onSubmit={onSubmit} submitting={false} />);
    await user.click(screen.getByRole("button", { name: /답변 제출/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const answers = onSubmit.mock.calls[0][0];
    // seeded from fixture answers: Q1 -> "A", Q12 -> "A,B"
    expect(answers["1"]).toBe("A");
    expect(answers["12"]).toBe("A,B");
  });

  it("열람 멤버에게는 제출 없이 잠긴 채로 보인다", () => {
    render(<QuestionForm file={strategyQuestions} onSubmit={vi.fn()} submitting={false} readOnly />);
    expect(screen.queryByRole("button", { name: /답변 제출/ })).toBeNull();
    expect(screen.getByText(/답은 프로젝트 소유자가 합니다/)).toBeInTheDocument();
    for (const input of screen.queryAllByRole("radio")) expect(input).toBeDisabled();
  });

  it("offers attaching files that go with the answers", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn();
    const { rerender } = render(
      <QuestionForm file={strategyQuestions} onSubmit={vi.fn()} submitting={false} onAttach={onAttach} />);
    await user.click(screen.getByRole("button", { name: "파일 첨부" }));
    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/답변과 함께 전달됩니다/)).not.toBeInTheDocument();
    rerender(<QuestionForm file={strategyQuestions} onSubmit={vi.fn()} submitting={false}
                           onAttach={onAttach} attachedCount={2} />);
    expect(screen.getByText("첨부 2개가 답변과 함께 전달됩니다")).toBeInTheDocument();
  });

  it("has no attach button without a handler (read-only members)", () => {
    render(<QuestionForm file={strategyQuestions} onSubmit={vi.fn()} submitting={false} readOnly />);
    expect(screen.queryByRole("button", { name: "파일 첨부" })).not.toBeInTheDocument();
  });
});

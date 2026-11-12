import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemoPanel } from "./DemoPanel";
import * as api from "@/lib/api/demoRecords";

const PID = "p1";
const SLUG = "prototype";
const PATH = "aiplc-docs/discovery/prototype/demo-notes.md";
const RECORD: api.DemoRecord = {
  id: "20260105T043000Z-abc123", at: "2026-01-05T04:30:00Z", gen: 2,
  participants: [{ role: "현장 관리자", count: 3 }],
  tasks: [{ task: "오늘 할 일 찾기", outcome: "stuck", note: "메뉴를 못 찾음" }],
  notes: "",
};

beforeEach(() => vi.restoreAllMocks());

describe("DemoPanel", () => {
  it("saves a demo with roles and tasks, then offers to bring it into Discovery", async () => {
    vi.spyOn(api, "listDemoRecords")
      .mockResolvedValueOnce({ records: [], path: null })
      .mockResolvedValue({ records: [RECORD], path: PATH });
    const add = vi.spyOn(api, "addDemoRecord").mockResolvedValue({ record: RECORD, path: PATH });
    render(<DemoPanel projectId={PID} slug={SLUG} />);

    const save = await screen.findByRole("button", { name: "시연 기록 저장" });
    // Nothing to save until a participant role is given.
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "역할" }), "현장 관리자");
    await userEvent.clear(screen.getByRole("spinbutton", { name: "인원" }));
    await userEvent.type(screen.getByRole("spinbutton", { name: "인원" }), "3");
    await userEvent.type(screen.getByRole("textbox", { name: "과업" }), "오늘 할 일 찾기");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "결과" }), "stuck");
    await userEvent.click(save);

    expect(add).toHaveBeenCalledWith(PID, SLUG, {
      participants: [{ role: "현장 관리자", count: 3 }],
      tasks: [{ task: "오늘 할 일 찾기", outcome: "stuck", note: "" }],
      notes: "",
    });
    const list = await screen.findByRole("list", { name: "저장된 시연 기록" });
    expect(list).toHaveTextContent("gen 2");
    expect(list).toHaveTextContent("오늘 할 일 찾기: 막힘");
    const reflect = screen.getByRole("link", { name: "Discovery에 반영하기" });
    expect(decodeURIComponent(reflect.getAttribute("href")!)).toContain(PATH);
  });

  it("lets a record be deleted", async () => {
    vi.spyOn(api, "listDemoRecords")
      .mockResolvedValueOnce({ records: [RECORD], path: PATH })
      .mockResolvedValue({ records: [], path: null });
    const del = vi.spyOn(api, "deleteDemoRecord").mockResolvedValue();
    render(<DemoPanel projectId={PID} slug={SLUG} />);
    await userEvent.click(await screen.findByRole("button", { name: "이 시연 기록 삭제" }));
    expect(del).toHaveBeenCalledWith(PID, SLUG, RECORD.id);
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "저장된 시연 기록" })).not.toBeInTheDocument());
  });

  it("is read-only for viewers", async () => {
    vi.spyOn(api, "listDemoRecords").mockResolvedValue({ records: [RECORD], path: PATH });
    render(<DemoPanel projectId={PID} slug={SLUG} readOnly />);
    expect(await screen.findByRole("list", { name: "저장된 시연 기록" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "시연 기록 저장" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이 시연 기록 삭제" })).not.toBeInTheDocument();
  });
});

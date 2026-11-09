import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreInterviewFormStep } from "./PreInterviewFormStep";

const FORM = "<script>\nwindow.FORM_CONFIG = {\n  topic: ''\n};\n</script>";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function stubDownload() {
  const blobs: Blob[] = [];
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn((b: Blob) => { blobs.push(b); return "blob:x"; }),
    revokeObjectURL: vi.fn(),
  }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return blobs;
}

describe("PreInterviewFormStep", () => {
  it("needs a topic before the form can be downloaded", () => {
    render(<PreInterviewFormStep />);
    expect(screen.getByRole("button", { name: "질문지 내려받기 (.html)" })).toBeDisabled();
  });

  it("downloads the form with the settings filled in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(FORM, { status: 200 })));
    const blobs = stubDownload();
    render(<PreInterviewFormStep />);
    await userEvent.type(screen.getByLabelText("이번에 함께 볼 주제 (필수)"), "견적 회신 지연");
    await userEvent.type(screen.getByLabelText("하는 일·업종"), "부품 주문 생산");
    await userEvent.selectOptions(screen.getByLabelText("질문지 종류"), "problem");
    await userEvent.click(screen.getByRole("button", { name: "질문지 내려받기 (.html)" }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    // jsdom's Blob is not readable through undici's Response; FileReader is.
    const html = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blobs[0]);
    });
    expect(html).toContain('"topic": "견적 회신 지연"');
    expect(html).toContain('"business": "부품 주문 생산"');
    expect(html).toContain('"type": "problem"');
  });

  it("says so when the form cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    render(<PreInterviewFormStep />);
    await userEvent.type(screen.getByLabelText("이번에 함께 볼 주제 (필수)"), "주제");
    await userEvent.click(screen.getByRole("button", { name: "질문지 내려받기 (.html)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("질문지를 내려받지 못했습니다");
  });
});

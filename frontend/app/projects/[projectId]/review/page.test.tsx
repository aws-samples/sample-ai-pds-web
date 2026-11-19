import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { API_BASE_URL } from "@/lib/api/client";
import { discoveryDocument } from "@/test/fixtures/discoveryDocument";
import { auditEntries } from "@/test/fixtures/auditEntries";

// The LanguageSwitcher that AppHeader draws calls useRouter() — in a unit test with no app router
// mounted, that hook throws. The switcher's behavior is verified by
// components/LanguageSwitcher.test.tsx, so here it only needs to mount.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import ReviewPage from "./page";

const params = Promise.resolve({ projectId: "ws-m" });

const DISCOVERY_PATH = "aiplc-docs/discovery/discovery-document.md";
const AUDIT_PATH = "aiplc-docs/audit.md";
const AUDIT_CONTENT = "# Audit Log\n\n감사 로그 원문입니다.";

const ENVISION_GATE = "aiplc-docs/discovery/envision/envision-approval-questions.md";
const ENVISION_ANSWERED = {
  path: ENVISION_GATE, gate: ENVISION_GATE, stage: "envision", round: 1, status: "answered",
  answers: [{ number: 1, question: "Envision 결과를 승인하십니까?", answer: "A. 승인한다 — Solution Analysis로 진행한다" }],
  headline: "A. 승인한다 — Solution Analysis로 진행한다",
  answered_at: "2026-11-18T04:36:58+00:00",
};

function mockTreeAndAudit() {
  server.use(
    http.get(`${API_BASE_URL}/projects/ws-m/artifacts`, () =>
      HttpResponse.json({ artifacts: [DISCOVERY_PATH, AUDIT_PATH] }),
    ),
    http.get(`${API_BASE_URL}/projects/ws-m/files/${DISCOVERY_PATH}`, () =>
      HttpResponse.json({ content: discoveryDocument }),
    ),
    http.get(`${API_BASE_URL}/projects/ws-m/files/${AUDIT_PATH}`, () =>
      HttpResponse.json({ content: AUDIT_CONTENT }),
    ),
    http.get(`${API_BASE_URL}/projects/ws-m/audit`, () => HttpResponse.json(auditEntries)),
    // Approval status — read from the approval question files (backend aipds/approval_gates.py).
    // The default is the shape of a workshop mid-way: Envision approved in the workspace.
    http.get(`${API_BASE_URL}/projects/ws-m/approval-gates`, () =>
      HttpResponse.json({ gates: [ENVISION_ANSWERED] }),
    ),
  );
}

describe("Review page", () => {
  it("renders the doc tree, defaults to discovery-document.md, and shows the approval status", async () => {
    mockTreeAndAudit();
    // `use(params)` suspends on the first render because the test's plain
    // Promise.resolve(...) params (unlike Next's internally-tracked params
    // thenable) isn't pre-marked as settled. Wrapping the initial render in
    // act() lets that Suspense retry flush before we start querying/waiting.
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    // Tree renders with both files, and the default selection highlights
    // discovery-document.md.
    const docButton = await screen.findByRole("button", { name: /discovery-document\.md/ });
    expect(docButton).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /audit\.md/ })).toBeInTheDocument();
    // Default selection loads its content and the approval status shows for it.
    expect(await screen.findByText("Press Release")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "단계별 승인" })).toBeInTheDocument();
  });

  it("warns before download when the discovery document cites files that are missing", async () => {
    // The shape measured in ws-l: Part 2 points to an evidence file that is not in the
    // artifacts.
    mockTreeAndAudit();
    server.use(
      http.get(`${API_BASE_URL}/projects/ws-m/artifacts/missing-references`, () =>
        HttpResponse.json({ document: DISCOVERY_PATH,
                            missing: ["prototype/validation-results.md"] }),
      ),
    );
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("1");
    expect(alert).toHaveTextContent("prototype/validation-results.md");

    // Viewing another document clears the warning — this check is about the entry document.
    await userEvent.click(screen.getByRole("button", { name: /audit\.md/ }));
    await screen.findByText("Audit Log");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows no warning when every cited file exists", async () => {
    mockTreeAndAudit();
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    await screen.findByText("Press Release");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("selecting a non-discovery-document file hides the approval status and drops the DocumentPanel/VerificationSummary chrome", async () => {
    mockTreeAndAudit();
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    await screen.findByText("Press Release");

    await userEvent.click(screen.getByRole("button", { name: /audit\.md/ }));

    expect(await screen.findByText("Audit Log")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "단계별 승인" })).not.toBeInTheDocument();
    expect(screen.queryByText("AI 검증 요약")).not.toBeInTheDocument();
    expect(screen.queryByText("Press Release")).not.toBeInTheDocument();
  });

  it("an approval answered in the workspace shows as approved — no approve button, nothing to send", async () => {
    // Observed in a workshop export: Envision was approved through its approval question, yet the
    // old gate kept asking, and pressing it dropped a bare "승인" into the conversation.
    mockTreeAndAudit();
    let turnCalls = 0;
    server.use(
      http.post(`${API_BASE_URL}/projects/ws-m/turns`, () => {
        turnCalls += 1;
        return HttpResponse.json({ turn_id: "t-1" });
      }),
    );
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    const status = await screen.findByRole("region", { name: "단계별 승인" });
    await waitFor(() => expect(status).toHaveTextContent("PR/FAQ · 문제 정의"));
    expect(status).toHaveTextContent("A. 승인한다 — Solution Analysis로 진행한다");
    expect(status).toHaveTextContent("2026-11-18 04:36 UTC");
    expect(screen.queryByRole("button", { name: /승인/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /답을 기다리고/ })).not.toBeInTheDocument();
    expect(turnCalls).toBe(0);
  });

  it("an open approval question points to the workspace where it waits", async () => {
    mockTreeAndAudit();
    const strategy = "aiplc-docs/discovery/product-strategy/strategy-approval-questions.md";
    server.use(
      http.get(`${API_BASE_URL}/projects/ws-m/approval-gates`, () =>
        HttpResponse.json({ gates: [ENVISION_ANSWERED, {
          path: strategy, gate: strategy, stage: "product_strategy", round: 1, status: "pending",
          answers: [], headline: null, answered_at: null,
        }] })),
    );
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    const pending = await screen.findByRole("region", { name: /답을 기다리고/ });
    expect(pending).toHaveTextContent("제품 전략");
    expect(screen.getByRole("link", { name: "워크스페이스에서 답하기" }))
      .toHaveAttribute("href", "/projects/ws-m/workspace");
  });

  it("a re-approval round replaces the earlier round on screen", async () => {
    mockTreeAndAudit();
    const round2 = "aiplc-docs/discovery/envision/envision-approval-questions-2.md";
    server.use(
      http.get(`${API_BASE_URL}/projects/ws-m/approval-gates`, () =>
        HttpResponse.json({ gates: [
          { ...ENVISION_ANSWERED, headline: "B. 수정이 필요하다 — 2절 보강" },
          { ...ENVISION_ANSWERED, path: round2, round: 2, headline: "A. 승인한다" },
        ] })),
    );
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    const status = await screen.findByRole("region", { name: "단계별 승인" });
    await waitFor(() => expect(status).toHaveTextContent("A. 승인한다"));
    expect(status).toHaveTextContent("2회차");
    expect(status).not.toHaveTextContent("수정이 필요하다");
  });

  it("with no approval question yet, it says how approvals are given", async () => {
    mockTreeAndAudit();
    server.use(
      http.get(`${API_BASE_URL}/projects/ws-m/approval-gates`, () => HttpResponse.json({ gates: [] })),
    );
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    const status = await screen.findByRole("region", { name: "단계별 승인" });
    await waitFor(() => expect(status).toHaveTextContent("아직 답한 승인 질문이 없습니다"));
    expect(status).toHaveTextContent("워크스페이스에 여는 승인 질문");
  });

  it("수정 요청 링크는 워크스페이스 채팅으로 이동하며 문서명이 담긴 초안을 ?draft=로 전달한다", async () => {
    mockTreeAndAudit();
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    await screen.findByText("Press Release");
    const link = screen.getByRole("link", { name: /수정 요청/ });
    expect(link).toHaveAttribute(
      "href",
      `/projects/ws-m/workspace?draft=${encodeURIComponent("discovery-document.md 수정 요청: ")}`,
    );
  });

  // Regression: a non-404 readArtifact error was previously swallowed into
  // `content.data ?? ""`, rendering the empty-document state and hiding the
  // failure. A 500 must surface as a distinct Korean load-error message, not
  // the "아직 작성된 문서가 없습니다." empty state.
  it("shows a generic load-error state when the selected file's content fails with a non-404 error", async () => {
    server.use(
      http.get(`${API_BASE_URL}/projects/ws-m/artifacts`, () =>
        HttpResponse.json({ artifacts: [DISCOVERY_PATH] }),
      ),
      http.get(`${API_BASE_URL}/projects/ws-m/files/${DISCOVERY_PATH}`, () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ),
      http.get(`${API_BASE_URL}/projects/ws-m/audit`, () => HttpResponse.json(auditEntries)),
    );
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    expect(
      await screen.findByText(/문서를 불러오지 못했습니다. 백엔드 연결을 확인하세요\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/아직 작성된 문서가 없습니다/)).not.toBeInTheDocument();
  });

  // The approval status belongs to the document on screen; it stays hidden while
  // the load-error panel is showing.
  it("hides the approval status when the discovery document's content fails to load", async () => {
    server.use(
      http.get(`${API_BASE_URL}/projects/ws-m/artifacts`, () =>
        HttpResponse.json({ artifacts: [DISCOVERY_PATH] }),
      ),
      http.get(`${API_BASE_URL}/projects/ws-m/files/${DISCOVERY_PATH}`, () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ),
      http.get(`${API_BASE_URL}/projects/ws-m/audit`, () => HttpResponse.json(auditEntries)),
    );
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    expect(
      await screen.findByText(/문서를 불러오지 못했습니다. 백엔드 연결을 확인하세요\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "단계별 승인" })).not.toBeInTheDocument();
  });
});

describe("Review page — width, download", () => {
  it("uses the widened layout instead of max-w-7xl", async () => {
    mockTreeAndAudit();
    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(<ReviewPage params={params} />));
    });
    const main = container!.querySelector("main");
    expect(main?.className).not.toContain("max-w-7xl");
    expect(main?.className).toContain("max-w-[1720px]");
  });

  it("downloads the selected document as .md via a Blob link", async () => {
    mockTreeAndAudit();
    // jsdom does not implement URL.createObjectURL — inject it as a stub
    const createSpy = vi.fn().mockReturnValue("blob:mock");
    const revokeSpy = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createSpy;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeSpy;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    await screen.findByRole("button", { name: /discovery-document\.md/ });
    const dl = await screen.findByRole("button", { name: /\.md 다운로드/ });
    await userEvent.click(dl);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const blob = createSpy.mock.calls[0][0] as Blob;
    expect(blob.type).toContain("text/markdown");
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalledWith("blob:mock");
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    clickSpy.mockRestore();
  });

  it("downloads all artifacts as a zip via a Blob link", async () => {
    mockTreeAndAudit();
    server.use(
      http.get(`${API_BASE_URL}/projects/ws-m/artifacts/archive`, () =>
        HttpResponse.arrayBuffer(new ArrayBuffer(4), {
          headers: { "Content-Type": "application/zip" },
        }),
      ),
    );
    // jsdom does not implement URL.createObjectURL — inject it as a stub
    const createSpy = vi.fn().mockReturnValue("blob:mock-zip");
    const revokeSpy = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createSpy;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeSpy;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    await screen.findByRole("button", { name: /discovery-document\.md/ });
    const dl = await screen.findByRole("button", { name: /전체 다운로드 \(\.zip\)/ });
    await userEvent.click(dl);
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalledWith("blob:mock-zip");
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    clickSpy.mockRestore();
  });

});

describe("Review page — document list auto-refresh", () => {
  const FAQ_PATH = "aiplc-docs/discovery/faq.md";

  it("polls the artifact list and shows a newly-created document without a manual reload", async () => {
    // Tree starts with only the discovery document; a background turn (from the
    // workspace) later creates faq.md. The poll must surface it.
    let artifacts = [DISCOVERY_PATH];
    server.use(
      http.get(`${API_BASE_URL}/projects/ws-m/artifacts`, () =>
        HttpResponse.json({ artifacts }),
      ),
      http.get(`${API_BASE_URL}/projects/ws-m/files/${DISCOVERY_PATH}`, () =>
        HttpResponse.json({ content: discoveryDocument }),
      ),
      http.get(`${API_BASE_URL}/projects/ws-m/files/${FAQ_PATH}`, () =>
        HttpResponse.json({ content: "# FAQ" }),
      ),
      http.get(`${API_BASE_URL}/projects/ws-m/audit`, () => HttpResponse.json(auditEntries)),
    );
    await act(async () => {
      render(<ReviewPage params={params} />);
    });
    // faq.md is not in the tree yet.
    expect(await screen.findByRole("button", { name: /discovery-document\.md/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /faq\.md/ })).not.toBeInTheDocument();

    // Backend creates it; the 5s poll picks it up.
    artifacts = [DISCOVERY_PATH, FAQ_PATH];
    expect(
      await screen.findByRole("button", { name: /faq\.md/ }, { timeout: 8000 }),
    ).toBeInTheDocument();
    // The user's current selection (discovery-document.md) is preserved across
    // the reload — the poll must not clobber it.
    expect(screen.getByRole("button", { name: /discovery-document\.md/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  }, 12000); // > the 5s poll interval + render/settle margin

  it("does not poll while the tab is hidden, and reloads at once when it comes back", async () => {
    let listCalls = 0;
    let artifacts = [DISCOVERY_PATH];
    server.use(
      http.get(`${API_BASE_URL}/projects/ws-m/artifacts`, () => {
        listCalls += 1;
        return HttpResponse.json({ artifacts });
      }),
      http.get(`${API_BASE_URL}/projects/ws-m/files/${DISCOVERY_PATH}`, () =>
        HttpResponse.json({ content: discoveryDocument }),
      ),
      http.get(`${API_BASE_URL}/projects/ws-m/files/${FAQ_PATH}`, () =>
        HttpResponse.json({ content: "# FAQ" }),
      ),
      http.get(`${API_BASE_URL}/projects/ws-m/audit`, () => HttpResponse.json(auditEntries)),
    );
    let visibility: DocumentVisibilityState = "visible";
    const spy = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    try {
      await act(async () => {
        render(<ReviewPage params={params} />);
      });
      expect(await screen.findByRole("button", { name: /discovery-document\.md/ })).toBeInTheDocument();

      visibility = "hidden";
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      const before = listCalls;
      artifacts = [DISCOVERY_PATH, FAQ_PATH];
      await act(async () => { await new Promise((r) => setTimeout(r, 5500)); });
      expect(listCalls).toBe(before);           // a full interval passed, no poll

      visibility = "visible";
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      // Well under the 5s interval: the return itself reloads.
      expect(
        await screen.findByRole("button", { name: /faq\.md/ }, { timeout: 1500 }),
      ).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  }, 12000);
});

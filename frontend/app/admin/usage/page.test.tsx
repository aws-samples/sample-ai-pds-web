import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// AppHeader's LanguageSwitcher calls useRouter() — same mock as the other admin page tests.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import AdminUsagePage from "./page";
import { ApiError } from "@/lib/api/client";

vi.mock("@/lib/api/usage", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/usage")>()),
  getUsageReport: vi.fn(),
}));
import {
  getUsageReport, type ProjectUsage, type UsageBucket, type UsageReport,
} from "@/lib/api/usage";

function bucket(over: Partial<UsageBucket> = {}): UsageBucket {
  return {
    requests: 0, long_context_requests: 0, cost_usd: 0, cache_hit_rate: null,
    tokens: { input: 0, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 },
    ...over,
  };
}

const BUSY = bucket({
  requests: 12, cost_usd: 3.5, cache_hit_rate: 0.8,
  tokens: { input: 1000, output: 500, cache_write_5m: 1000, cache_write_1h: 0, cache_read: 8000 },
});

function project(id: string, name: string, b: UsageBucket, over = {}): ProjectUsage {
  return {
    project_id: id, name, owner: "a@x", created_at: null, model_id: null,
    usage: { ...b, by_source: b.requests ? { discovery: b } : {}, unpriced_models: [],
             updated_at: null, ...over },
  };
}

function report(over: Partial<UsageReport> = {}): UsageReport {
  return {
    estimate: true,
    pricing: { source: "price_list", as_of: "2026-11-01T00:00:00+00:00", region: "ap-northeast-2" },
    // Already sorted by cost — the backend does it across every page.
    projects: [
      project("p-busy", "Busy", BUSY, { unpriced_models: ["claude-mystery"] }),
      project("p-idle", "Idle", bucket()),
    ],
    total: 2, page: 1, size: 10,
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("admin usage page", () => {
  it("lists projects in the order the backend sorted them, with no total row", async () => {
    vi.mocked(getUsageReport).mockResolvedValue(report());
    render(<AdminUsagePage />);
    await waitFor(() => expect(screen.getByText("Busy")).toBeInTheDocument());
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);  // header, Busy, Idle
    expect(rows[1]).toHaveTextContent("Busy");
    expect(rows[1]).toHaveTextContent("80%");
    expect(rows[2]).toHaveTextContent("Idle");
    expect(screen.queryByText("합계")).toBeNull();
  });

  it("opens a project's breakdown by feature only", async () => {
    vi.mocked(getUsageReport).mockResolvedValue(report());
    render(<AdminUsagePage />);
    await userEvent.click(await screen.findByText("Busy"));
    expect(screen.getByText("Discovery 대화")).toBeInTheDocument();
    expect(screen.getByText(/claude-mystery/)).toBeInTheDocument();
    expect(screen.queryByText("모델별")).toBeNull();
  });

  it("says when a project has no usage yet", async () => {
    vi.mocked(getUsageReport).mockResolvedValue(report());
    render(<AdminUsagePage />);
    await userEvent.click(await screen.findByText("Idle"));
    expect(screen.getByText("아직 집계된 사용량이 없습니다.")).toBeInTheDocument();
  });

  it("pages through the projects", async () => {
    vi.mocked(getUsageReport)
      .mockResolvedValueOnce(report({ total: 12 }))
      .mockResolvedValueOnce(report({
        total: 12, page: 2, projects: [project("p-late", "Late", bucket())],
      }));
    render(<AdminUsagePage />);
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("총 12건")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /다음/ }));
    expect(await screen.findByText("Late")).toBeInTheDocument();
    expect(getUsageReport).toHaveBeenLastCalledWith(2, 10);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("says where the prices came from", async () => {
    vi.mocked(getUsageReport).mockResolvedValue(report());
    render(<AdminUsagePage />);
    expect(await screen.findByText(/AWS Price List 2026-11-01 기준 \(ap-northeast-2\)/))
      .toBeInTheDocument();
  });

  it("points at the missing permission while prices are still the built-in ones", async () => {
    vi.mocked(getUsageReport).mockResolvedValue(
      report({ pricing: { source: "builtin", as_of: "2026-10-29" } }));
    render(<AdminUsagePage />);
    expect(await screen.findByText(/내장 기본값\(2026-10-29 기준\)/)).toBeInTheDocument();
    expect(screen.getByText(/pricing:GetProducts/)).toBeInTheDocument();
  });

  it("keeps the refresh button from being squeezed by the subtitle", async () => {
    vi.mocked(getUsageReport).mockResolvedValue(report());
    render(<AdminUsagePage />);
    const button = await screen.findByRole("button", { name: "새로 고침" });
    expect(button.className).toMatch(/shrink-0/);
    expect(button.className).toMatch(/whitespace-nowrap/);
  });

  it("tells a pm that the page needs an admin", async () => {
    vi.mocked(getUsageReport).mockRejectedValue(new ApiError(403, "forbidden"));
    render(<AdminUsagePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("관리자 권한이 필요합니다.");
  });
});

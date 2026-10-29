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
import { getUsageReport, type UsageBucket, type UsageReport } from "@/lib/api/usage";

function bucket(over: Partial<UsageBucket> = {}): UsageBucket {
  return {
    requests: 0, long_context_requests: 0, cost_usd: 0, cache_hit_rate: null,
    tokens: { input: 0, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 },
    ...over,
  };
}

function report(): UsageReport {
  const busy = bucket({
    requests: 12, cost_usd: 3.5, cache_hit_rate: 0.8,
    tokens: { input: 1000, output: 500, cache_write_5m: 1000, cache_write_1h: 0, cache_read: 8000 },
  });
  return {
    estimate: true,
    pricing: { source: "price_list", as_of: "2026-11-01T00:00:00+00:00", region: "ap-northeast-2" },
    total: { ...busy, unpriced_models: [] },
    projects: [
      { project_id: "p-idle", name: "Idle", owner: "a@x", created_at: null, model_id: null,
        usage: { ...bucket(), by_source: {}, by_model: {}, unpriced_models: [], updated_at: null } },
      { project_id: "p-busy", name: "Busy", owner: "b@x", created_at: null, model_id: null,
        usage: { ...busy, by_source: { discovery: busy },
                 by_model: { "claude-opus-5-5#regional": busy },
                 unpriced_models: ["claude-mystery"], updated_at: null } },
    ],
  };
}

beforeEach(() => vi.clearAllMocks());

describe("admin usage page", () => {
  it("lists the most expensive project first, with the total", async () => {
    vi.mocked(getUsageReport).mockResolvedValue(report());
    render(<AdminUsagePage />);
    await waitFor(() => expect(screen.getByText("Busy")).toBeInTheDocument());
    const rows = screen.getAllByRole("row");
    // header, Busy, Idle, total
    expect(rows[1]).toHaveTextContent("Busy");
    expect(rows[2]).toHaveTextContent("Idle");
    expect(rows[1]).toHaveTextContent("80%");
    expect(rows[rows.length - 1]).toHaveTextContent("합계");
  });

  it("opens a project's breakdown by feature and model", async () => {
    vi.mocked(getUsageReport).mockResolvedValue(report());
    render(<AdminUsagePage />);
    await userEvent.click(await screen.findByText("Busy"));
    expect(screen.getByText("Discovery 대화")).toBeInTheDocument();
    expect(screen.getByText(/claude-opus-5-5 \(리전 엔드포인트\)/)).toBeInTheDocument();
    expect(screen.getByText(/claude-mystery/)).toBeInTheDocument();
  });

  it("says when a project has no usage yet", async () => {
    vi.mocked(getUsageReport).mockResolvedValue(report());
    render(<AdminUsagePage />);
    await userEvent.click(await screen.findByText("Idle"));
    expect(screen.getByText("아직 집계된 사용량이 없습니다.")).toBeInTheDocument();
  });

  it("says where the prices came from", async () => {
    vi.mocked(getUsageReport).mockResolvedValue(report());
    render(<AdminUsagePage />);
    expect(await screen.findByText(/AWS Price List 2026-11-01 기준 \(ap-northeast-2\)/))
      .toBeInTheDocument();
  });

  it("points at the missing permission while prices are still the built-in ones", async () => {
    vi.mocked(getUsageReport).mockResolvedValue(
      { ...report(), pricing: { source: "builtin", as_of: "2026-10-29" } });
    render(<AdminUsagePage />);
    expect(await screen.findByText(/내장 기본값\(2026-10-29 기준\)/)).toBeInTheDocument();
    expect(screen.getByText(/pricing:GetProducts/)).toBeInTheDocument();
  });

  it("tells a pm that the page needs an admin", async () => {
    vi.mocked(getUsageReport).mockRejectedValue(new ApiError(403, "forbidden"));
    render(<AdminUsagePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("관리자 권한이 필요합니다.");
  });
});

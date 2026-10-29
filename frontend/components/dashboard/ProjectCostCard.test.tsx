import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/api/usage", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/usage")>()),
  getProjectUsage: vi.fn(),
}));
import { getProjectUsage, type ProjectUsageReport, type UsageBucket } from "@/lib/api/usage";
import { ProjectCostCard } from "./ProjectCostCard";

const BUSY: UsageBucket = {
  requests: 4, long_context_requests: 0, cost_usd: 12.5, cache_hit_rate: 0.9,
  tokens: { input: 100, output: 50, cache_write_5m: 0, cache_write_1h: 0, cache_read: 900 },
};

function usage(b: UsageBucket = BUSY): ProjectUsageReport {
  return {
    project_id: "ws-m", name: "M", owner: null, created_at: null, model_id: null,
    usage: { ...b, by_source: b.requests ? { prototype: b } : {}, unpriced_models: [],
             updated_at: null },
    estimate: true,
    pricing: { source: "builtin", as_of: "2026-10-29" },
  };
}

function signedInAs(role: "admin" | "pm") {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ authenticated: true, role }), { status: 200 })));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("ProjectCostCard", () => {
  it("shows the project's estimated cost to an admin", async () => {
    signedInAs("admin");
    vi.mocked(getProjectUsage).mockResolvedValue(usage());
    render(<ProjectCostCard projectId="ws-m" />);
    expect(await screen.findByText(/12\.50/)).toBeInTheDocument();
    expect(getProjectUsage).toHaveBeenCalledWith("ws-m");
    expect(screen.getByText(/90%/)).toBeInTheDocument();
    // The per-feature rows stay folded until asked for.
    expect(screen.queryByText("프로토타입 빌드")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "기능별 보기" }));
    expect(screen.getByText("프로토타입 빌드")).toBeInTheDocument();
  });

  it("draws nothing for a pm and never asks for the usage", async () => {
    signedInAs("pm");
    const { container } = render(<ProjectCostCard projectId="ws-m" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(getProjectUsage).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("says so when a project has no usage yet", async () => {
    signedInAs("admin");
    vi.mocked(getProjectUsage).mockResolvedValue(usage({ ...BUSY, requests: 0, cost_usd: 0 }));
    render(<ProjectCostCard projectId="ws-m" />);
    expect(await screen.findByText("아직 집계된 사용량이 없습니다.")).toBeInTheDocument();
  });
});

// frontend/lib/api/usage.ts — token usage and estimated cost per project (admins).
//
// The backend (routes/usage.py) does all the arithmetic, cost included — the price table lives
// there (aipds/pricing.py), so this side only formats.
import { apiFetch } from "./http";

export const TOKEN_FIELDS = [
  "input", "output", "cache_write_5m", "cache_write_1h", "cache_read",
] as const;
export type TokenField = (typeof TOKEN_FIELDS)[number];

export const USAGE_SOURCES = ["discovery", "prototype", "survey", "handoff"] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];

export interface UsageBucket {
  requests: number;
  long_context_requests: number;
  tokens: Record<TokenField, number>;
  cost_usd: number;
  // cache_read / (input + cache writes + cache_read). null when nothing was sent.
  cache_hit_rate: number | null;
}

export interface ProjectUsageSummary extends UsageBucket {
  by_source: Partial<Record<UsageSource, UsageBucket>>;
  // Key is the model name; a `#regional` suffix marks usage through a regional endpoint.
  by_model: Record<string, UsageBucket>;
  // Models with no price in the backend table — counted in tokens, not in cost_usd.
  unpriced_models: string[];
  updated_at: string | null;
}

export interface ProjectUsage {
  project_id: string;
  name: string | null;
  owner: string | null;
  created_at: string | null;
  model_id: string | null;
  usage: ProjectUsageSummary;
}

// Where the prices came from. `price_list` = the snapshot `aipds-update` refreshes from the AWS
// Price List API; `builtin` = the backend's own table (no snapshot yet, e.g. before the IAM
// permission is deployed). `as_of` is an ISO time for price_list and a date for builtin.
export interface PricingSource {
  source: "price_list" | "builtin";
  as_of: string | null;
  region?: string | null;
}

export interface UsageReport {
  projects: ProjectUsage[];
  total: UsageBucket & { unpriced_models: string[] };
  estimate: boolean;
  pricing: PricingSource;
}

export async function getUsageReport(): Promise<UsageReport> {
  return (await apiFetch<UsageReport>("/admin/usage")) as UsageReport;
}

export function totalTokens(b: UsageBucket): number {
  return TOKEN_FIELDS.reduce((sum, f) => sum + b.tokens[f], 0);
}

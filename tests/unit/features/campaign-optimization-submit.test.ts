import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: "tenant-1", userId: "user-1", role: "marketing" })),
}));
vi.mock("@/services/ai-jobs", () => ({ runAiJob: vi.fn() }));
vi.mock("@/lib/ai/prompts", () => ({ buildSystemPreamble: () => "s", buildOptimizationRecommendationPrompt: () => "p" }));
vi.mock("@/services/budget-guard", () => ({
  getOrCreateBudgetPolicy: vi.fn(async () => ({
    tenant_id: "tenant-1",
    daily_limit: null,
    monthly_limit: null,
    campaign_limit: null,
    currency: "IDR",
    require_approval_above: null,
    autopilot_limit: null,
    created_at: "",
    updated_at: "",
  })),
  getMonthToDateSpend: vi.fn(async () => 0),
}));

const { approvalInsert, auditInsert } = vi.hoisted(() => ({
  approvalInsert: vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: "ap-1" }, error: null }) }) })),
  auditInsert: vi.fn(async () => ({ error: null })),
}));

// A budget INCREASE re-checks the minimum delivery data (proposed thresholds, UNVERIFIED: >= 3 days, >= 1000 impressions,
// >= 100 clicks; lib/campaigns/optimization-data-sufficiency.ts). By default the channel has enough; tests override it.
const { metricsState } = vi.hoisted(() => ({
  metricsState: {
    result: {
      data: [1, 2, 3].map((d) => ({ spend: 10, impressions: 1500, clicks: 60, reach: 1200, date: `2026-10-0${d}` })) as unknown[],
      error: null as { message: string } | null,
    },
  },
}));

function rowsRead() {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) builder[method] = () => builder;
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(metricsState.result).then(resolve, reject);
  return builder;
}

function reads(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) builder[method] = () => builder;
  builder.single = async () => result;
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "prompter_channel_campaigns") return reads({ data: { id: "cc1", channel: "FACEBOOK", status: "ACTIVE" }, error: null });
      if (table === "prompter_master_campaigns") return reads({ data: { currency: "IDR" }, error: null });
      if (table === "prompter_marketing_metrics") return rowsRead();
      if (table === "prompter_approvals") return { insert: approvalInsert };
      if (table === "prompter_audit_logs") return { insert: auditInsert };
      throw new Error(`Unexpected table: ${table}`);
    },
  })),
}));

import { submitRecommendationAsApprovalAction } from "@/features/campaigns/optimization-actions";

describe("submitRecommendationAsApprovalAction — re-validates client-supplied arguments before any approval exists", () => {
  beforeEach(() => {
    approvalInsert.mockClear();
    auditInsert.mockClear();
    metricsState.result = {
      data: [1, 2, 3].map((d) => ({ spend: 10, impressions: 1500, clicks: 60, reach: 1200, date: `2026-10-0${d}` })),
      error: null,
    };
  });

  it.each([
    ["null budget", null],
    ["zero", 0],
    ["negative", -5],
    ["fraction", 50000.5],
    ["NaN", Number.NaN],
    ["beyond a safe integer", Number.MAX_SAFE_INTEGER + 2],
  ])("INCREASE_BUDGET with %s is refused and nothing is inserted", async (_label, budget) => {
    const result = await submitRecommendationAsApprovalAction("mc1", "FACEBOOK", "INCREASE_BUDGET", budget as number | null, "alasan", "LOW");
    expect(result.error).toMatch(/budget harian pada rekomendasi tidak valid/);
    expect(approvalInsert).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("DECREASE_BUDGET without a budget is refused too", async () => {
    const result = await submitRecommendationAsApprovalAction("mc1", "FACEBOOK", "DECREASE_BUDGET", null, "alasan", "LOW");
    expect(result.error).toMatch(/tidak valid/);
    expect(approvalInsert).not.toHaveBeenCalled();
  });

  it("an unknown action type is refused", async () => {
    const result = await submitRecommendationAsApprovalAction("mc1", "FACEBOOK", "DELETE_EVERYTHING" as never, null, "alasan", "LOW");
    expect(result.error).toMatch(/tidak dikenali/);
    expect(approvalInsert).not.toHaveBeenCalled();
  });

  it("a whole-rupiah budget still reaches the Approval Center (PENDING approval, owner decides)", async () => {
    const result = await submitRecommendationAsApprovalAction("mc1", "FACEBOOK", "INCREASE_BUDGET", 80000, "alasan", "LOW");
    expect(result.error).toBeNull();
    expect(approvalInsert).toHaveBeenCalledTimes(1);
  });

  it("PAUSE_CHANNEL needs no budget and still reaches the Approval Center", async () => {
    const result = await submitRecommendationAsApprovalAction("mc1", "FACEBOOK", "PAUSE_CHANNEL", null, "alasan", "LOW");
    expect(result.error).toBeNull();
    expect(approvalInsert).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["only 1 day of data", [{ spend: 10, impressions: 5000, clicks: 300, date: "2026-10-01" }]],
    ["too few impressions", [1, 2, 3].map((d) => ({ spend: 10, impressions: 100, clicks: 50, date: `2026-10-0${d}` }))],
    ["too few clicks", [1, 2, 3].map((d) => ({ spend: 10, impressions: 1500, clicks: 10, date: `2026-10-0${d}` }))],
    ["no metrics at all", []],
  ])("INCREASE_BUDGET with %s is refused (minimum data, proposed thresholds) and nothing is inserted", async (_label, rows) => {
    metricsState.result = { data: rows, error: null };
    const result = await submitRecommendationAsApprovalAction("mc1", "FACEBOOK", "INCREASE_BUDGET", 80000, "alasan", "LOW");
    expect(result.error).toMatch(/Data belum cukup untuk menaikkan budget/);
    expect(result.error).toMatch(/usulan, belum divalidasi/);
    expect(approvalInsert).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("INCREASE_BUDGET fails closed when the metrics cannot be read", async () => {
    metricsState.result = { data: [], error: { message: "rls" } };
    const result = await submitRecommendationAsApprovalAction("mc1", "FACEBOOK", "INCREASE_BUDGET", 80000, "alasan", "LOW");
    expect(result.error).toMatch(/Gagal membaca data iklan/);
    expect(approvalInsert).not.toHaveBeenCalled();
  });

  it("DECREASE_BUDGET and PAUSE_CHANNEL are not subject to the click threshold", async () => {
    metricsState.result = { data: [], error: null };
    expect((await submitRecommendationAsApprovalAction("mc1", "FACEBOOK", "DECREASE_BUDGET", 30000, "alasan", "LOW")).error).toBeNull();
    expect((await submitRecommendationAsApprovalAction("mc1", "FACEBOOK", "PAUSE_CHANNEL", null, "alasan", "LOW")).error).toBeNull();
    expect(approvalInsert).toHaveBeenCalledTimes(2);
  });
});

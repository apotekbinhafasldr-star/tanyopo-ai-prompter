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
});

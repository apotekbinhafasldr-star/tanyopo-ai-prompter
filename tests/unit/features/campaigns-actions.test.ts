import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/services/budget-guard", () => ({
  getOrCreateBudgetPolicy: vi.fn(async () => ({})),
  getMonthToDateSpend: vi.fn(async () => 0),
  checkBudgetGuard: vi.fn(() => ({ allowed: true, reason: null })),
}));

const { setChannelCampaignsStatusMock } = vi.hoisted(() => ({
  setChannelCampaignsStatusMock: vi.fn(async () => undefined),
}));
vi.mock("@/services/channel-campaigns", () => ({
  syncChannelCampaigns: vi.fn(async () => undefined),
  setChannelCampaignsStatus: setChannelCampaignsStatusMock,
}));

/**
 * Builds a table-dispatching Supabase mock: `.from("prompter_master_campaigns")`
 * returns the campaign row via select().eq().eq().single(); `.from("prompter_approvals")`
 * supports both insert() and delete().eq().eq().eq().eq(); `.from("prompter_audit_logs")`
 * supports insert(). `.rpc()` is a separate top-level mock.
 */
function buildSupabase(opts: {
  campaign: { id: string; status: string; daily_budget: number | null; total_budget: number | null; currency: string };
  approvalInsertError?: { message: string } | null;
  rpcResult: { data: unknown; error: { message: string } | null };
}) {
  const campaignSingle = vi.fn(async () => ({ data: opts.campaign, error: null }));
  const campaignEq2 = vi.fn(() => ({ single: campaignSingle }));
  const campaignEq1 = vi.fn(() => ({ eq: campaignEq2 }));
  const campaignSelect = vi.fn(() => ({ eq: campaignEq1 }));

  const approvalInsert = vi.fn(async () => ({ error: opts.approvalInsertError ?? null }));
  const deleteEq4 = vi.fn(async () => ({ error: null }));
  const deleteEq3 = vi.fn(() => ({ eq: deleteEq4 }));
  const deleteEq2 = vi.fn(() => ({ eq: deleteEq3 }));
  const deleteEq1 = vi.fn(() => ({ eq: deleteEq2 }));
  const approvalDelete = vi.fn(() => ({ eq: deleteEq1 }));

  const auditInsert = vi.fn(async () => ({ error: null }));

  const from = vi.fn((table: string) => {
    if (table === "prompter_master_campaigns") return { select: campaignSelect };
    if (table === "prompter_approvals") return { insert: approvalInsert, delete: approvalDelete };
    if (table === "prompter_audit_logs") return { insert: auditInsert };
    throw new Error(`unexpected table ${table}`);
  });

  const rpc = vi.fn(async () => opts.rpcResult);

  return { from, rpc, approvalInsert, approvalDelete, auditInsert };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => currentSupabase),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentSupabase: any;

import { submitForApprovalAction } from "@/features/campaigns/actions";

describe("submitForApprovalAction — Batch B9 P0-1/P2-2", () => {
  const draftCampaign = { id: "c1", status: "DRAFT", daily_budget: 100, total_budget: 1000, currency: "IDR" };

  beforeEach(() => {
    setChannelCampaignsStatusMock.mockClear();
  });

  it("the 5th consuming campaign on Starter succeeds — calls fn_reserve_active_campaign_slot and proceeds to sync/audit", async () => {
    currentSupabase = buildSupabase({
      campaign: draftCampaign,
      rpcResult: { data: [{ allowed: true, reason: null }], error: null },
    });

    const result = await submitForApprovalAction("c1");

    expect(result.error).toBeNull();
    expect(currentSupabase.rpc).toHaveBeenCalledWith("fn_reserve_active_campaign_slot", { p_campaign_id: "c1" });
    expect(setChannelCampaignsStatusMock).toHaveBeenCalledWith(expect.anything(), "c1", "AWAITING_APPROVAL");
    expect(currentSupabase.auditInsert).toHaveBeenCalled();
  });

  it("the 6th consuming campaign is rejected (CAMPAIGN_LIMIT_REACHED) and the orphaned PENDING approval row is deleted", async () => {
    currentSupabase = buildSupabase({
      campaign: draftCampaign,
      rpcResult: { data: [{ allowed: false, reason: "CAMPAIGN_LIMIT_REACHED" }], error: null },
    });

    const result = await submitForApprovalAction("c1");

    expect(result.error).toMatch(/batas jumlah campaign aktif/i);
    expect(currentSupabase.approvalDelete).toHaveBeenCalled();
    expect(setChannelCampaignsStatusMock).not.toHaveBeenCalled();
  });

  it("never attempts the reservation RPC for a campaign that isn't DRAFT (rejected before reaching the atomic check)", async () => {
    currentSupabase = buildSupabase({
      campaign: { ...draftCampaign, status: "AWAITING_APPROVAL" },
      rpcResult: { data: [{ allowed: true, reason: null }], error: null },
    });

    const result = await submitForApprovalAction("c1");

    expect(result.error).toMatch(/sudah diajukan/i);
    expect(currentSupabase.rpc).not.toHaveBeenCalled();
  });
});

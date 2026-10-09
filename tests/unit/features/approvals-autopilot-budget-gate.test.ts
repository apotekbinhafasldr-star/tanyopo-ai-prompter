import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApprovalHarness } from "../helpers/budget-gate-harness";

// REAL External Budget Safety Gate: no gate mock in this file.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("@/services/channel-campaigns", () => ({ setChannelCampaignsStatus: vi.fn() }));

const { decryptTokenMock } = vi.hoisted(() => ({ decryptTokenMock: vi.fn(() => "access-token-abc") }));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: decryptTokenMock }));

const { connectorMock, getConnectorMock } = vi.hoisted(() => {
  const connectorMock = {
    isConfigured: vi.fn(() => true),
    pauseCampaign: vi.fn(async () => undefined),
    updateBudget: vi.fn(async () => undefined),
  };
  return { connectorMock, getConnectorMock: vi.fn(() => connectorMock) };
});
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: getConnectorMock }));

let harness: ReturnType<typeof buildApprovalHarness>;
const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: harness.from })) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock.mockImplementation(() => ({ from: (t: string) => harness.adminFrom(t) })),
}));

import { decideApprovalAction } from "@/features/approvals/actions";

function expectNoCredentialOrApiWrite() {
  expect(harness.touched).not.toContain("prompter_connected_accounts");
  expect(harness.touched.some((t) => t.startsWith("admin:"))).toBe(false);
  expect(createAdminClientMock).not.toHaveBeenCalled();
  expect(decryptTokenMock).not.toHaveBeenCalled();
  expect(getConnectorMock).not.toHaveBeenCalled();
  expect(connectorMock.updateBudget).not.toHaveBeenCalled();
  expect(connectorMock.pauseCampaign).not.toHaveBeenCalled();
}

function auditActions(): string[] {
  return harness.auditInsert.mock.calls.map((call) => (call[0] as { action: string }).action);
}

describe("autopilot budget write — real gate, default deny", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAdminClientMock.mockImplementation(() => ({ from: (t: string) => harness.adminFrom(t) }));
  });

  it.each([
    ["INCREASE_BUDGET", "FACEBOOK"],
    ["DECREASE_BUDGET", "FACEBOOK"],
    ["INCREASE_BUDGET", "INSTAGRAM"],
    ["INCREASE_BUDGET", "TIKTOK"],
    ["DECREASE_BUDGET", "TIKTOK"],
    ["INCREASE_BUDGET", "X"],
    ["DECREASE_BUDGET", "X"],
  ])("denies %s on %s before credentials are read and before updateBudget", async (actionType, channel) => {
    harness = buildApprovalHarness({ actionType, channel });

    const result = await decideApprovalAction("ap1", "APPROVED", null);

    expect(result.error).toBeNull();
    expectNoCredentialOrApiWrite();
    expect(harness.channelUpdates).toEqual([]);
    expect(auditActions()).toEqual(["autopilot_action.blocked_budget_gate"]);
    expect(harness.auditInsert.mock.calls[0][0]).toMatchObject({
      context: { action_type: actionType, gate_code: "PLATFORM_DISABLED" },
    });
    const reasonUpdate = harness.approvalUpdates.find((u) => "reason" in u && String(u.reason).includes("Eksekusi dibatalkan"));
    expect(reasonUpdate).toBeDefined();
  });

  it("denies a budget change with Emergency Stop active through the existing Emergency Stop block (unchanged)", async () => {
    harness = buildApprovalHarness({
      actionType: "INCREASE_BUDGET",
      settings: { data: { emergency_stop_active: true }, error: null },
    });
    await decideApprovalAction("ap1", "APPROVED", null);
    expect(auditActions()).toEqual(["autopilot_action.blocked_emergency_stop"]);
    expectNoCredentialOrApiWrite();
  });
});

describe("autopilot — paths that must be unchanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAdminClientMock.mockImplementation(() => ({ from: (t: string) => harness.adminFrom(t) }));
  });

  it("PAUSE_CHANNEL still pauses the campaign and marks the channel PAUSED", async () => {
    harness = buildApprovalHarness({ actionType: "PAUSE_CHANNEL", suggestedDailyBudget: null });

    const result = await decideApprovalAction("ap1", "APPROVED", null);

    expect(result.error).toBeNull();
    expect(connectorMock.pauseCampaign).toHaveBeenCalledWith("access-token-abc", "act_123", "ext_campaign_1");
    expect(harness.channelUpdates).toEqual([{ status: "PAUSED" }]);
    expect(connectorMock.updateBudget).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["autopilot_action.executed"]);
  });

  it("PAUSE_CHANNEL is still blocked by the existing Emergency Stop check", async () => {
    harness = buildApprovalHarness({
      actionType: "PAUSE_CHANNEL",
      suggestedDailyBudget: null,
      settings: { data: { emergency_stop_active: true }, error: null },
    });
    await decideApprovalAction("ap1", "APPROVED", null);
    expect(auditActions()).toEqual(["autopilot_action.blocked_emergency_stop"]);
    expect(connectorMock.pauseCampaign).not.toHaveBeenCalled();
  });

  it("NO_ACTION still does nothing: no settings, channel, credential or connector access", async () => {
    harness = buildApprovalHarness({ actionType: "NO_ACTION", suggestedDailyBudget: null });

    const result = await decideApprovalAction("ap1", "APPROVED", null);

    expect(result.error).toBeNull();
    expect(harness.touched).not.toContain("prompter_automation_settings");
    expect(harness.touched).not.toContain("prompter_channel_campaigns");
    expectNoCredentialOrApiWrite();
    expect(harness.auditInsert).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApprovalHarness } from "../helpers/budget-gate-harness";

// REAL External Budget Safety Gate: no gate mock in this file.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("@/services/channel-campaigns", () => ({
  mirrorChannelCampaignStatus: vi.fn(async () => ({ ok: true, updated: 0, consistent: true })),
  transitionMasterCampaign: vi.fn(async () => "moved"),
  checkChannelCampaignState: vi.fn(async () => ({ ok: true, consistent: true })),
  isMirrorConfirmed: vi.fn(() => true),
}));

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

// ---------------------------------------------------------------------------
// PR #37 / A4 — PAUSE_CHANNEL hardening. The platform pause is idempotent and
// is never repeated: a mismatch is reported, audited safely, and left alone.
// ---------------------------------------------------------------------------
describe("autopilot PAUSE_CHANNEL hardening (PR #37 / A4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAdminClientMock.mockImplementation(() => ({ from: (t: string) => harness.adminFrom(t) }));
    connectorMock.pauseCampaign.mockReset().mockResolvedValue(undefined);
  });

  function reasonNote(): string {
    const update = harness.approvalUpdates.find((u) => "reason" in u && u.reason);
    return String(update?.reason ?? "");
  }

  it("the PAUSED write is scoped by id, tenant and current ACTIVE status", async () => {
    harness = buildApprovalHarness({ actionType: "PAUSE_CHANNEL", suggestedDailyBudget: null });
    await decideApprovalAction("ap1", "APPROVED", null);

    expect(harness.channelUpdates).toEqual([{ status: "PAUSED" }]);
    expect(harness.channelUpdateFilters[0]).toEqual([
      ["id", "cc1"],
      ["tenant_id", "t1"],
      ["status", "ACTIVE"],
    ]);
  });

  it("exactly one confirmed row: success is reported and audited as executed", async () => {
    harness = buildApprovalHarness({ actionType: "PAUSE_CHANNEL", suggestedDailyBudget: null });
    await decideApprovalAction("ap1", "APPROVED", null);

    expect(auditActions()).toEqual(["autopilot_action.executed"]);
    expect(reasonNote()).toBe("");
  });

  it.each(["zero", "two", "error", "throw"] as const)(
    "a PAUSED write that does not confirm exactly one row (%s) is not reported as success",
    async (pauseUpdate) => {
      harness = buildApprovalHarness({ actionType: "PAUSE_CHANNEL", suggestedDailyBudget: null, pauseUpdate });

      const result = await decideApprovalAction("ap1", "APPROVED", null);

      expect(result.error).toBeNull(); // the approval decision itself was saved
      expect(connectorMock.pauseCampaign).toHaveBeenCalledTimes(1); // never repeated
      expect(auditActions()).toEqual(["autopilot_action.status_mismatch"]);
      expect(auditActions()).not.toContain("autopilot_action.executed");
      expect(harness.auditInsert.mock.calls[0][0]).toMatchObject({
        tenant_id: "t1",
        context: { platform: "META", action_type: "PAUSE_CHANNEL", platform_paused: true, status_recorded: false },
      });
      expect(reasonNote()).toContain("GAGAL diperbarui");
      expect(reasonNote()).toContain("Tidak ada percobaan ulang otomatis");
      // Nothing from the database error leaks into the note or the audit.
      expect(reasonNote() + JSON.stringify(harness.auditInsert.mock.calls)).not.toMatch(/secret/);
    },
  );

  it("a provider error never leaks its message into the audit log or the approval reason", async () => {
    harness = buildApprovalHarness({ actionType: "PAUSE_CHANNEL", suggestedDailyBudget: null });
    connectorMock.pauseCampaign.mockRejectedValue(
      Object.assign(new Error("Invalid OAuth access token EAAB-secret-token for act_123"), {
        name: "ConnectorApiError",
        status: 400,
        code: 190,
      }),
    );

    await decideApprovalAction("ap1", "APPROVED", null);

    const everything = reasonNote() + JSON.stringify(harness.auditInsert.mock.calls);
    expect(everything).not.toContain("EAAB");
    expect(everything).not.toContain("secret-token");
    expect(everything).not.toContain("Invalid OAuth");
    expect(auditActions()).toEqual(["autopilot_action.execution_failed"]);
    expect(harness.auditInsert.mock.calls[0][0]).toMatchObject({
      context: { error: "ConnectorApiError, HTTP 400, kode 190" },
    });
    expect(reasonNote()).toContain("ConnectorApiError, HTTP 400, kode 190");
    // A failed platform call leaves LINOE's status alone and is not retried.
    expect(harness.channelUpdates).toEqual([]);
    expect(connectorMock.pauseCampaign).toHaveBeenCalledTimes(1);
  });

  it("a thrown non-Error value is summarised without its content", async () => {
    harness = buildApprovalHarness({ actionType: "PAUSE_CHANNEL", suggestedDailyBudget: null });
    connectorMock.pauseCampaign.mockRejectedValue("raw string with EAAB-secret-token");

    await decideApprovalAction("ap1", "APPROVED", null);

    expect(reasonNote() + JSON.stringify(harness.auditInsert.mock.calls)).not.toContain("EAAB");
  });

  it("permissions and policy are unchanged: Emergency Stop still blocks before the platform is touched", async () => {
    harness = buildApprovalHarness({
      actionType: "PAUSE_CHANNEL",
      suggestedDailyBudget: null,
      settings: { data: { emergency_stop_active: true }, error: null },
    });
    await decideApprovalAction("ap1", "APPROVED", null);
    expect(auditActions()).toEqual(["autopilot_action.blocked_emergency_stop"]);
    expect(connectorMock.pauseCampaign).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApprovalHarness } from "../helpers/budget-gate-harness";

// REAL gate logic; only the platform enablement list is injected (META on) to
// reach the evidence layers behind the default-deny platform lock.
vi.mock("@/lib/campaigns/external-budget-guard", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/campaigns/external-budget-guard")>();
  const enabled = ["META"] as const;
  return {
    ...real,
    isBudgetWritePlatformEnabled: (platform: Parameters<typeof real.isBudgetWritePlatformEnabled>[0]) =>
      real.isBudgetWritePlatformEnabled(platform, enabled),
    evaluateExternalBudgetWrite: (request: Parameters<typeof real.evaluateExternalBudgetWrite>[0]) =>
      real.evaluateExternalBudgetWrite(request, enabled),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("@/services/channel-campaigns", () => ({ setChannelCampaignsStatus: vi.fn() }));
const { decryptTokenMock } = vi.hoisted(() => ({ decryptTokenMock: vi.fn(() => "access-token-abc") }));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: decryptTokenMock }));
const { connectorMock, getConnectorMock } = vi.hoisted(() => {
  const connectorMock = { isConfigured: vi.fn(() => true), pauseCampaign: vi.fn(), updateBudget: vi.fn() };
  return { connectorMock, getConnectorMock: vi.fn(() => connectorMock) };
});
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: getConnectorMock }));

let harness: ReturnType<typeof buildApprovalHarness>;
const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: harness.from })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { decideApprovalAction } from "@/features/approvals/actions";

function gateCode(): unknown {
  const call = harness.auditInsert.mock.calls.find(
    (c) => (c[0] as { action: string }).action === "autopilot_action.blocked_budget_gate",
  );
  return (call?.[0] as { context?: { gate_code?: string } } | undefined)?.context?.gate_code;
}

function expectNoCredentialOrApiWrite() {
  expect(harness.touched).not.toContain("prompter_connected_accounts");
  expect(createAdminClientMock).not.toHaveBeenCalled();
  expect(decryptTokenMock).not.toHaveBeenCalled();
  expect(getConnectorMock).not.toHaveBeenCalled();
  expect(connectorMock.updateBudget).not.toHaveBeenCalled();
}

describe("autopilot budget write — gate evidence layer (META enabled for the test only)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["INCREASE_BUDGET", "DECREASE_BUDGET"])(
    "%s is denied because the ad-account currency and current external budget are unverified",
    async (actionType) => {
      harness = buildApprovalHarness({ actionType });
      await decideApprovalAction("ap1", "APPROVED", null);
      expect(gateCode()).toBe("CURRENCY_UNVERIFIED");
      expectNoCredentialOrApiWrite();
    },
  );

  it("fails closed when the Emergency Stop flag cannot be read (the old read ignores the error; the gate does not)", async () => {
    harness = buildApprovalHarness({ actionType: "INCREASE_BUDGET", settings: { data: null, error: { message: "rls" } } });
    await decideApprovalAction("ap1", "APPROVED", null);
    expect(gateCode()).toBe("EMERGENCY_STOP_UNKNOWN");
    expectNoCredentialOrApiWrite();
  });

  it("fails closed when reading the Emergency Stop flag throws", async () => {
    harness = buildApprovalHarness({ actionType: "INCREASE_BUDGET", settings: "throw" });
    await decideApprovalAction("ap1", "APPROVED", null).catch(() => undefined);
    expect(harness.touched).not.toContain("prompter_connected_accounts");
    expect(connectorMock.updateBudget).not.toHaveBeenCalled();
  });

  it("denies an invalid suggested budget before anything else is read", async () => {
    harness = buildApprovalHarness({ actionType: "INCREASE_BUDGET", suggestedDailyBudget: 0 });
    await decideApprovalAction("ap1", "APPROVED", null);
    expect(gateCode()).toBe("BUDGET_INVALID");
    expectNoCredentialOrApiWrite();
  });

  it("denies a fractional suggested budget (no silent rounding)", async () => {
    harness = buildApprovalHarness({ actionType: "INCREASE_BUDGET", suggestedDailyBudget: 60000.4 });
    await decideApprovalAction("ap1", "APPROVED", null);
    expect(gateCode()).toBe("BUDGET_INVALID");
    expectNoCredentialOrApiWrite();
  });

  it("keeps other platforms denied by the platform lock", async () => {
    harness = buildApprovalHarness({ actionType: "INCREASE_BUDGET", channel: "X" });
    await decideApprovalAction("ap1", "APPROVED", null);
    expect(gateCode()).toBe("PLATFORM_DISABLED");
    expectNoCredentialOrApiWrite();
  });
});

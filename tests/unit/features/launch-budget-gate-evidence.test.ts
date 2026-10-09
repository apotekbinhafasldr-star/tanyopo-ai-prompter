import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLaunchHarness } from "../helpers/budget-gate-harness";

// REAL gate logic. Only the platform enablement list is injected (META on) so
// the Emergency Stop and evidence layers behind the default-deny platform
// check can be exercised. The gate's own evaluation is NOT mocked.
vi.mock("@/lib/campaigns/external-budget-guard", async () => {
  // Test-only: the real evaluation logic from the internal core, with META on.
  const core = await import("@/lib/campaigns/external-budget-guard-core");
  const enabled: readonly import("@/types/database").ConnectorPlatform[] = ["META"];
  return {
    BUDGET_WRITE_DISABLED_MESSAGE: core.BUDGET_WRITE_DISABLED_MESSAGE,
    isBudgetWritePlatformEnabled: (platform: import("@/types/database").ConnectorPlatform) => enabled.includes(platform),
    evaluateExternalBudgetWrite: (request: import("@/lib/campaigns/external-budget-guard-core").ExternalBudgetWriteRequest) =>
      core.evaluateWithPlatforms(request, enabled),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
const { decryptTokenMock } = vi.hoisted(() => ({ decryptTokenMock: vi.fn(() => "access-token-abc") }));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: decryptTokenMock }));
const { connectorMock, getConnectorMock } = vi.hoisted(() => {
  const connectorMock = {
    createCampaign: vi.fn(async () => ({ id: "x" })),
    createAdSet: vi.fn(async () => ({ id: "x" })),
  };
  return { connectorMock, getConnectorMock: vi.fn(() => connectorMock) };
});
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: getConnectorMock }));

let harness: ReturnType<typeof buildLaunchHarness>;
const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: harness.from })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { launchChannelCampaignAction } from "@/features/campaigns/launch-actions";

function expectNoSideEffects() {
  expect(harness.claimUpdate).not.toHaveBeenCalled();
  expect(harness.auditInsert).not.toHaveBeenCalled();
  expect(harness.touched).not.toContain("prompter_connected_accounts");
  expect(createAdminClientMock).not.toHaveBeenCalled();
  expect(decryptTokenMock).not.toHaveBeenCalled();
  expect(getConnectorMock).not.toHaveBeenCalled();
  expect(connectorMock.createCampaign).not.toHaveBeenCalled();
  expect(connectorMock.createAdSet).not.toHaveBeenCalled();
}

describe("launchChannelCampaignAction — gate evidence layer (META enabled for the test only)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies when Emergency Stop is active", async () => {
    harness = buildLaunchHarness({ settings: { data: { emergency_stop_active: true }, error: null } });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/Emergency Stop aktif/);
    expect(harness.touched).toContain("prompter_automation_settings");
    expectNoSideEffects();
  });

  it("fails closed when the Emergency Stop flag cannot be read (query error)", async () => {
    harness = buildLaunchHarness({ settings: { data: null, error: { message: "rls" } } });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/Emergency Stop tidak dapat diverifikasi/);
    expectNoSideEffects();
  });

  it("fails closed when reading the Emergency Stop flag throws", async () => {
    harness = buildLaunchHarness({ settings: "throw" });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/Emergency Stop tidak dapat diverifikasi/);
    expectNoSideEffects();
  });

  it("fails closed on a malformed Emergency Stop value", async () => {
    harness = buildLaunchHarness({ settings: { data: { emergency_stop_active: "no" }, error: null } });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/Emergency Stop tidak dapat diverifikasi/);
    expectNoSideEffects();
  });

  it.each([
    ["no settings row", { data: null, error: null }],
    ["Emergency Stop inactive", { data: { emergency_stop_active: false }, error: null }],
  ])("still denies with %s because the ad-account currency is unverified", async (_label, settings) => {
    harness = buildLaunchHarness({ settings });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/Mata uang akun iklan belum terverifikasi/);
    expectNoSideEffects();
  });

  it("keeps other platforms denied by the platform lock even though META is enabled here", async () => {
    harness = buildLaunchHarness({ channel: "TIKTOK" });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/dinonaktifkan sementara/);
    expect(harness.touched).toEqual(["prompter_channel_campaigns"]);
    expectNoSideEffects();
  });
});

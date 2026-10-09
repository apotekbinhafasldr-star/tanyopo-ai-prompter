import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLaunchHarness } from "../helpers/budget-gate-harness";

// REAL External Budget Safety Gate: no gate mock in this file. Only I/O
// (session, Supabase, connectors, crypto) is replaced.
const { revalidatePathMock } = vi.hoisted(() => ({ revalidatePathMock: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const { sessionMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("@/services/session", () => ({ requireSessionContext: sessionMock }));

const { decryptTokenMock } = vi.hoisted(() => ({ decryptTokenMock: vi.fn(() => "access-token-abc") }));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: decryptTokenMock }));

const { connectorMock, getConnectorMock } = vi.hoisted(() => {
  const connectorMock = {
    isConfigured: vi.fn(() => true),
    createCampaign: vi.fn(async () => ({ id: "ext_campaign_1" })),
    createAdSet: vi.fn(async () => ({ id: "ext_adset_1" })),
    createCreative: vi.fn(async () => ({ id: "ext_creative_1" })),
    createAd: vi.fn(async () => ({ id: "ext_ad_1" })),
    updateBudget: vi.fn(async () => undefined),
  };
  return { connectorMock, getConnectorMock: vi.fn(() => connectorMock) };
});
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: getConnectorMock }));

let harness: ReturnType<typeof buildLaunchHarness>;
const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: harness.from })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { launchChannelCampaignAction } from "@/features/campaigns/launch-actions";
import { BUDGET_WRITE_DISABLED_MESSAGE } from "@/lib/campaigns/external-budget-guard";

function expectNothingHappened() {
  // Only the initial channel-row lookup may have happened.
  expect(harness.touched).toEqual(["prompter_channel_campaigns"]);
  expect(harness.claimUpdate).not.toHaveBeenCalled();
  expect(harness.auditInsert).not.toHaveBeenCalled();
  expect(createAdminClientMock).not.toHaveBeenCalled();
  expect(harness.adminFrom).not.toHaveBeenCalled();
  expect(decryptTokenMock).not.toHaveBeenCalled();
  expect(getConnectorMock).not.toHaveBeenCalled();
  expect(connectorMock.createCampaign).not.toHaveBeenCalled();
  expect(connectorMock.createAdSet).not.toHaveBeenCalled();
  expect(connectorMock.updateBudget).not.toHaveBeenCalled();
  expect(revalidatePathMock).not.toHaveBeenCalled();
}

describe("launchChannelCampaignAction — real gate, default deny", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "owner" });
  });
  afterEach(() => vi.clearAllMocks());

  it.each([
    ["FACEBOOK", "META"],
    ["INSTAGRAM", "META"],
    ["TIKTOK", "TIKTOK"],
    ["X", "X"],
  ])("denies %s (%s) before the claim, credentials, status update, audit or any API write", async (channel) => {
    harness = buildLaunchHarness({ channel });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBe(BUDGET_WRITE_DISABLED_MESSAGE);
    expectNothingHappened();
  });

  it.each(["owner", "marketing"])("denies for role %s — the gate does not depend on the caller's role", async (role) => {
    sessionMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role });
    harness = buildLaunchHarness({ channel: "FACEBOOK" });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBe(BUDGET_WRITE_DISABLED_MESSAGE);
    expectNothingHappened();
  });

  it("keeps the existing unsupported-channel message for SEO (unchanged behavior)", async () => {
    harness = buildLaunchHarness({ channel: "SEO" });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/belum didukung/);
    expectNothingHappened();
  });

  it("keeps the existing permission check for other roles (unchanged behavior)", async () => {
    sessionMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "viewer" });
    harness = buildLaunchHarness({ channel: "FACEBOOK" });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/tidak memiliki izin/);
    expect(harness.touched).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLaunchHarness } from "../helpers/budget-gate-harness";

// REAL External Budget Safety Gate (no gate mock): the launch-safety changes
// must not open S1. A denied launch never reaches the claim, the credentials
// or any platform API, however many requests arrive at once.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: vi.fn(() => "access-token-abc") }));

const { connectorMock } = vi.hoisted(() => ({
  connectorMock: {
    createCampaign: vi.fn(async () => ({ id: "c" })),
    createAdSet: vi.fn(async () => ({ id: "a" })),
    createCreative: vi.fn(async () => ({ id: "r" })),
    createAd: vi.fn(async () => ({ id: "d" })),
  },
}));
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: vi.fn(() => connectorMock) }));

let harness: ReturnType<typeof buildLaunchHarness>;
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: harness.from })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ from: harness.adminFrom })) }));

import { launchChannelCampaignAction } from "@/features/campaigns/launch-actions";
import { BUDGET_WRITE_DISABLED_MESSAGE } from "@/lib/campaigns/external-budget-guard";

describe("launch claim safety — S1 gate stays closed", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["FACEBOOK", "INSTAGRAM", "TIKTOK", "X"])(
    "11/12. %s: concurrent launches are all denied with no claim and no platform call",
    async (channel) => {
      harness = buildLaunchHarness({ channel });

      const results = await Promise.all([
        launchChannelCampaignAction("cc1"),
        launchChannelCampaignAction("cc1"),
        launchChannelCampaignAction("cc1"),
      ]);

      for (const result of results) expect(result.error).toBe(BUDGET_WRITE_DISABLED_MESSAGE);
      expect(harness.claimUpdate).not.toHaveBeenCalled();
      expect(harness.auditInsert).not.toHaveBeenCalled();
      expect(harness.adminFrom).not.toHaveBeenCalled();
      for (const fn of Object.values(connectorMock)) expect(fn).not.toHaveBeenCalled();
    },
  );
});

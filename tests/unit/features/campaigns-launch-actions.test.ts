import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireSessionContextMock } = vi.hoisted(() => ({
  requireSessionContextMock: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("@/services/session", () => ({ requireSessionContext: requireSessionContextMock }));

const { decryptTokenMock } = vi.hoisted(() => ({ decryptTokenMock: vi.fn(() => "access-token-abc") }));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: decryptTokenMock }));

const { connectorMock, getConnectorMock } = vi.hoisted(() => ({
  connectorMock: {
    createCampaign: vi.fn(async () => ({ id: "ext_campaign_1" })),
    createAdSet: vi.fn(async () => ({ id: "ext_adset_1" })),
    createCreative: vi.fn(async () => ({ id: "ext_creative_1" })),
    createAd: vi.fn(async () => ({ id: "ext_ad_1" })),
  },
  getConnectorMock: vi.fn(() => connectorMock),
}));
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: getConnectorMock }));

function single(result: unknown) {
  return vi.fn(async () => result);
}
function maybeSingle(result: unknown) {
  return vi.fn(async () => result);
}

interface Harness {
  regularFrom: ReturnType<typeof vi.fn>;
  adminFrom: ReturnType<typeof vi.fn>;
}

function buildHarness(options: {
  connectedAccount: { data: unknown; error: unknown };
}): Harness {
  const channelCampaignSingle = single({
    data: { id: "cc1", channel: "FACEBOOK", master_campaign_id: "mc1" },
    error: null,
  });
  const masterCampaignSingle = single({
    data: {
      id: "mc1",
      status: "SCHEDULED",
      name: "Promo Akhir Tahun",
      objective: "INCREASE_SALES",
      daily_budget: 50000,
      total_budget: null,
      ai_proposal: { headline: "Diskon Besar", primary_text: "Beli sekarang", cta: "Beli Sekarang" },
    },
    error: null,
  });
  const connectedAccountMaybeSingle = maybeSingle(options.connectedAccount);
  const credentialsMaybeSingle = maybeSingle({ data: { encrypted_access_token: "cipher" }, error: null });

  const regularFrom = vi.fn((table: string) => {
    if (table === "prompter_channel_campaigns") {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ single: channelCampaignSingle }) }) }),
        update: () => ({ eq: vi.fn(async () => ({ error: null })) }),
      };
    }
    if (table === "prompter_master_campaigns") {
      return { select: () => ({ eq: () => ({ eq: () => ({ single: masterCampaignSingle }) }) }) };
    }
    if (table === "prompter_connected_accounts") {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: connectedAccountMaybeSingle }) }) }) };
    }
    if (table === "prompter_audit_logs") {
      return { insert: vi.fn(async () => ({ error: null })) };
    }
    throw new Error(`Unexpected table on regular client: ${table}`);
  });

  const adminFrom = vi.fn((table: string) => {
    if (table === "prompter_oauth_credentials") {
      return { select: () => ({ eq: () => ({ maybeSingle: credentialsMaybeSingle }) }) };
    }
    throw new Error(`Unexpected table on admin client: ${table}`);
  });

  return { regularFrom, adminFrom };
}

let harness: Harness;

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: harness.regularFrom })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ from: harness.adminFrom })) }));

import { launchChannelCampaignAction } from "@/features/campaigns/launch-actions";

describe("launchChannelCampaignAction — Track B pageId threading", () => {
  beforeEach(() => {
    requireSessionContextMock.mockClear();
    connectorMock.createCreative.mockClear();
  });

  it("passes the tenant's selected_page_id into createCreative when one is set", async () => {
    harness = buildHarness({
      connectedAccount: {
        data: { id: "acct1", external_account_id: "act_123", status: "CONNECTED", selected_page_id: "page_42" },
        error: null,
      },
    });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBeNull();
    expect(connectorMock.createCreative).toHaveBeenCalledWith(
      "access-token-abc",
      "act_123",
      expect.objectContaining({ pageId: "page_42" }),
    );
  });

  it("passes pageId: undefined (not null, not a fabricated value) when no Page has been selected yet — backward compatible with pre-Track-B behavior", async () => {
    harness = buildHarness({
      connectedAccount: {
        data: { id: "acct1", external_account_id: "act_123", status: "CONNECTED", selected_page_id: null },
        error: null,
      },
    });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBeNull();
    expect(connectorMock.createCreative).toHaveBeenCalledWith(
      "access-token-abc",
      "act_123",
      expect.objectContaining({ pageId: undefined }),
    );
  });
});

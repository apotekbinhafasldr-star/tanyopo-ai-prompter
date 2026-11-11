import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireSessionContextMock } = vi.hoisted(() => ({
  requireSessionContextMock: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("@/services/session", () => ({ requireSessionContext: requireSessionContextMock }));

vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: vi.fn(() => "access-token-abc") }));

const { connectorMock } = vi.hoisted(() => ({
  connectorMock: {
    isConfigured: vi.fn(() => true),
    getInsights: vi.fn(async () => ({ spend: 12.5, impressions: 1000, reach: 800, clicks: 40, raw: { ok: true } })),
    createCampaign: vi.fn(),
    createAdSet: vi.fn(),
    createCreative: vi.fn(),
    createAd: vi.fn(),
  },
}));
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: vi.fn(() => connectorMock) }));

const { createClientMock, createAdminClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { syncChannelCampaignInsightsAction } from "@/features/campaigns/sync-insights-actions";

interface Harness {
  channelFilters: Array<[string, unknown]>;
  upsert: ReturnType<typeof vi.fn>;
}

function setup(row: { status: string; external_campaign_id: string | null; channel?: string } | null): Harness {
  const channelFilters: Array<[string, unknown]> = [];
  const upsert = vi.fn(async () => ({ error: null }));
  const channelRow = row
    ? { id: "cc1", channel: row.channel ?? "FACEBOOK", master_campaign_id: "mc1", ...row }
    : null;

  const channelChain: Record<string, unknown> = {};
  channelChain.select = vi.fn(() => channelChain);
  channelChain.eq = vi.fn((col: string, val: unknown) => {
    channelFilters.push([col, val]);
    return channelChain;
  });
  channelChain.single = vi.fn(async () => ({ data: channelRow, error: channelRow ? null : { message: "x" } }));

  const accountChain: Record<string, unknown> = {};
  accountChain.select = vi.fn(() => accountChain);
  accountChain.eq = vi.fn(() => accountChain);
  accountChain.maybeSingle = vi.fn(async () => ({
    data: { id: "acct1", external_account_id: "act_123", status: "CONNECTED" },
    error: null,
  }));

  createClientMock.mockResolvedValue({
    from: vi.fn((table: string) => {
      if (table === "prompter_channel_campaigns") return channelChain;
      if (table === "prompter_connected_accounts") return accountChain;
      if (table === "prompter_marketing_metrics") return { upsert };
      if (table === "prompter_audit_logs") return { insert: vi.fn(async () => ({ error: null })) };
      throw new Error(`unexpected table ${table}`);
    }),
  });

  const credChain: Record<string, unknown> = {};
  credChain.select = vi.fn(() => credChain);
  credChain.eq = vi.fn(() => credChain);
  credChain.maybeSingle = vi.fn(async () => ({ data: { encrypted_access_token: "enc" }, error: null }));
  createAdminClientMock.mockReturnValue({ from: vi.fn(() => credChain) });

  return { channelFilters, upsert };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionContextMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "owner" });
  connectorMock.isConfigured.mockReturnValue(true);
});

describe("syncChannelCampaignInsightsAction — status gate", () => {
  it("syncs an ACTIVE channel campaign that has an external id", async () => {
    const h = setup({ status: "ACTIVE", external_campaign_id: "ext_1" });
    const result = await syncChannelCampaignInsightsAction("cc1");
    expect(result).toEqual({ error: null });
    expect(connectorMock.getInsights).toHaveBeenCalledWith("access-token-abc", "act_123", "ext_1");
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it("syncs a PAUSED channel campaign (Meta launches are recorded PAUSED)", async () => {
    const h = setup({ status: "PAUSED", external_campaign_id: "ext_1" });
    const result = await syncChannelCampaignInsightsAction("cc1");
    expect(result).toEqual({ error: null });
    expect(connectorMock.getInsights).toHaveBeenCalledTimes(1);
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it("rejects a channel campaign without an external campaign id", async () => {
    const h = setup({ status: "PAUSED", external_campaign_id: null });
    const result = await syncChannelCampaignInsightsAction("cc1");
    expect(result.error).toBeTruthy();
    expect(connectorMock.getInsights).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it.each(["DRAFT", "AWAITING_APPROVAL", "SCHEDULED", "COMPLETED", "FAILED"])(
    "rejects status %s even when an external id is present",
    async (status) => {
      const h = setup({ status, external_campaign_id: "ext_1" });
      const result = await syncChannelCampaignInsightsAction("cc1");
      expect(result.error).toBeTruthy();
      expect(connectorMock.getInsights).not.toHaveBeenCalled();
      expect(h.upsert).not.toHaveBeenCalled();
    },
  );

  it("is read-only toward the platform: no create method is ever called", async () => {
    setup({ status: "PAUSED", external_campaign_id: "ext_1" });
    await syncChannelCampaignInsightsAction("cc1");
    expect(connectorMock.createCampaign).not.toHaveBeenCalled();
    expect(connectorMock.createAdSet).not.toHaveBeenCalled();
    expect(connectorMock.createCreative).not.toHaveBeenCalled();
    expect(connectorMock.createAd).not.toHaveBeenCalled();
  });
});

describe("syncChannelCampaignInsightsAction — session and tenant isolation (unchanged)", () => {
  it("scopes the channel lookup to the session tenant", async () => {
    const h = setup({ status: "PAUSED", external_campaign_id: "ext_1" });
    await syncChannelCampaignInsightsAction("cc1");
    expect(h.channelFilters).toContainEqual(["tenant_id", "t1"]);
    expect(h.channelFilters).toContainEqual(["id", "cc1"]);
  });

  it("returns not-found (no sync) when the row is not visible to the tenant", async () => {
    const h = setup(null);
    const result = await syncChannelCampaignInsightsAction("other-tenant-cc");
    expect(result.error).toBe("Channel campaign tidak ditemukan.");
    expect(connectorMock.getInsights).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("still requires owner/marketing role", async () => {
    requireSessionContextMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "viewer" });
    const h = setup({ status: "ACTIVE", external_campaign_id: "ext_1" });
    const result = await syncChannelCampaignInsightsAction("cc1");
    expect(result.error).toBeTruthy();
    expect(connectorMock.getInsights).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("source still uses requireSessionContext and a tenant_id filter", () => {
    const src = readFileSync("features/campaigns/sync-insights-actions.ts", "utf8");
    expect(src).toContain("requireSessionContext()");
    expect(src).toContain('.eq("tenant_id", session.tenantId)');
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ConnectorApiError } from "@/lib/connectors/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// The S1 gate is default-deny in production. These tests exercise the claim
// and partial-failure logic PAST the gate, so they simulate an open gate by
// mocking only its verdict. The real default-deny gate is covered in
// launch-claim-s1-gate.test.ts with no gate mock.
vi.mock("@/lib/campaigns/external-budget-guard", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/campaigns/external-budget-guard")>();
  return {
    ...real,
    isBudgetWritePlatformEnabled: () => true,
    evaluateExternalBudgetWrite: () => ({ allowed: true as const }),
  };
});
vi.mock("@/services/automation-settings", () => ({ readEmergencyStopStrict: vi.fn(async () => false) }));

const { sessionRef } = vi.hoisted(() => ({
  sessionRef: { current: { tenantId: "t1", userId: "u1", role: "owner" } },
}));
vi.mock("@/services/session", () => ({ requireSessionContext: vi.fn(async () => sessionRef.current) }));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: vi.fn(() => "access-token-abc") }));

const { connectorMock } = vi.hoisted(() => ({
  connectorMock: {
    createCampaign: vi.fn(),
    createAdSet: vi.fn(),
    createCreative: vi.fn(),
    createAd: vi.fn(),
  },
}));
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: vi.fn(() => connectorMock) }));

interface Row {
  id: string;
  tenant_id: string;
  status: string;
  error: string | null;
  external_campaign_id: string | null;
}

interface Db {
  row: Row;
  updates: { patch: Record<string, unknown>; applied: boolean }[];
  audits: Record<string, unknown>[];
  /** Return true to make the nth progress/final update (after the claim) fail with a DB error. */
  failUpdate: (patch: Record<string, unknown>, index: number) => boolean;
}

let db: Db;

function freshDb(overrides: Partial<Row> = {}): Db {
  return {
    row: { id: "cc1", tenant_id: "t1", status: "SCHEDULED", error: null, external_campaign_id: null, ...overrides },
    updates: [],
    audits: [],
    failUpdate: () => false,
  };
}

/** Stateful fake: an UPDATE ... WHERE is applied atomically at execution time. */
function updateBuilder(patch: Record<string, unknown>) {
  const filters: Record<string, unknown> = {};
  const builder = {
    eq(column: string, value: unknown) {
      filters[column] = value;
      return builder;
    },
    async select() {
      await Promise.resolve(); // yield, so concurrent callers interleave
      const index = db.updates.length;
      if (db.failUpdate(patch, index)) {
        db.updates.push({ patch, applied: false });
        return { data: null, error: { code: "XX000" } };
      }
      const matches = Object.entries(filters).every(([column, value]) => (db.row as unknown as Record<string, unknown>)[column] === value);
      if (matches) Object.assign(db.row, patch);
      db.updates.push({ patch, applied: matches });
      return { data: matches ? [{ id: db.row.id }] : [], error: null };
    },
  };
  return builder;
}

const CHANNEL_ROWS = [
  { id: "cc1", channel: "FACEBOOK", budget_percentage: 50 },
  { id: "cc2", channel: "INSTAGRAM", budget_percentage: 50 },
];

const from = vi.fn((table: string) => {
  switch (table) {
    case "prompter_channel_campaigns":
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: "cc1", channel: "FACEBOOK", master_campaign_id: "mc1" },
                error: null,
              }),
              then: (resolve: (v: unknown) => unknown) => resolve({ data: CHANNEL_ROWS, error: null }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => updateBuilder(patch),
      };
    case "prompter_master_campaigns":
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: "mc1",
                  status: "SCHEDULED",
                  name: "Promo",
                  objective: "INCREASE_SALES",
                  currency: "IDR",
                  daily_budget: 100000,
                  total_budget: null,
                  ai_proposal: { headline: "H", primary_text: "P", cta: "C" },
                },
                error: null,
              }),
            }),
          }),
        }),
      };
    case "prompter_budget_policies":
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    case "prompter_connected_accounts":
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "acct1", external_account_id: "act_1", status: "CONNECTED", selected_page_id: "page_1" },
                error: null,
              }),
            }),
          }),
        }),
      };
    case "prompter_audit_logs":
      return {
        insert: async (row: Record<string, unknown>) => {
          db.audits.push(row);
          return { error: null };
        },
      };
    default:
      throw new Error(`Unexpected table: ${table}`);
  }
});

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from })) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { encrypted_access_token: "cipher" }, error: null }) }),
      }),
    }),
  })),
}));

import { launchChannelCampaignAction } from "@/features/campaigns/launch-actions";

const ALREADY = "Campaign ini sudah diluncurkan atau sedang diproses oleh permintaan lain.";

function metaCalls() {
  return (
    connectorMock.createCampaign.mock.calls.length +
    connectorMock.createAdSet.mock.calls.length +
    connectorMock.createCreative.mock.calls.length +
    connectorMock.createAd.mock.calls.length
  );
}

beforeEach(() => {
  db = freshDb();
  sessionRef.current = { tenantId: "t1", userId: "u1", role: "owner" };
  connectorMock.createCampaign.mockReset().mockResolvedValue({ id: "ext_campaign_1" });
  connectorMock.createAdSet.mockReset().mockResolvedValue({ id: "ext_adset_1" });
  connectorMock.createCreative.mockReset().mockResolvedValue({ id: "ext_creative_1" });
  connectorMock.createAd.mockReset().mockResolvedValue({ id: "ext_ad_1" });
});

describe("exclusive launch claim", () => {
  it("1. two concurrent launches: exactly one claims and launches", async () => {
    const [a, b] = await Promise.all([launchChannelCampaignAction("cc1"), launchChannelCampaignAction("cc1")]);

    const results = [a.error, b.error];
    expect(results.filter((e) => e === null)).toHaveLength(1);
    expect(results.filter((e) => e === ALREADY)).toHaveLength(1);
    expect(connectorMock.createCampaign).toHaveBeenCalledTimes(1);
    expect(connectorMock.createAdSet).toHaveBeenCalledTimes(1);
    expect(connectorMock.createCreative).toHaveBeenCalledTimes(1);
    expect(connectorMock.createAd).toHaveBeenCalledTimes(1);
    expect(db.row.status).toBe("ACTIVE");
    // exactly one claim applied
    const claims = db.updates.filter((u) => u.patch.status === "FAILED" && u.applied);
    expect(claims).toHaveLength(1);
  });

  it("2. the second request never calls Meta", async () => {
    await launchChannelCampaignAction("cc1");
    const callsAfterFirst = metaCalls();
    const second = await launchChannelCampaignAction("cc1");

    expect(second.error).toBe(ALREADY);
    expect(metaCalls()).toBe(callsAfterFirst);
  });

  it("3. a row that is not SCHEDULED cannot be claimed", async () => {
    for (const status of ["DRAFT", "ACTIVE", "FAILED", "PAUSED"]) {
      db = freshDb({ status });
      const result = await launchChannelCampaignAction("cc1");
      expect(result.error, status).toBe(ALREADY);
      expect(db.row.status, status).toBe(status);
    }
    expect(metaCalls()).toBe(0);
  });

  it("4. a claim from another tenant matches nothing and calls no platform API", async () => {
    sessionRef.current = { tenantId: "t2", userId: "u9", role: "owner" };
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBe(ALREADY);
    expect(db.row.status).toBe("SCHEDULED");
    expect(db.row.tenant_id).toBe("t1");
    expect(metaCalls()).toBe(0);
  });

  it("claims by changing the status in the same statement (not merely rewriting error)", async () => {
    let seenDuringCreate: string | null = null;
    connectorMock.createCampaign.mockImplementation(async () => {
      seenDuringCreate = db.row.status;
      return { id: "ext_campaign_1" };
    });
    await launchChannelCampaignAction("cc1");
    expect(seenDuringCreate).toBe("FAILED");
  });
});

describe("database failures stop the launch", () => {
  it("5. a failed claim write stops before Meta", async () => {
    db.failUpdate = (patch) => patch.status === "FAILED";
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toBe(ALREADY);
    expect(metaCalls()).toBe(0);
  });

  it("5b. a failed save of the campaign id stops before the ad set and reports the id", async () => {
    db.failUpdate = (patch) => "external_campaign_id" in patch && patch.status === undefined;
    const result = await launchChannelCampaignAction("cc1");

    expect(connectorMock.createCampaign).toHaveBeenCalledTimes(1);
    expect(connectorMock.createAdSet).not.toHaveBeenCalled();
    expect(result.error).not.toBeNull();
    expect(result.error).toContain("campaign=ext_campaign_1");
    expect(result.error).toContain("diblokir");
    expect(db.row.status).toBe("FAILED");
    expect(db.row.status).not.toBe("ACTIVE");
  });

  it("5c. a failed final ACTIVE write is never reported as success", async () => {
    db.failUpdate = (patch) => patch.status === "ACTIVE";
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).not.toBeNull();
    expect(db.row.status).toBe("FAILED");
    expect(db.audits.some((a) => a.action === "campaign.launched")).toBe(false);
    expect(db.audits.some((a) => a.action === "campaign.launch_failed")).toBe(true);
  });
});

describe("partial failures keep a trace and block relaunch", () => {
  it("6. failure after createCampaign keeps the campaign id", async () => {
    connectorMock.createAdSet.mockRejectedValue(new ConnectorApiError("META", "provider text", { status: 400, code: 100 }));
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toContain("campaign=ext_campaign_1");
    expect(db.row.status).toBe("FAILED");
    expect(db.row.external_campaign_id).toBe("ext_campaign_1");
    expect(connectorMock.createCreative).not.toHaveBeenCalled();
    expect(await launchChannelCampaignAction("cc1")).toEqual({ error: ALREADY });
    expect(connectorMock.createCampaign).toHaveBeenCalledTimes(1);
  });

  it("7. failure after createAdSet keeps campaign and ad set ids", async () => {
    connectorMock.createCreative.mockRejectedValue(new ConnectorApiError("META", "x", { status: 400 }));
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toContain("campaign=ext_campaign_1, adset=ext_adset_1");
    expect(db.row.error).toContain("adset=ext_adset_1");
    expect(connectorMock.createAd).not.toHaveBeenCalled();
    expect(db.row.status).toBe("FAILED");
  });

  it("8. failure after createCreative keeps the creative id", async () => {
    connectorMock.createAd.mockRejectedValue(new ConnectorApiError("META", "x", { status: 400 }));
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toContain("creative=ext_creative_1");
    expect(db.row.status).toBe("FAILED");
  });

  it("9. failure of createAd with no id is uncertain and keeps every earlier id", async () => {
    connectorMock.createAd.mockResolvedValue({});
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toContain("TIDAK PASTI");
    expect(result.error).toContain("creative=ext_creative_1");
    expect(db.row.status).toBe("FAILED");
    expect(db.audits.find((a) => a.action === "campaign.launch_failed")?.context).toMatchObject({
      certainty: "UNCERTAIN",
      failed_step: "createAd",
    });
  });

  it("10. an uncertain Meta response is never retried automatically", async () => {
    connectorMock.createCampaign.mockRejectedValue(new Error("socket hang up"));
    const result = await launchChannelCampaignAction("cc1");

    expect(connectorMock.createCampaign).toHaveBeenCalledTimes(1);
    expect(result.error).toContain("TIDAK PASTI");
    expect(db.row.status).toBe("FAILED");
    expect(db.row.status).not.toBe("SCHEDULED");
    expect(connectorMock.createAdSet).not.toHaveBeenCalled();
    expect(await launchChannelCampaignAction("cc1")).toEqual({ error: ALREADY });
    expect(connectorMock.createCampaign).toHaveBeenCalledTimes(1);
  });

  it("a definitive rejection of the very first call returns the row to SCHEDULED", async () => {
    connectorMock.createCampaign.mockRejectedValue(new ConnectorApiError("META", "x", { status: 400, code: 100 }));
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).not.toContain("diblokir");
    expect(db.row.status).toBe("SCHEDULED");
    expect(db.row.external_campaign_id).toBeNull();
  });

  it("never stores the provider message, token or raw response", async () => {
    connectorMock.createAdSet.mockRejectedValue(
      new ConnectorApiError("META", "EAAB-secret-token in provider message", { status: 400, code: 100 }),
    );
    const result = await launchChannelCampaignAction("cc1");

    const stored = JSON.stringify([db.row, db.audits, result]);
    expect(stored).not.toContain("EAAB");
    expect(stored).not.toContain("access-token-abc");
    expect(stored).not.toContain("provider message");
  });

  it("a successful launch ends ACTIVE with no error and one launched audit", async () => {
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBeNull();
    expect(db.row).toMatchObject({ status: "ACTIVE", error: null, external_campaign_id: "ext_campaign_1" });
    expect(db.audits.filter((a) => a.action === "campaign.launched")).toHaveLength(1);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ConnectorApiError } from "@/lib/connectors/types";
import {
  makeAdminStorage,
  makePreflightFixtures,
  preflightTable,
  type PreflightFixtures,
} from "../helpers/meta-preflight-fixtures";

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
vi.mock("@/lib/campaigns/meta-objective-contracts", async (importOriginal) => {
  const helpers = await import("../helpers/meta-preflight-fixtures");
  return helpers.verifiedContracts(importOriginal as () => Promise<typeof import("@/lib/campaigns/meta-objective-contracts")>);
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
let fx: PreflightFixtures;
let masterOverrides: Record<string, unknown> = {};
let accountOverrides: Record<string, unknown> = {};

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
                  objective: "BRAND_AWARENESS",
                  product_id: "p1",
                  target_country: "Indonesia",
                  selected_media_id: null,
                  ...masterOverrides,
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
                data: {
                  id: "acct1",
                  external_account_id: "act_1",
                  status: "CONNECTED",
                  selected_page_id: "page_1",
                  ...accountOverrides,
                },
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
    default: {
      const preflight = preflightTable(table, fx);
      if (preflight) return preflight;
      throw new Error(`Unexpected table: ${table}`);
    }
  }
});

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from })) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    storage: makeAdminStorage(fx),
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
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.tanyopo.ai");
  fx = makePreflightFixtures();
  masterOverrides = {};
  accountOverrides = {};
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

// ---------------------------------------------------------------------------
// PR #36 — Meta preflight. Every rejection must happen BEFORE the exclusive
// claim: no claim, no status change, no audit row, no Meta call.
// ---------------------------------------------------------------------------

async function expectRejectedBeforeClaim(contains: string) {
  const result = await launchChannelCampaignAction("cc1");
  expect(result.error).toContain(contains);
  expect(metaCalls()).toBe(0);
  expect(db.updates).toHaveLength(0); // no claim, no progress, no release
  expect(db.row).toMatchObject({ status: "SCHEDULED", error: null, external_campaign_id: null });
  expect(db.audits).toHaveLength(0);
  return result;
}

describe("Meta preflight (PR #36)", () => {
  it("passes a fully prepared launch and sends only preflight-approved values to Meta", async () => {
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBeNull();
    expect(connectorMock.createCampaign).toHaveBeenCalledWith(
      "access-token-abc",
      "act_1",
      expect.objectContaining({ objective: "OUTCOME_AWARENESS" }),
    );
    expect(connectorMock.createAdSet).toHaveBeenCalledWith(
      "access-token-abc",
      "act_1",
      expect.objectContaining({ targetingCountries: ["ID"], optimizationGoal: "REACH" }),
    );
    const creative = connectorMock.createCreative.mock.calls[0][2];
    expect(creative).toMatchObject({
      pageId: "page_1",
      linkUrl: "https://toko-saya.co.id/produk",
      imageUrl: "https://proj.supabase.co/storage/v1/object/public/product-media/t1/p1/1700-foto.jpg",
    });
    expect(JSON.stringify(connectorMock.createCreative.mock.calls)).not.toContain("tanyopo.ai");
  });

  describe("approval", () => {
    it.each([
      ["no approval row", []],
      ["PENDING", [{ status: "PENDING", created_at: "2026-10-01T00:00:00Z" }]],
      ["REJECTED", [{ status: "REJECTED", created_at: "2026-10-01T00:00:00Z" }]],
      ["EXPIRED", [{ status: "EXPIRED", created_at: "2026-10-01T00:00:00Z" }]],
      [
        "a newer REJECTED after an older APPROVED",
        [
          { status: "APPROVED", created_at: "2026-09-01T00:00:00Z" },
          { status: "REJECTED", created_at: "2026-10-01T00:00:00Z" },
        ],
      ],
    ])("1. rejects %s", async (_name, approvals) => {
      fx.approvals = approvals;
      await expectRejectedBeforeClaim("persetujuan");
    });

    it("1b. a failed approval read fails closed", async () => {
      fx.approvalError = true;
      await expectRejectedBeforeClaim("persetujuan");
    });
  });

  describe("tenant isolation", () => {
    it("2. another tenant's image is rejected, never sent", async () => {
      fx.media = [
        { id: "m9", tenant_id: "t2", product_id: "p1", storage_path: "t2/p1/1700-foto.jpg", media_type: "IMAGE", position: 0 },
      ];
      masterOverrides = { selected_media_id: "m9" };
      await expectRejectedBeforeClaim("Gambar iklan");
    });

    it("8. a stored path pointing into another tenant's folder is rejected", async () => {
      fx.media = [
        { id: "m9", tenant_id: "t1", product_id: "p1", storage_path: "t2/p1/1700-foto.jpg", media_type: "IMAGE", position: 0 },
      ];
      await expectRejectedBeforeClaim("lokasi file tidak valid");
      expect(fx.storageListCalls).toHaveLength(0); // Storage is not even asked about a foreign folder
    });

    it("another product's image is rejected", async () => {
      fx.media = [
        { id: "m9", tenant_id: "t1", product_id: "p2", storage_path: "t1/p2/1700-foto.jpg", media_type: "IMAGE", position: 0 },
      ];
      masterOverrides = { selected_media_id: "m9" };
      await expectRejectedBeforeClaim("bukan milik produk ini");
    });
  });

  describe("Page and ad account", () => {
    it("3. no Page selected: rejected, no other Page is picked", async () => {
      accountOverrides = { selected_page_id: null };
      await expectRejectedBeforeClaim("Facebook Page");
    });

    it.each(["1234567", "act_", "act_12ab", "ACT_1", "act_1 2", "https://evil.example.com"])(
      "4. invalid ad account id %j is rejected",
      async (id) => {
        accountOverrides = { external_account_id: id };
        await expectRejectedBeforeClaim("ad account");
      },
    );
  });

  describe("landing URL", () => {
    it("5. no product URL and no brand URL: rejected with a clear reason", async () => {
      fx.product = { id: "p1", website_url: null };
      fx.brand = { website_url: null };
      await expectRejectedBeforeClaim("URL landing belum tersedia");
    });

    it("uses the brand URL only when the product has none", async () => {
      fx.product = { id: "p1", website_url: null };
      fx.brand = { website_url: "https://brand-saya.id/" };
      expect((await launchChannelCampaignAction("cc1")).error).toBeNull();
      expect(connectorMock.createCreative.mock.calls[0][2].linkUrl).toBe("https://brand-saya.id/");
    });

    it.each([
      "http://toko-saya.co.id",
      "ftp://toko-saya.co.id/x",
      "javascript:alert(1)",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://10.0.0.5/x",
      "https://[::1]/x",
      "https://user:pass@toko-saya.co.id/",
      "https://intranet/x",
      "https://shop.internal/x",
      "https://app.tanyopo.ai/x",
      "https://tanyopo.ai",
      "https://proj.supabase.co/x",
      "https://toko-saya.co.id:8443/x",
      `https://toko-saya.co.id/${"a".repeat(2100)}`,
    ])("6. unsafe URL %#: rejected", async (url) => {
      fx.product = { id: "p1", website_url: url };
      await expectRejectedBeforeClaim("URL landing");
    });

    it("an unsafe product URL is never silently replaced by the brand URL", async () => {
      fx.product = { id: "p1", website_url: "http://toko-saya.co.id" };
      fx.brand = { website_url: "https://brand-saya.id/" };
      await expectRejectedBeforeClaim("HTTPS");
    });
  });

  describe("creative image", () => {
    it("7. no image at all: rejected", async () => {
      fx.media = [];
      await expectRejectedBeforeClaim("belum memiliki gambar");
    });

    it("a video is not an image", async () => {
      fx.media = [
        { id: "m2", tenant_id: "t1", product_id: "p1", storage_path: "t1/p1/1700-clip.mp4", media_type: "VIDEO", position: 0 },
      ];
      await expectRejectedBeforeClaim("belum memiliki gambar");
    });

    it("a selected media that is not a product image is rejected, not swapped", async () => {
      masterOverrides = { selected_media_id: "does-not-exist" };
      await expectRejectedBeforeClaim("gambar yang dipilih tidak ditemukan");
    });

    it.each([
      ["wrong mime type", { mimetype: "image/webp", size: 1000 }],
      ["zero size", { mimetype: "image/jpeg", size: 0 }],
      ["too large", { mimetype: "image/jpeg", size: 9 * 1024 * 1024 }],
      ["missing metadata", null],
    ])("Storage metadata check: %s", async (_name, metadata) => {
      fx.storageObjects = [{ name: "1700-foto.jpg", metadata }];
      await expectRejectedBeforeClaim("Gambar iklan");
    });

    it("an object missing from Storage is rejected", async () => {
      fx.storageObjects = [];
      await expectRejectedBeforeClaim("file tidak ditemukan");
    });

    it.each(["t1/p1/../p2/x.jpg", "t1/p1/x.jpg?x=1", "t1/p1/x%2e%2e.jpg", "t1/p1/x.gif", "t1/p1/x.svg"])(
      "path %j is rejected",
      async (storage_path) => {
        fx.media = [{ id: "m1", tenant_id: "t1", product_id: "p1", storage_path, media_type: "IMAGE", position: 0 }];
        await expectRejectedBeforeClaim("Gambar iklan");
      },
    );

    it("only the Storage list API is used: no HTTP request is made to any URL", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await launchChannelCampaignAction("cc1");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(fx.storageListCalls).toEqual([{ directory: "t1/p1", search: "1700-foto.jpg" }]);
      fetchSpy.mockRestore();
    });
  });

  describe("objective", () => {
    it("9. INCREASE_SALES is rejected with a clear reason (never turned into TRAFFIC)", async () => {
      masterOverrides = { objective: "INCREASE_SALES" };
      await expectRejectedBeforeClaim("Pixel");
    });

    it.each(["GET_LEADS", "INCREASE_FOLLOWERS", "WEBSITE_TRAFFIC", "PROMOTE_APP"])(
      "%s has no verified contract and is rejected",
      async (objective) => {
        masterOverrides = { objective };
        await expectRejectedBeforeClaim("");
      },
    );

    it.each(["", "SOMETHING_NEW", "constructor", "__proto__", "toString"])(
      "10. unknown objective %j is rejected (no silent AWARENESS fallback)",
      async (objective) => {
        masterOverrides = { objective };
        await expectRejectedBeforeClaim("Objective");
      },
    );
  });

  describe("target country", () => {
    it.each([null, "", "  ", "Atlantis", "ZZ", "XX", "123", "I"])("11. invalid target country %j is rejected", async (country) => {
      masterOverrides = { target_country: country };
      await expectRejectedBeforeClaim("Negara target");
    });

    it.each([
      ["Indonesia", "ID"],
      ["id", "ID"],
      ["Malaysia", "MY"],
      ["sg", "SG"],
    ])("target country %j is sent as %s (no hard-coded Indonesia)", async (country, code) => {
      masterOverrides = { target_country: country };
      expect((await launchChannelCampaignAction("cc1")).error).toBeNull();
      expect(connectorMock.createAdSet.mock.calls[0][2].targetingCountries).toEqual([code]);
    });
  });

  describe("claim and concurrency", () => {
    it("12/13. a preflight failure leaves no claim and no Meta call (row untouched)", async () => {
      fx.product = { id: "p1", website_url: null };
      await expectRejectedBeforeClaim("URL landing");
      // a later, corrected launch still works: nothing was burned
      fx.product = { id: "p1", website_url: "https://toko-saya.co.id/produk" };
      expect((await launchChannelCampaignAction("cc1")).error).toBeNull();
    });

    it("preflight reads happen before the claim", async () => {
      let readsBeforeClaim: string[] = [];
      connectorMock.createCampaign.mockImplementation(async () => {
        readsBeforeClaim = [...fx.reads];
        return { id: "ext_campaign_1" };
      });
      await launchChannelCampaignAction("cc1");
      expect(readsBeforeClaim).toEqual(
        expect.arrayContaining(["prompter_approvals", "prompter_products", "prompter_product_media"]),
      );
    });

    it("14. two parallel requests that fail preflight both stop, neither claims", async () => {
      fx.product = { id: "p1", website_url: null };
      const [a, b] = await Promise.all([launchChannelCampaignAction("cc1"), launchChannelCampaignAction("cc1")]);
      expect(a.error).toContain("URL landing");
      expect(b.error).toContain("URL landing");
      expect(db.updates).toHaveLength(0);
      expect(metaCalls()).toBe(0);
    });

    it("14b. two parallel requests that pass preflight still produce exactly one launch", async () => {
      const [a, b] = await Promise.all([launchChannelCampaignAction("cc1"), launchChannelCampaignAction("cc1")]);
      expect([a.error, b.error].filter((e) => e === null)).toHaveLength(1);
      expect([a.error, b.error].filter((e) => e === ALREADY)).toHaveLength(1);
      expect(connectorMock.createCampaign).toHaveBeenCalledTimes(1);
      expect(db.updates.filter((u) => u.patch.status === "FAILED" && u.applied)).toHaveLength(1);
    });
  });
});

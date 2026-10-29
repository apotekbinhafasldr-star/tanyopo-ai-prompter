import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  makeAdminStorage,
  makePreflightFixtures,
  preflightTable,
  type PreflightFixtures,
} from "../helpers/meta-preflight-fixtures";

/**
 * Phase 1C-B — the REAL launch flow for Meta with the REAL Budget Gate logic
 * (only the platform allowlist is injected, META on, for this file) and the
 * REAL budget validator. Only the outside world is faked: Supabase, the Meta
 * connector (no network), the token cipher, the Owner-confirmation marker and
 * Emergency Stop. Every refusal must happen before the claim and before any
 * write on Meta.
 */

const hoisted = vi.hoisted(() => ({
  gateRequests: [] as Record<string, unknown>[],
  validatorInputs: [] as Record<string, unknown>[],
  unitTable: { current: undefined as undefined | Record<string, { minorUnitsPerUnit: number | null; verified: boolean }> },
  adminReads: [] as { table: string; filters: [string, unknown][] }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// REAL gate logic with META on (test-only allowlist); every request is recorded.
vi.mock("@/lib/campaigns/external-budget-guard", async () => {
  const core = await import("@/lib/campaigns/external-budget-guard-core");
  const enabled: readonly import("@/types/database").ConnectorPlatform[] = ["META"];
  return {
    BUDGET_WRITE_DISABLED_MESSAGE: core.BUDGET_WRITE_DISABLED_MESSAGE,
    isBudgetWritePlatformEnabled: (platform: import("@/types/database").ConnectorPlatform) => enabled.includes(platform),
    evaluateExternalBudgetWrite: (request: import("@/lib/campaigns/external-budget-guard-core").ExternalBudgetWriteRequest) => {
      hoisted.gateRequests.push({ ...request });
      return core.evaluateWithPlatforms(request, enabled);
    },
  };
});

// REAL validator; only records its input and lets a test inject a unit table (none = the shipped, unverified one).
vi.mock("@/lib/campaigns/meta-launch-budget", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/campaigns/meta-launch-budget")>();
  return {
    ...real,
    resolveMetaLaunchBudget: (input: Parameters<typeof real.resolveMetaLaunchBudget>[0]) => {
      hoisted.validatorInputs.push({ ...input });
      return real.resolveMetaLaunchBudget(input, hoisted.unitTable.current);
    },
  };
});

vi.mock("@/lib/campaigns/meta-objective-contracts", async (importOriginal) => {
  const helpers = await import("../helpers/meta-preflight-fixtures");
  return helpers.verifiedContracts(importOriginal as () => Promise<typeof import("@/lib/campaigns/meta-objective-contracts")>);
});

const { emergencyMock, confirmationMock, evidenceMock, decryptMock, connectorMock } = vi.hoisted(() => ({
  emergencyMock: vi.fn(async (): Promise<boolean | null> => false),
  confirmationMock: vi.fn(async (..._args: unknown[]): Promise<{ ok: true; confirmed: boolean } | { ok: false }> => ({ ok: true, confirmed: true })),
  evidenceMock: vi.fn(async (..._args: string[]): Promise<unknown> => ({ kind: "VERIFIED", accountId: "act_1", currency: "IDR" })),
  decryptMock: vi.fn((..._args: unknown[]) => "access-token-abc"),
  connectorMock: {
    createCampaign: vi.fn(),
    createAdSet: vi.fn(),
    createCreative: vi.fn(),
    createAd: vi.fn(),
  },
}));
vi.mock("@/services/automation-settings", () => ({ readEmergencyStopStrict: emergencyMock }));
vi.mock("@/features/connections/meta-selection-confirmation", () => ({
  AD_ACCOUNT_SELECTED_ACTION: "connection.meta_ad_account_selected",
  readSelectionConfirmed: confirmationMock,
}));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: decryptMock }));
vi.mock("@/lib/connectors/get-connector", () => ({
  getConnector: vi.fn(() => ({ ...connectorMock, getAdAccountCurrencyEvidence: evidenceMock })),
}));

const { sessionRef } = vi.hoisted(() => ({
  sessionRef: { current: { tenantId: "t1", userId: "u1", role: "owner" } },
}));
vi.mock("@/services/session", () => ({ requireSessionContext: vi.fn(async () => sessionRef.current) }));

interface Row {
  id: string;
  tenant_id: string;
  status: string;
  error: string | null;
  external_campaign_id: string | null;
}
let row: Row;
let updates: Record<string, unknown>[];
let audits: Record<string, unknown>[];
let fx: PreflightFixtures;
let masterOverrides: Record<string, unknown> = {};
let accountOverrides: Record<string, unknown> = {};
let channel = "FACEBOOK";

function updateBuilder(patch: Record<string, unknown>) {
  const filters: Record<string, unknown> = {};
  const builder = {
    eq(column: string, value: unknown) {
      filters[column] = value;
      return builder;
    },
    async select() {
      const matches = Object.entries(filters).every(([c, v]) => (row as unknown as Record<string, unknown>)[c] === v);
      if (matches) Object.assign(row, patch);
      updates.push(patch);
      return { data: matches ? [{ id: row.id }] : [], error: null };
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
              single: async () => ({ data: { id: "cc1", channel, master_campaign_id: "mc1" }, error: null }),
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
                  currency: "IDR",
                  daily_budget: 100000,
                  total_budget: null,
                  ai_proposal: { headline: "H", primary_text: "P", cta: "C" },
                  ...masterOverrides,
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
                  last_refreshed_at: "2026-10-01T00:00:00Z",
                  expires_at: null,
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
        insert: async (r: Record<string, unknown>) => {
          audits.push(r);
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
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      hoisted.adminReads.push({ table, filters });
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        maybeSingle: async () => ({ data: { encrypted_access_token: "cipher" }, error: null }),
      };
      return builder;
    },
  })),
}));

import { launchChannelCampaignAction } from "@/features/campaigns/launch-actions";

function metaWrites() {
  return (
    connectorMock.createCampaign.mock.calls.length +
    connectorMock.createAdSet.mock.calls.length +
    connectorMock.createCreative.mock.calls.length +
    connectorMock.createAd.mock.calls.length
  );
}

/** A refusal writes nothing: no claim, no status change, no audit, no object on Meta. */
function expectRefusedWithoutSideEffects() {
  expect(updates).toEqual([]);
  expect(audits).toEqual([]);
  expect(row.status).toBe("SCHEDULED");
  expect(row.error).toBeNull();
  expect(metaWrites()).toBe(0);
}

const APPROVAL_CONTEXT = {
  daily_budget: 100000,
  total_budget: null,
  destination_snapshot: { version: 1, kind: "legacy_url", link: "https://toko-saya.co.id/produk" },
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.linoe.id");
  vi.stubEnv("META_REDIRECT_URI", "");
  fx = makePreflightFixtures();
  fx.approvals = [{ status: "APPROVED", created_at: "2026-10-01T00:00:00Z", context: APPROVAL_CONTEXT }];
  masterOverrides = {};
  accountOverrides = {};
  channel = "FACEBOOK";
  row = { id: "cc1", tenant_id: "t1", status: "SCHEDULED", error: null, external_campaign_id: null };
  updates = [];
  audits = [];
  hoisted.gateRequests.length = 0;
  hoisted.validatorInputs.length = 0;
  hoisted.adminReads.length = 0;
  hoisted.unitTable.current = undefined;
  sessionRef.current = { tenantId: "t1", userId: "u1", role: "owner" };
  emergencyMock.mockReset().mockResolvedValue(false);
  confirmationMock.mockReset().mockResolvedValue({ ok: true, confirmed: true });
  evidenceMock.mockReset().mockResolvedValue({ kind: "VERIFIED", accountId: "act_1", currency: "IDR" });
  decryptMock.mockReset().mockReturnValue("access-token-abc");
  connectorMock.createCampaign.mockReset().mockResolvedValue({ id: "ext_campaign_1" });
  connectorMock.createAdSet.mockReset().mockResolvedValue({ id: "ext_adset_1" });
  connectorMock.createCreative.mockReset().mockResolvedValue({ id: "ext_creative_1" });
  connectorMock.createAd.mockReset().mockResolvedValue({ id: "ext_ad_1" });
});

describe("Meta launch — verified currency + verified unit (test-only table) launches PAUSED with the validated budget", () => {
  beforeEach(() => {
    hoisted.unitTable.current = { IDR: { minorUnitsPerUnit: 100, verified: true } };
  });

  it("currency match: the converted amount, not the whole-IDR share, is what reaches Meta", async () => {
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBeNull();
    expect(connectorMock.createCampaign.mock.calls[0][2].dailyBudgetMinorUnits).toBe(5_000_000);
    expect(connectorMock.createAdSet.mock.calls[0][2].dailyBudgetMinorUnits).toBe(5_000_000);
    expect(row.status).toBe("PAUSED");
  });

  it("ONE currency read feeds both the Budget Gate and the validator", async () => {
    await launchChannelCampaignAction("cc1");

    expect(evidenceMock).toHaveBeenCalledTimes(1);
    expect(evidenceMock).toHaveBeenCalledWith("access-token-abc", "act_1");
    const evidenceGate = hoisted.gateRequests.filter((r) => r.accountCurrency !== null);
    expect(evidenceGate).toHaveLength(1);
    expect(evidenceGate[0].accountCurrency).toBe("IDR");
    expect(hoisted.validatorInputs).toHaveLength(1);
    expect(hoisted.validatorInputs[0].accountCurrency).toBe("IDR");
  });

  it("the credentials are read for this tenant AND this connection", async () => {
    await launchChannelCampaignAction("cc1");

    const credentialReads = hoisted.adminReads.filter((r) => r.table === "prompter_oauth_credentials");
    expect(credentialReads).toHaveLength(1);
    expect(credentialReads[0].filters).toEqual(
      expect.arrayContaining([
        ["connected_account_id", "acct1"],
        ["tenant_id", "t1"],
      ]),
    );
  });

  it("another tenant's session uses its own tenant everywhere (confirmation, credentials)", async () => {
    sessionRef.current = { tenantId: "t2", userId: "u9", role: "owner" };
    await launchChannelCampaignAction("cc1");

    expect(confirmationMock.mock.calls[0][0]).toBe("t2");
    const credentialReads = hoisted.adminReads.filter((r) => r.table === "prompter_oauth_credentials");
    expect(credentialReads[0].filters).toContainEqual(["tenant_id", "t2"]);
    expect(credentialReads[0].filters).not.toContainEqual(["tenant_id", "t1"]);
  });
});

describe("Meta launch — the real validator refuses what is not proven (every refusal: no claim, no write on Meta)", () => {
  it("the shipped IDR unit is unverified: even a fully verified IDR account is refused", async () => {
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/Satuan budget Meta untuk mata uang ini belum terverifikasi/);
    expect(hoisted.validatorInputs).toHaveLength(1);
    expectRefusedWithoutSideEffects();
  });

  it("currency mismatch: a USD account is refused (the gate wants IDR)", async () => {
    evidenceMock.mockResolvedValue({ kind: "VERIFIED", accountId: "act_1", currency: "USD" });
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/bukan IDR/);
    expectRefusedWithoutSideEffects();
  });

  it("a campaign currency other than IDR is refused before anything is read from Meta", async () => {
    hoisted.unitTable.current = { IDR: { minorUnitsPerUnit: 1, verified: true } };
    masterOverrides = { currency: "USD" };
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).not.toBeNull();
    expectRefusedWithoutSideEffects();
  });

  it.each([
    ["an unverified response", { kind: "UNVERIFIED", reason: "CURRENCY_INVALID" }],
    ["no object", undefined],
    ["an unknown kind", { kind: "WHATEVER" }],
    ["a verified response without a currency", { kind: "VERIFIED", accountId: "act_1" }],
    ["a verified response with a lowercase currency", { kind: "VERIFIED", accountId: "act_1", currency: "idr" }],
  ])("unknown currency: %s is refused", async (_label, evidence) => {
    evidenceMock.mockResolvedValue(evidence);
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/Mata uang akun iklan belum terverifikasi/);
    expectRefusedWithoutSideEffects();
  });

  it("unknown currency: a failed read (thrown error) is refused and its text is never shown", async () => {
    evidenceMock.mockRejectedValue(new Error("Error validating access token: SECRET-PROVIDER-TEXT"));
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/Mata uang akun iklan belum terverifikasi/);
    expect(JSON.stringify(result)).not.toMatch(/SECRET|access-token-abc/);
    expectRefusedWithoutSideEffects();
  });

  it("account id mismatch: evidence about another account is refused", async () => {
    evidenceMock.mockResolvedValue({ kind: "VERIFIED", accountId: "act_999", currency: "IDR" });
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/tidak sama dengan akun tersimpan/);
    expectRefusedWithoutSideEffects();
  });

  it("an account that is not active is refused", async () => {
    evidenceMock.mockResolvedValue({ kind: "UNVERIFIED", reason: "STATUS_NOT_ACTIVE" });
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/belum aktif/);
    expectRefusedWithoutSideEffects();
  });

  it("a budget above what the Owner approved is refused", async () => {
    hoisted.unitTable.current = { IDR: { minorUnitsPerUnit: 1, verified: true } };
    fx.approvals = [{ status: "APPROVED", created_at: "2026-10-01T00:00:00Z", context: { ...APPROVAL_CONTEXT, daily_budget: 90000 } }];
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/melebihi nilai yang disetujui Owner/);
    expectRefusedWithoutSideEffects();
  });
});

describe("Meta launch — Owner confirmation, token and approval come BEFORE the currency read", () => {
  it("an ad account the Owner has not confirmed is refused: no credentials, no token, no currency read", async () => {
    confirmationMock.mockResolvedValue({ ok: true, confirmed: false });
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/belum dikonfirmasi Owner/);
    expect(confirmationMock).toHaveBeenCalledTimes(1);
    expect(hoisted.adminReads).toEqual([]);
    expect(decryptMock).not.toHaveBeenCalled();
    expect(evidenceMock).not.toHaveBeenCalled();
    expectRefusedWithoutSideEffects();
  });

  it("a confirmation that cannot be read is refused the same way", async () => {
    confirmationMock.mockResolvedValue({ ok: false });
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/Konfirmasi akun iklan Meta tidak dapat diperiksa/);
    expect(evidenceMock).not.toHaveBeenCalled();
    expectRefusedWithoutSideEffects();
  });

  it("the confirmation is checked against the stored connection (id, account and connect stamp)", async () => {
    await launchChannelCampaignAction("cc1");

    expect(confirmationMock).toHaveBeenCalledWith("t1", {
      id: "acct1",
      external_account_id: "act_1",
      last_refreshed_at: "2026-10-01T00:00:00Z",
    });
  });

  it.each([
    ["a past expiry", "2020-01-01T00:00:00Z"],
    ["an unreadable expiry", "not-a-date"],
  ])("token expired: %s is refused before the credentials are read", async (_label, expires_at) => {
    accountOverrides = { expires_at };
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/kedaluwarsa/);
    expect(hoisted.adminReads).toEqual([]);
    expect(decryptMock).not.toHaveBeenCalled();
    expect(evidenceMock).not.toHaveBeenCalled();
    expectRefusedWithoutSideEffects();
  });

  it("a token that has not expired (future expiry) is used", async () => {
    hoisted.unitTable.current = { IDR: { minorUnitsPerUnit: 1, verified: true } };
    accountOverrides = { expires_at: "2999-01-01T00:00:00Z" };
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBeNull();
  });

  it("Owner approval is still required: a pending approval stops before the confirmation", async () => {
    fx.approvals = [{ status: "PENDING", created_at: "2026-10-01T00:00:00Z", context: APPROVAL_CONTEXT }];
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).not.toBeNull();
    expect(confirmationMock).not.toHaveBeenCalled();
    expect(evidenceMock).not.toHaveBeenCalled();
    expectRefusedWithoutSideEffects();
  });

  it.each([
    ["active", true, /Emergency Stop aktif/],
    ["unreadable", null, /Emergency Stop tidak dapat diverifikasi/],
  ])("Emergency Stop %s stops before the approval, the confirmation, the credentials and the currency read", async (_label, value, message) => {
    emergencyMock.mockResolvedValue(value);
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(message);
    expect(fx.reads).toEqual([]);
    expect(confirmationMock).not.toHaveBeenCalled();
    expect(hoisted.adminReads).toEqual([]);
    expect(evidenceMock).not.toHaveBeenCalled();
    expectRefusedWithoutSideEffects();
  });
});

describe("no regression for other objectives and platforms", () => {
  it("an objective that has no Meta contract is still refused by the preflight, before the claim", async () => {
    hoisted.unitTable.current = { IDR: { minorUnitsPerUnit: 1, verified: true } };
    masterOverrides = { objective: "INCREASE_SALES" };
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).not.toBeNull();
    expectRefusedWithoutSideEffects();
  });

  it("the currency read is Meta-only: a TikTok launch is still stopped by the platform lock and reads nothing", async () => {
    channel = "TIKTOK";
    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/dinonaktifkan sementara/);
    expect(evidenceMock).not.toHaveBeenCalled();
    expect(confirmationMock).not.toHaveBeenCalled();
    expectRefusedWithoutSideEffects();
  });
});

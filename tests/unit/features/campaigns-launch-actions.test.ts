import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildPurchaseDestination } from "@/lib/campaigns/purchase-destination";
import { buildCopySnapshot, evaluateCopyGuard } from "@/lib/campaigns/copy-guard";
import { LAUNCHABLE_PROPOSAL, LAUNCHABLE_COPY_SNAPSHOT } from "@/tests/unit/helpers/launchable-proposal";
import {
  makeAdminStorage,
  makePreflightFixtures,
  preflightTable,
  type PreflightFixtures,
} from "../helpers/meta-preflight-fixtures";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// LEGACY SIMULATION ONLY (S1 test isolation). These PR #26 budget-allocation
// tests exercise the launch flow *past* the External Budget Safety Gate, which
// is default-deny in production. They simulate an open gate by mocking ONLY
// the gate's verdict and the Emergency Stop read. Their assertions are
// unchanged. The real, default-deny gate is covered with no gate mock in
// launch-budget-gate.test.ts and launch-budget-gate-evidence.test.ts.
vi.mock("@/lib/campaigns/external-budget-guard", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/campaigns/external-budget-guard")>();
  return {
    ...real,
    isBudgetWritePlatformEnabled: () => true,
    evaluateExternalBudgetWrite: () => ({ allowed: true as const }),
  };
});
// Phase 1C-B: the Owner's ad-account confirmation (F-2b marker) and the Meta
// currency read are covered in launch-meta-account-evidence.test.ts. These
// tests exercise the claim / partial-failure logic PAST them, so the
// confirmation says "confirmed" and the connector reports a VERIFIED IDR
// account whose id echoes the one asked about.
vi.mock("@/features/connections/meta-selection-confirmation", () => ({
  AD_ACCOUNT_SELECTED_ACTION: "connection.meta_ad_account_selected",
  readSelectionConfirmed: vi.fn(async () => ({ ok: true as const, confirmed: true })),
}));
// Phase 1C-A: the real Meta launch-budget validator refuses every launch today
// (IDR unit and ad-account currency are unverified). These tests simulate an
// open gate and exercise the claim/partial-failure logic PAST it, so the
// validator's verdict is stubbed to pass the value through unchanged. The real
// validator is covered in meta-launch-budget.test.ts and
// launch-meta-budget-refusal.test.ts.
vi.mock("@/lib/campaigns/meta-launch-budget", () => ({
  resolveMetaLaunchBudget: (input: { allocatedDailyBudget: number }) => ({
    ok: true as const,
    value: { minorUnits: input.allocatedDailyBudget, wholeAmount: input.allocatedDailyBudget },
  }),
}));
// PR #36: the BRAND_AWARENESS contract is flipped to verified here so the
// launch flow can be exercised past the Meta preflight. The shipped contract
// is unverified (fail closed) — see meta-launch-preflight.test.ts.
vi.mock("@/lib/campaigns/meta-objective-contracts", async (importOriginal) => {
  const helpers = await import("../helpers/meta-preflight-fixtures");
  return helpers.verifiedContracts(importOriginal as () => Promise<typeof import("@/lib/campaigns/meta-objective-contracts")>);
});
vi.mock("@/services/automation-settings", () => ({ readEmergencyStopStrict: vi.fn(async () => false) }));

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
  getConnectorMock: vi.fn(() => ({ ...connectorMock, getAdAccountCurrencyEvidence: async (...args: string[]) => ({ kind: "VERIFIED" as const, accountId: args[1], currency: "IDR" }) })),
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
  claimUpdate: ReturnType<typeof vi.fn>;
  auditInsert: ReturnType<typeof vi.fn>;
  /** Every column list passed to select() on prompter_connected_accounts. */
  connectedAccountSelects: string[];
}

type ChannelRow = { id: string; channel: string; budget_percentage: number | null };

const DEFAULT_ROWS: ChannelRow[] = [
  { id: "cc1", channel: "FACEBOOK", budget_percentage: 50 },
  { id: "cc2", channel: "INSTAGRAM", budget_percentage: 30 },
  { id: "cc3", channel: "SEO", budget_percentage: 20 },
];

const CONNECTED = {
  data: { id: "acct1", external_account_id: "act_123", status: "CONNECTED", selected_page_id: "page_42" },
  error: null,
};

function buildHarness(
  options: {
    connectedAccount?: { data: unknown; error: unknown };
    /** Result of the separate `selected_page_id` read; defaults to connectedAccount. */
    pageRead?: { data: unknown; error: unknown };
    channel?: string;
    channelId?: string;
    master?: Record<string, unknown>;
    rows?: ChannelRow[];
    rowsError?: unknown;
    policy?: Record<string, unknown> | null;
    policyError?: unknown;
    monthToDateSpend?: number;
    metricsError?: unknown;
    metricsRows?: unknown[] | null;
    claimRows?: unknown[];
  } = {},
): Harness {
  const channelCampaignSingle = single({
    data: { id: options.channelId ?? "cc1", channel: options.channel ?? "FACEBOOK", master_campaign_id: "mc1" },
    error: null,
  });
  const masterCampaignSingle = single({
    data: {
      id: "mc1",
      status: "SCHEDULED",
      name: "Promo Akhir Tahun",
      objective: "BRAND_AWARENESS",
      product_id: "p1",
      target_country: "Indonesia",
      selected_media_id: null,
      currency: "IDR",
      daily_budget: 100000,
      total_budget: null,
      ai_proposal: LAUNCHABLE_PROPOSAL,
      ...options.master,
    },
    error: null,
  });
  const connectedAccountMaybeSingle = maybeSingle(options.connectedAccount ?? CONNECTED);
  const pageReadMaybeSingle = options.pageRead ? maybeSingle(options.pageRead) : connectedAccountMaybeSingle;
  const connectedAccountSelects: string[] = [];
  const credentialsMaybeSingle = maybeSingle({ data: { encrypted_access_token: "cipher" }, error: null });
  const rowsResult = { data: options.rowsError ? null : (options.rows ?? DEFAULT_ROWS), error: options.rowsError ?? null };
  const policyMaybeSingle = maybeSingle({ data: options.policy ?? null, error: options.policyError ?? null });

  // Chainable `.update(...).eq(...).eq(...)...` builder — the real
  // Supabase query builder is thenable at every step (awaitable directly)
  // and also exposes `.select()` for a final result with `data`.
  function updateBuilder(result: { data?: unknown; error: unknown }) {
    const builder: PromiseLike<typeof result> & { eq: () => typeof builder; select: () => Promise<typeof result> } = {
      eq: () => builder,
      select: vi.fn(async () => result),
      then: (resolve: (value: typeof result) => unknown) => resolve(result),
    } as never;
    return builder;
  }

  const claimUpdate = vi.fn(() => updateBuilder({ data: options.claimRows ?? [{ id: "cc1" }], error: null }));
  const auditInsert = vi.fn(async (..._args: unknown[]) => ({ error: null }));

  const regularFrom = vi.fn((table: string) => {
    if (table === "prompter_channel_campaigns") {
      return {
        // `.select().eq().eq()` is either the single-row lookup (`.single()`)
        // or the per-master allocation list (awaited directly).
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: channelCampaignSingle,
              then: (resolve: (value: typeof rowsResult) => unknown) => resolve(rowsResult),
            }),
          }),
        }),
        update: claimUpdate,
      };
    }
    if (table === "prompter_master_campaigns") {
      return { select: () => ({ eq: () => ({ eq: () => ({ single: masterCampaignSingle }) }) }) };
    }
    if (table === "prompter_connected_accounts") {
      return {
        select: (columns: string) => {
          connectedAccountSelects.push(columns);
          const isPageRead = columns === "selected_page_id";
          return {
            eq: () => ({
              eq: () => ({ maybeSingle: isPageRead ? pageReadMaybeSingle : connectedAccountMaybeSingle }),
            }),
          };
        },
      };
    }
    if (table === "prompter_budget_policies") {
      return { select: () => ({ eq: () => ({ maybeSingle: policyMaybeSingle }) }) };
    }
    if (table === "prompter_marketing_metrics") {
      const result = {
        data: options.metricsError ? null : options.metricsRows !== undefined ? options.metricsRows : [{ spend: options.monthToDateSpend ?? 0 }],
        error: options.metricsError ?? null,
      };
      const gte = vi.fn(async () => result);
      metricsGte = gte;
      return { select: () => ({ eq: () => ({ gte }) }) };
    }
    if (table === "prompter_audit_logs") {
      return { insert: auditInsert };
    }
    const preflight = preflightTable(table, fx);
    if (preflight) return preflight;
    throw new Error(`Unexpected table on regular client: ${table}`);
  });

  const adminFrom = vi.fn((table: string) => {
    if (table === "prompter_oauth_credentials") {
      return { select: () => ({ eq: () => ({ maybeSingle: credentialsMaybeSingle, eq: () => ({ maybeSingle: credentialsMaybeSingle }) }) }) };
    }
    throw new Error(`Unexpected table on admin client: ${table}`);
  });

  return { regularFrom, adminFrom, claimUpdate, auditInsert, connectedAccountSelects };
}

let fx: PreflightFixtures;
beforeEach(() => {
  fx = makePreflightFixtures();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.linoe.id");
  vi.stubEnv("META_REDIRECT_URI", "");
});

let harness: Harness;
let metricsGte: ReturnType<typeof vi.fn> | null = null;

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: harness.regularFrom })) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: harness.adminFrom, storage: makeAdminStorage(fx) })),
}));

import { launchChannelCampaignAction } from "@/features/campaigns/launch-actions";

function expectNoSideEffects(h: Harness) {
  expect(h.claimUpdate).not.toHaveBeenCalled();
  expect(h.auditInsert).not.toHaveBeenCalled();
  expect(connectorMock.createCampaign).not.toHaveBeenCalled();
  expect(connectorMock.createAdSet).not.toHaveBeenCalled();
  expect(h.adminFrom).not.toHaveBeenCalled();
}

describe("launchChannelCampaignAction — Track B pageId threading", () => {
  beforeEach(() => {
    requireSessionContextMock.mockClear();
    connectorMock.createCampaign.mockClear();
    connectorMock.createCreative.mockClear();
  });

  it("passes the tenant's selected_page_id into createCreative when one is set", async () => {
    harness = buildHarness();

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBeNull();
    expect(connectorMock.createCreative).toHaveBeenCalledWith(
      "access-token-abc",
      "act_123",
      expect.objectContaining({ pageId: "page_42" }),
    );
  });

  it("PR #36: with no Page selected the Meta launch is rejected BEFORE the claim and no other Page is picked", async () => {
    harness = buildHarness({
      connectedAccount: {
        data: { id: "acct1", external_account_id: "act_123", status: "CONNECTED", selected_page_id: null },
        error: null,
      },
    });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/Facebook Page/);
    expect(harness.claimUpdate).not.toHaveBeenCalled();
    expect(harness.auditInsert).not.toHaveBeenCalled();
    expect(connectorMock.createCampaign).not.toHaveBeenCalled();
    expect(connectorMock.createCreative).not.toHaveBeenCalled();
  });
});

describe("launchChannelCampaignAction — schema without Track B columns / failed connection reads (fail closed)", () => {
  const MISSING_COLUMN = { code: "42703", message: "column selected_page_id does not exist" };

  beforeEach(() => {
    requireSessionContextMock.mockClear();
    decryptTokenMock.mockClear();
    connectorMock.createCampaign.mockClear();
    connectorMock.createAdSet.mockClear();
    connectorMock.createCreative.mockClear();
    connectorMock.createAd.mockClear();
  });

  function expectNothingHappened(h: Harness) {
    expectNoSideEffects(h);
    expect(connectorMock.createCreative).not.toHaveBeenCalled();
    expect(connectorMock.createAd).not.toHaveBeenCalled();
    expect(decryptTokenMock).not.toHaveBeenCalled();
  }

  it("reads the base account without any Track B column, and selected_page_id separately for META", async () => {
    harness = buildHarness();

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBeNull();
    expect(harness.connectedAccountSelects).toEqual(["id, external_account_id, status, last_refreshed_at, expires_at", "selected_page_id"]);
  });

  it("never reads selected_page_id for TikTok (the column is Meta-only)", async () => {
    harness = buildHarness({
      channel: "TIKTOK",
      rows: [{ id: "cc1", channel: "TIKTOK", budget_percentage: 100 }],
    });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBeNull();
    expect(harness.connectedAccountSelects).toEqual(["id, external_account_id, status, last_refreshed_at, expires_at"]);
    expect(connectorMock.createCreative).toHaveBeenCalledWith(
      "access-token-abc",
      "act_123",
      expect.objectContaining({ pageId: undefined }),
    );
  });

  it("aborts with no side effect when selected_page_id cannot be read (production schema without Track B)", async () => {
    harness = buildHarness({ pageRead: { data: null, error: MISSING_COLUMN } });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/Pilihan Page Facebook tidak dapat dibaca/);
    expect(result.error).not.toMatch(/belum terhubung/i);
    expectNothingHappened(harness);
  });

  it("aborts with no side effect when the selected_page_id read returns no row", async () => {
    harness = buildHarness({ pageRead: { data: null, error: null } });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/Pilihan Page Facebook tidak dapat dibaca/);
    expectNothingHappened(harness);
  });

  it("does not turn an unreadable Page into a default: pageId is never passed on failure", async () => {
    harness = buildHarness({ pageRead: { data: { selected_page_id: "page_42" }, error: MISSING_COLUMN } });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/Pilihan Page Facebook tidak dapat dibaca/);
    expectNothingHappened(harness);
  });

  it("aborts with no side effect when the base connection read errors (not reported as 'belum terhubung')", async () => {
    harness = buildHarness({ connectedAccount: { data: null, error: { code: "42501", message: "denied" } } });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/Gagal membaca data koneksi akun/);
    expect(result.error).not.toMatch(/belum terhubung/i);
    expectNothingHappened(harness);
  });

  it("aborts with no side effect when the account is genuinely not connected", async () => {
    harness = buildHarness({ connectedAccount: { data: null, error: null } });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/belum terhubung/i);
    expectNothingHappened(harness);
  });

  it("aborts with no side effect when the account exists but is not CONNECTED", async () => {
    harness = buildHarness({
      connectedAccount: {
        data: { id: "acct1", external_account_id: "act_123", status: "EXPIRED" },
        error: null,
      },
    });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/belum terhubung/i);
    expectNothingHappened(harness);
  });

  it("PR #36: a readable but null selected_page_id is now rejected before the claim (no Meta call)", async () => {
    harness = buildHarness({ pageRead: { data: { selected_page_id: null }, error: null } });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toMatch(/Facebook Page/);
    expect(harness.claimUpdate).not.toHaveBeenCalled();
    expect(connectorMock.createCampaign).not.toHaveBeenCalled();
    expect(connectorMock.createCreative).not.toHaveBeenCalled();
  });
});

describe("launchChannelCampaignAction — PR #36 TikTok/X keep their existing flow", () => {
  beforeEach(() => {
    connectorMock.createCampaign.mockClear();
    connectorMock.createAdSet.mockClear();
    connectorMock.createCreative.mockClear();
  });

  it.each([
    ["TIKTOK", "CONVERSIONS"],
    ["X", "WEBSITE_CONVERSIONS"],
  ])("16. %s: same objective mapping, ID targeting, no Meta preflight reads", async (channel, objective) => {
    harness = buildHarness({
      channel,
      rows: [{ id: "cc1", channel, budget_percentage: 100 }],
      master: { objective: "INCREASE_SALES", product_id: null, target_country: null },
    });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBeNull();
    expect(connectorMock.createCampaign).toHaveBeenCalledWith(
      "access-token-abc",
      "act_123",
      expect.objectContaining({ objective }),
    );
    expect(connectorMock.createAdSet).toHaveBeenCalledWith(
      "access-token-abc",
      "act_123",
      expect.objectContaining({ targetingCountries: ["ID"] }),
    );
    const adSetInput = (connectorMock.createAdSet.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(adSetInput).not.toHaveProperty("optimizationGoal");
    const creativeInput = (connectorMock.createCreative.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(creativeInput).not.toHaveProperty("linkUrl");
    expect(creativeInput).not.toHaveProperty("imageUrl");
    expect(fx.reads).toEqual([]); // no approval / product / brand / media read for non-Meta
  });
});

describe("launchChannelCampaignAction — P0 idempotency guard", () => {
  beforeEach(() => {
    requireSessionContextMock.mockClear();
    connectorMock.createCampaign.mockClear();
  });

  it("aborts without calling the connector when the atomic claim finds no SCHEDULED row (already launched or in-flight elsewhere)", async () => {
    // Simulates a concurrent request having already flipped this row out of
    // SCHEDULED — the claim's WHERE clause matches zero rows.
    harness = buildHarness({ claimRows: [] });

    const result = await launchChannelCampaignAction("cc1");

    expect(result.error).toBe("Campaign ini sudah diluncurkan atau sedang diproses oleh permintaan lain.");
    expect(connectorMock.createCampaign).not.toHaveBeenCalled();
  });
});

describe("launchChannelCampaignAction — P0 budget launch safety", () => {
  beforeEach(() => {
    metricsGte = null;
    requireSessionContextMock.mockClear();
    connectorMock.createCampaign.mockClear();
    connectorMock.createAdSet.mockClear();
    connectorMock.createCreative.mockClear();
  });

  it("sends each paid channel only its normalised share (SEO excluded), never the master budget", async () => {
    harness = buildHarness();

    const result = await launchChannelCampaignAction("cc1");

    // FB 50 / IG 30 / SEO 20 → paid weight 80 → FB = 100.000 × 50/80
    expect(result.error).toBeNull();
    expect(connectorMock.createCampaign).toHaveBeenCalledWith(
      "access-token-abc",
      "act_123",
      expect.objectContaining({ dailyBudgetMinorUnits: 62500 }),
    );
    expect(connectorMock.createAdSet).toHaveBeenCalledWith(
      "access-token-abc",
      "act_123",
      expect.objectContaining({ dailyBudgetMinorUnits: 62500 }),
    );
  });

  it("FB and IG each receive their own share; together they equal the paid total, not 2× the master", async () => {
    const rows: ChannelRow[] = [
      { id: "cc1", channel: "FACEBOOK", budget_percentage: 25 },
      { id: "cc2", channel: "INSTAGRAM", budget_percentage: 15 },
      { id: "cc3", channel: "TIKTOK", budget_percentage: 30 },
      { id: "cc4", channel: "SEO", budget_percentage: 20 },
      { id: "cc5", channel: "X", budget_percentage: 10 },
    ];
    harness = buildHarness({ rows });
    await launchChannelCampaignAction("cc1");
    expect(connectorMock.createCampaign).toHaveBeenLastCalledWith(
      "access-token-abc",
      "act_123",
      expect.objectContaining({ dailyBudgetMinorUnits: 31250 }),
    );

    harness = buildHarness({ rows, channel: "INSTAGRAM", channelId: "cc2" });
    await launchChannelCampaignAction("cc2");
    expect(connectorMock.createCampaign).toHaveBeenLastCalledWith(
      "access-token-abc",
      "act_123",
      expect.objectContaining({ dailyBudgetMinorUnits: 18750 }),
    );
  });

  it("records the allocation in the launch audit context", async () => {
    harness = buildHarness();
    await launchChannelCampaignAction("cc1");

    expect(harness.auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "campaign.launched",
        context: expect.objectContaining({
          allocated_daily_budget: 62500,
          budget_percentage: 50,
          master_daily_budget: 100000,
          paid_total_percentage: 80,
        }),
      }),
    );
  });

  it("rejects a total-only campaign (no daily budget) — total_budget never becomes the daily budget", async () => {
    harness = buildHarness({ master: { daily_budget: null, total_budget: 500000 } });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/budget per hari/i);
    expectNoSideEffects(harness);
  });

  it.each([0, 1000.5])("rejects daily_budget %s", async (daily) => {
    harness = buildHarness({ master: { daily_budget: daily } });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).not.toBeNull();
    expectNoSideEffects(harness);
  });

  it("rejects a non-IDR campaign before any side effect", async () => {
    harness = buildHarness({ master: { currency: "USD" } });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/IDR/);
    expectNoSideEffects(harness);
  });

  it("blocks the whole master when a paid channel has 0%", async () => {
    harness = buildHarness({
      rows: [
        { id: "cc1", channel: "FACEBOOK", budget_percentage: 100 },
        { id: "cc2", channel: "TIKTOK", budget_percentage: 0 },
      ],
    });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/0%/);
    expectNoSideEffects(harness);
  });

  it("blocks when a channel's percentage is null", async () => {
    harness = buildHarness({
      rows: [
        { id: "cc1", channel: "FACEBOOK", budget_percentage: null },
        { id: "cc2", channel: "SEO", budget_percentage: 100 },
      ],
    });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/tidak valid/);
    expectNoSideEffects(harness);
  });

  it("blocks when the percentages do not sum to exactly 100", async () => {
    harness = buildHarness({
      rows: [
        { id: "cc1", channel: "FACEBOOK", budget_percentage: 50 },
        { id: "cc2", channel: "SEO", budget_percentage: 40 },
      ],
    });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/100%/);
    expectNoSideEffects(harness);
  });

  it("blocks the whole master when a paid allocation would be < 1", async () => {
    harness = buildHarness({
      master: { daily_budget: 1 },
      rows: [
        { id: "cc1", channel: "FACEBOOK", budget_percentage: 50 },
        { id: "cc2", channel: "TIKTOK", budget_percentage: 50 },
      ],
    });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/kurang dari 1/);
    expectNoSideEffects(harness);
  });

  it("blocks an unclassified channel row (fail closed)", async () => {
    harness = buildHarness({
      rows: [
        { id: "cc1", channel: "FACEBOOK", budget_percentage: 50 },
        { id: "cc2", channel: "LINKEDIN", budget_percentage: 50 },
      ],
    });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/belum diklasifikasikan/);
    expectNoSideEffects(harness);
  });

  it("blocks when the allocation rows cannot be read", async () => {
    harness = buildHarness({ rowsError: { message: "boom" } });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/alokasi budget/i);
    expectNoSideEffects(harness);
  });

  it("re-runs Budget Guard read-only and rejects before any side effect", async () => {
    harness = buildHarness({
      policy: {
        tenant_id: "t1",
        daily_limit: 50000,
        monthly_limit: null,
        campaign_limit: null,
        currency: "IDR",
        require_approval_above: null,
        autopilot_limit: null,
        created_at: "",
        updated_at: "",
      },
    });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/melebihi batas/);
    expectNoSideEffects(harness);
  });

  it("fails closed when the Budget Guard policy cannot be read", async () => {
    harness = buildHarness({ policyError: { message: "rls" } });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/Budget Guard/);
    expectNoSideEffects(harness);
  });

  it("never writes a budget policy row (read-only re-check)", async () => {
    harness = buildHarness();
    await launchChannelCampaignAction("cc1");
    const tables = harness.regularFrom.mock.calls.map((call) => call[0]);
    expect(tables).toContain("prompter_budget_policies");
    const policyCalls = harness.regularFrom.mock.results
      .map((r, i) => (harness.regularFrom.mock.calls[i][0] === "prompter_budget_policies" ? r.value : null))
      .filter(Boolean);
    for (const c of policyCalls) {
      expect(c).not.toHaveProperty("insert");
      expect(c).not.toHaveProperty("update");
    }
  });

  it("launching a SEO channel row is still refused (no connector) with no side effect", async () => {
    harness = buildHarness({ channel: "SEO" });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/belum didukung/);
    expectNoSideEffects(harness);
  });
  describe("month-to-date spend (fail closed)", () => {
    it("blocks before any side effect when the metrics query errors", async () => {
      harness = buildHarness({ policy: {
      tenant_id: "t1",
      daily_limit: null,
      monthly_limit: 50000000,
      campaign_limit: null,
      currency: "IDR",
      require_approval_above: null,
      autopilot_limit: null,
      created_at: "",
      updated_at: "",
    }, metricsError: { message: "db down" } });
      const result = await launchChannelCampaignAction("cc1");
      expect(result.error).toMatch(/pengeluaran bulan ini/);
      expectNoSideEffects(harness);
    });

    it("blocks when the metrics query returns no data", async () => {
      harness = buildHarness({ policy: {
      tenant_id: "t1",
      daily_limit: null,
      monthly_limit: 50000000,
      campaign_limit: null,
      currency: "IDR",
      require_approval_above: null,
      autopilot_limit: null,
      created_at: "",
      updated_at: "",
    }, metricsRows: null });
      const result = await launchChannelCampaignAction("cc1");
      expect(result.error).toMatch(/pengeluaran bulan ini/);
      expectNoSideEffects(harness);
    });

    it.each([["abc"], [Number.POSITIVE_INFINITY], [-5]])("blocks on invalid spend value %s", async (spend) => {
      harness = buildHarness({ policy: {
      tenant_id: "t1",
      daily_limit: null,
      monthly_limit: 50000000,
      campaign_limit: null,
      currency: "IDR",
      require_approval_above: null,
      autopilot_limit: null,
      created_at: "",
      updated_at: "",
    }, metricsRows: [{ spend }] });
      const result = await launchChannelCampaignAction("cc1");
      expect(result.error).toMatch(/tidak valid/);
      expectNoSideEffects(harness);
    });

    it("allows a successful query with zero recorded spend when the other guards pass", async () => {
      harness = buildHarness({ policy: {
      tenant_id: "t1",
      daily_limit: null,
      monthly_limit: 50000000,
      campaign_limit: null,
      currency: "IDR",
      require_approval_above: null,
      autopilot_limit: null,
      created_at: "",
      updated_at: "",
    }, metricsRows: [] });
      const result = await launchChannelCampaignAction("cc1");
      expect(result.error).toBeNull();
      expect(connectorMock.createCampaign).toHaveBeenCalledTimes(1);
      expect(metricsGte).not.toBeNull();
    });

    it("still rejects when real recorded spend plus projection exceeds the monthly limit", async () => {
      harness = buildHarness({ policy: {
      tenant_id: "t1",
      daily_limit: null,
      monthly_limit: 1000000,
      campaign_limit: null,
      currency: "IDR",
      require_approval_above: null,
      autopilot_limit: null,
      created_at: "",
      updated_at: "",
    }, monthToDateSpend: 999999 });
      const result = await launchChannelCampaignAction("cc1");
      expect(result.error).toMatch(/bulan ini/);
      expectNoSideEffects(harness);
    });

    it("does not query month-to-date spend when monthly_limit is null", async () => {
      harness = buildHarness({ metricsError: { message: "would fail if queried" } });
      const result = await launchChannelCampaignAction("cc1");
      expect(result.error).toBeNull();
      expect(metricsGte).toBeNull();
      expect(harness.regularFrom.mock.calls.map((c) => c[0])).not.toContain("prompter_marketing_metrics");
    });
  });
});

describe("launchChannelCampaignAction — approval destination snapshot", () => {
  const builtWa = buildPurchaseDestination({ type: "WHATSAPP", value: "081234567890" }, null);
  if (!builtWa.ok) throw new Error("fixture");
  const WA = builtWa.value as { version: number; type: string; value: string; link: string };
  const WEB = { version: 1, type: "WEBSITE", value: "https://tokosaya.com/produk", link: "https://tokosaya.com/produk" };
  const proposal = (d: unknown) => ({ ...LAUNCHABLE_PROPOSAL, purchase_destination: d });
  const snapOf = (d: typeof WEB) => ({
    destination_snapshot: { version: 1, kind: "destination", type: d.type, value: d.value, link: d.link },
    copy_snapshot: LAUNCHABLE_COPY_SNAPSHOT,
  });
  const legacySnap = (link: string | null) => ({
    destination_snapshot: link ? { version: 1, kind: "legacy_url", link } : { version: 1, kind: "legacy_unresolved" },
    copy_snapshot: LAUNCHABLE_COPY_SNAPSHOT,
  });
  const approved = (context?: unknown, created_at = "2026-10-01T00:00:00Z") =>
    context === undefined ? { status: "APPROVED", created_at } : { status: "APPROVED", created_at, context };
  const LEGACY_URL = "https://toko-saya.co.id/produk";

  beforeEach(() => {
    requireSessionContextMock.mockClear();
    connectorMock.createCampaign.mockClear();
    connectorMock.createCreative.mockClear();
  });

  function expectRefusedBeforeAnyCall(result: { error: string | null }, pattern: RegExp) {
    expect(result.error).toMatch(pattern);
    expect(harness.claimUpdate).not.toHaveBeenCalled();
    expect(connectorMock.createCampaign).not.toHaveBeenCalled();
    expect(connectorMock.createCreative).not.toHaveBeenCalled();
  }

  it("launches when the current destination equals the approved snapshot (website, with utm)", async () => {
    harness = buildHarness({ master: { ai_proposal: proposal(WEB) } });
    fx.approvals = [approved(snapOf(WEB))];
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toBeNull();
    const creative = (connectorMock.createCreative.mock.calls[0] as unknown[])[2] as { linkUrl: string };
    expect(creative.linkUrl).toContain("https://tokosaya.com/produk");
    expect(creative.linkUrl).toContain("utm_");
  });

  it("launches a WhatsApp destination with the wa.me link and no utm", async () => {
    harness = buildHarness({ master: { ai_proposal: proposal(WA) } });
    fx.approvals = [approved(snapOf(WA))];
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toBeNull();
    const creative = (connectorMock.createCreative.mock.calls[0] as unknown[])[2] as { linkUrl: string };
    expect(creative.linkUrl).toBe(WA.link);
  });

  it("refuses a destination changed after approval, before the claim and before any platform call", async () => {
    harness = buildHarness({ master: { ai_proposal: proposal(WA) } });
    fx.approvals = [approved(snapOf(WEB))];
    expectRefusedBeforeAnyCall(await launchChannelCampaignAction("cc1"), /berbeda dari yang disetujui/);
  });

  it("refuses a new-format campaign whose approval has no snapshot (fail closed)", async () => {
    harness = buildHarness({ master: { ai_proposal: proposal(WEB) } });
    // No DESTINATION snapshot (the copy fingerprint is present, so the copy guard passes and this stays a destination test).
    fx.approvals = [approved({ copy_snapshot: LAUNCHABLE_COPY_SNAPSHOT })];
    expectRefusedBeforeAnyCall(await launchChannelCampaignAction("cc1"), /persetujuan lama/);
  });

  it("only the LATEST approval's snapshot counts", async () => {
    harness = buildHarness({ master: { ai_proposal: proposal(WA) } });
    fx.approvals = [approved(snapOf(WA), "2026-10-01T00:00:00Z"), approved(snapOf(WEB), "2026-10-02T00:00:00Z")];
    expectRefusedBeforeAnyCall(await launchChannelCampaignAction("cc1"), /berbeda dari yang disetujui/);
  });

  it("an EXPIRED approval (e.g. after a recovery) never authorises a launch, even with a matching snapshot", async () => {
    harness = buildHarness({ master: { ai_proposal: proposal(WEB) } });
    fx.approvals = [{ status: "EXPIRED", created_at: "2026-10-01T00:00:00Z", context: snapOf(WEB) }];
    expectRefusedBeforeAnyCall(await launchChannelCampaignAction("cc1"), /persetujuan peluncuran/);
  });

  describe("legacy campaigns (no stored destination)", () => {
    it("launches when the product URL is the one recorded at approval", async () => {
      harness = buildHarness();
      fx.approvals = [approved(legacySnap(LEGACY_URL))];
      const result = await launchChannelCampaignAction("cc1");
      expect(result.error).toBeNull();
      const creative = (connectorMock.createCreative.mock.calls[0] as unknown[])[2] as { linkUrl: string };
      expect(creative.linkUrl).toBe(LEGACY_URL);
    });

    it("an OLD approval with no snapshot never authorises a legacy launch", async () => {
      harness = buildHarness();
      fx.approvals = [approved({ copy_snapshot: LAUNCHABLE_COPY_SNAPSHOT })];
      expectRefusedBeforeAnyCall(await launchChannelCampaignAction("cc1"), /persetujuan lama/);
    });

    it("an OLD approval whose context has only budget fields is refused", async () => {
      harness = buildHarness();
      fx.approvals = [approved({ daily_budget: 100000, total_budget: null, copy_snapshot: LAUNCHABLE_COPY_SNAPSHOT })];
      expectRefusedBeforeAnyCall(await launchChannelCampaignAction("cc1"), /persetujuan lama/);
    });

    it("the product URL changed after approval is refused", async () => {
      harness = buildHarness();
      fx.approvals = [approved(legacySnap(LEGACY_URL))];
      fx.product = { id: "p1", website_url: "https://toko-lain.co.id/produk" };
      expectRefusedBeforeAnyCall(await launchChannelCampaignAction("cc1"), /berbeda dari yang disetujui/);
    });

    it("the brand fallback URL changed after approval is refused", async () => {
      harness = buildHarness();
      fx.product = { id: "p1", website_url: null };
      fx.brand = { website_url: "https://brand-lama.id/" };
      fx.approvals = [approved(legacySnap("https://brand-lama.id/"))];
      fx.brand = { website_url: "https://brand-baru.id/" };
      expectRefusedBeforeAnyCall(await launchChannelCampaignAction("cc1"), /berbeda dari yang disetujui/);
    });

    it("the URL removed after approval is refused", async () => {
      harness = buildHarness();
      fx.approvals = [approved(legacySnap(LEGACY_URL))];
      fx.product = { id: "p1", website_url: null };
      fx.brand = { website_url: null };
      const result = await launchChannelCampaignAction("cc1");
      expect(result.error).toBeTruthy();
      expect(harness.claimUpdate).not.toHaveBeenCalled();
      expect(connectorMock.createCampaign).not.toHaveBeenCalled();
    });

    it("the URL changed to an LINOE / unsafe address after approval is refused", async () => {
      harness = buildHarness();
      fx.approvals = [approved(legacySnap(LEGACY_URL))];
      fx.product = { id: "p1", website_url: "http://toko-saya.co.id/produk" };
      const result = await launchChannelCampaignAction("cc1");
      expect(result.error).toBeTruthy();
      expect(connectorMock.createCampaign).not.toHaveBeenCalled();
    });

    it("an approval recorded WITHOUT a landing URL does not cover a URL added later", async () => {
      harness = buildHarness();
      fx.approvals = [approved(legacySnap(null))];
      expectRefusedBeforeAnyCall(await launchChannelCampaignAction("cc1"), /berbeda dari yang disetujui/);
    });

    it("a legacy campaign that gained a destination after a legacy approval is refused", async () => {
      harness = buildHarness({ master: { ai_proposal: proposal(WEB) } });
      fx.approvals = [approved(legacySnap(LEGACY_URL))];
      expectRefusedBeforeAnyCall(await launchChannelCampaignAction("cc1"), /berbeda dari yang disetujui/);
    });

    it("the old first-version { kind: 'legacy' } snapshot is not trusted", async () => {
      harness = buildHarness();
      fx.approvals = [approved({ destination_snapshot: { version: 1, kind: "legacy" }, copy_snapshot: LAUNCHABLE_COPY_SNAPSHOT })];
      expectRefusedBeforeAnyCall(await launchChannelCampaignAction("cc1"), /berbeda dari yang disetujui/);
    });
  });
});

describe("launchChannelCampaignAction — approval threshold (require_approval_above)", () => {
  const policyWith = (requireApprovalAbove: number | null) => ({
    tenant_id: "t1",
    daily_limit: null,
    monthly_limit: null,
    campaign_limit: null,
    currency: "IDR",
    require_approval_above: requireApprovalAbove,
    autopilot_limit: null,
    created_at: "",
    updated_at: "",
  });
  const THRESHOLD_MESSAGE = /batas persetujuan/;
  const decided = { decided_by: "owner-1", decided_at: "2026-10-01T01:00:00Z" };

  beforeEach(() => {
    requireSessionContextMock.mockClear();
    connectorMock.createCampaign.mockClear();
    connectorMock.createAdSet.mockClear();
  });

  function expectRefused(result: { error: string | null }, pattern: RegExp) {
    expect(result.error).toMatch(pattern);
    expect(harness.claimUpdate).not.toHaveBeenCalled();
    expect(connectorMock.createCampaign).not.toHaveBeenCalled();
    expect(connectorMock.createAdSet).not.toHaveBeenCalled();
  }

  it("above the threshold: an approval without a recorded Owner decision is refused before any side effect", async () => {
    harness = buildHarness({ policy: policyWith(50_000) });
    fx.approvals = [{ status: "APPROVED", created_at: "2026-10-01T00:00:00Z", context: { daily_budget: 100_000, total_budget: null } }];
    expectRefused(await launchChannelCampaignAction("cc1"), THRESHOLD_MESSAGE);
  });

  it("above the threshold: an approved budget below the current budget is refused", async () => {
    harness = buildHarness({ policy: policyWith(50_000) });
    fx.approvals = [
      { status: "APPROVED", created_at: "2026-10-01T00:00:00Z", ...decided, context: { daily_budget: 60_000, total_budget: null } },
    ];
    expectRefused(await launchChannelCampaignAction("cc1"), /melebihi nilai yang disetujui/);
  });

  it("above the threshold: an approval that does not record the total budget cannot cover a campaign that has one", async () => {
    harness = buildHarness({ policy: policyWith(50_000), master: { daily_budget: 100_000, total_budget: 900_000 } });
    fx.approvals = [{ status: "APPROVED", created_at: "2026-10-01T00:00:00Z", ...decided, context: { daily_budget: 100_000 } }];
    expectRefused(await launchChannelCampaignAction("cc1"), THRESHOLD_MESSAGE);
  });

  it("above the threshold: an explicit Owner decision covering daily and total passes this check", async () => {
    harness = buildHarness({ policy: policyWith(50_000), master: { daily_budget: 100_000, total_budget: 900_000, duration_days: 9 } });
    fx.approvals = [
      { status: "APPROVED", created_at: "2026-10-01T00:00:00Z", ...decided, context: { daily_budget: 100_000, total_budget: 900_000 } },
    ];
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error ?? "").not.toMatch(THRESHOLD_MESSAGE);
  });

  it("threshold not set: a legacy approval without decided_by behaves as before", async () => {
    harness = buildHarness({ policy: policyWith(null) });
    fx.approvals = [{ status: "APPROVED", created_at: "2026-10-01T00:00:00Z" }];
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error ?? "").not.toMatch(THRESHOLD_MESSAGE);
  });

  it("budget at or below the threshold: no extra requirement", async () => {
    harness = buildHarness({ policy: policyWith(100_000) });
    fx.approvals = [{ status: "APPROVED", created_at: "2026-10-01T00:00:00Z" }];
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error ?? "").not.toMatch(THRESHOLD_MESSAGE);
  });
});

describe("launchChannelCampaignAction — campaign_limit for a campaign without total_budget", () => {
  const policyWithLimit = (campaignLimit: number | null) => ({
    tenant_id: "t1",
    daily_limit: null,
    monthly_limit: null,
    campaign_limit: campaignLimit,
    currency: "IDR",
    require_approval_above: null,
    autopilot_limit: null,
    created_at: "",
    updated_at: "",
  });

  beforeEach(() => {
    requireSessionContextMock.mockClear();
    connectorMock.createCampaign.mockClear();
    connectorMock.createAdSet.mockClear();
  });

  function expectRefusedBeforeClaim(result: { error: string | null }, pattern: RegExp) {
    expect(result.error).toMatch(pattern);
    expect(harness.claimUpdate).not.toHaveBeenCalled();
    expect(harness.auditInsert).not.toHaveBeenCalled();
    expect(connectorMock.createCampaign).not.toHaveBeenCalled();
    expect(connectorMock.createAdSet).not.toHaveBeenCalled();
  }

  it("limit set, daily-only campaign (no total, no duration): refused BEFORE the claim (spend unbounded)", async () => {
    harness = buildHarness({ policy: policyWithLimit(1_000_000), master: { daily_budget: 100_000, total_budget: null, duration_days: null } });
    expectRefusedBeforeClaim(await launchChannelCampaignAction("cc1"), /tidak terbatas/);
  });

  it("limit set, no total: daily x duration above the limit is refused BEFORE the claim", async () => {
    harness = buildHarness({ policy: policyWithLimit(499_999), master: { daily_budget: 100_000, total_budget: null, duration_days: 5 } });
    expectRefusedBeforeClaim(await launchChannelCampaignAction("cc1"), /melebihi batas budget per campaign/);
  });

  it("limit set, no total: daily x duration exactly at the limit launches as before", async () => {
    harness = buildHarness({ policy: policyWithLimit(500_000), master: { daily_budget: 100_000, total_budget: null, duration_days: 5 } });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toBeNull();
    expect(connectorMock.createCampaign).toHaveBeenCalledTimes(1);
  });

  it("no limit set: a daily-only campaign behaves as before", async () => {
    harness = buildHarness({ policy: policyWithLimit(null), master: { daily_budget: 100_000, total_budget: null, duration_days: null } });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toBeNull();
  });
});

describe("launchChannelCampaignAction — Meta flight end_time (launch time + duration, start_date ignored)", () => {
  beforeEach(() => {
    requireSessionContextMock.mockClear();
    connectorMock.createCampaign.mockClear();
    connectorMock.createAdSet.mockClear();
  });

  const adSetInput = () => (connectorMock.createAdSet.mock.calls[0] as unknown[])[2] as Record<string, unknown>;

  it.each([
    ["future start_date", "2027-03-01"],
    ["past start_date", "2020-01-01"],
    ["no start_date", null],
  ])("%s: end_time is launch time + duration, never counted from start_date", async (_label, startDate) => {
    harness = buildHarness({ master: { duration_days: 5, start_date: startDate } });
    const before = Math.floor(Date.now() / 1000);
    const result = await launchChannelCampaignAction("cc1");
    const after = Math.floor(Date.now() / 1000);
    expect(result.error).toBeNull();
    const end = adSetInput().endTimeUnixSeconds as number;
    expect(end).toBeGreaterThanOrEqual(before + 5 * 86_400);
    expect(end).toBeLessThanOrEqual(after + 5 * 86_400);
    expect(adSetInput()).not.toHaveProperty("startTimeUnixSeconds");
  });

  it("a duration of 1 day is refused BEFORE the claim (nothing created)", async () => {
    harness = buildHarness({ master: { duration_days: 1 } });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/Durasi campaign tidak valid/);
    expect(harness.claimUpdate).not.toHaveBeenCalled();
    expect(connectorMock.createCampaign).not.toHaveBeenCalled();
    expect(connectorMock.createAdSet).not.toHaveBeenCalled();
  });

  it("total_budget without duration is refused BEFORE the claim (spend could not be bounded)", async () => {
    harness = buildHarness({ master: { daily_budget: 100_000, total_budget: 900_000, duration_days: null } });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/durasi campaign belum diisi/);
    expect(harness.claimUpdate).not.toHaveBeenCalled();
    expect(connectorMock.createCampaign).not.toHaveBeenCalled();
  });

  it("daily x duration above total_budget is refused BEFORE the claim", async () => {
    harness = buildHarness({ master: { daily_budget: 100_000, total_budget: 899_999, duration_days: 9 } });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toMatch(/melebihi budget total/);
    expect(harness.claimUpdate).not.toHaveBeenCalled();
    expect(connectorMock.createAdSet).not.toHaveBeenCalled();
  });

  it("neither total_budget nor duration: no end_time (unchanged behaviour)", async () => {
    harness = buildHarness();
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toBeNull();
    expect(adSetInput()).not.toHaveProperty("endTimeUnixSeconds");
  });
});

describe("launchChannelCampaignAction — copy guard (FIX-195-LAUNCH-GUARD)", () => {
  const snapshotOf = (p: unknown) => buildCopySnapshot(p) as NonNullable<ReturnType<typeof buildCopySnapshot>>;
  const approvedWith = (context: unknown) => [{ status: "APPROVED", created_at: "2026-10-01T00:00:00Z", context }];
  const LEGACY_COPY = { headline: "Kopi Robusta Aceh", primary_text: "Kopi sangrai medium 200 gram", cta: "Lihat" };

  beforeEach(() => {
    requireSessionContextMock.mockClear();
    decryptTokenMock.mockClear();
    for (const fn of Object.values(connectorMock)) fn.mockClear();
  });

  /** Refused before the connection reads, the token decryption, every provider call and the claim. */
  function expectRefusedBeforeAnySideEffect(result: { error: string | null }, pattern: RegExp) {
    expect(result.error).toMatch(pattern);
    expect(harness.connectedAccountSelects).toEqual([]);
    expect(harness.claimUpdate).not.toHaveBeenCalled();
    expect(harness.auditInsert).not.toHaveBeenCalled();
    expect(harness.adminFrom).not.toHaveBeenCalled();
    expect(decryptTokenMock).not.toHaveBeenCalled();
    for (const fn of Object.values(connectorMock)) expect(fn).not.toHaveBeenCalled();
  }

  it.each([
    ["no stored proposal (null)", null],
    ["empty object", {}],
    ["a string", "Kopi Robusta"],
    ["an array", [LEGACY_COPY]],
    ["headline is a number", { ...LAUNCHABLE_PROPOSAL, headline: 5 }],
    ["headline empty", { ...LAUNCHABLE_PROPOSAL, headline: "" }],
    ["headline whitespace", { ...LAUNCHABLE_PROPOSAL, headline: "   " }],
    ["primary_text missing", { ...LAUNCHABLE_PROPOSAL, primary_text: undefined }],
    ["cta missing", { ...LAUNCHABLE_PROPOSAL, cta: undefined }],
  ])("an approved campaign whose proposal is %s is refused with zero side effects", async (_name, aiProposal) => {
    harness = buildHarness({ master: { ai_proposal: aiProposal } });
    fx.approvals = approvedWith({ copy_snapshot: LAUNCHABLE_COPY_SNAPSHOT });
    expectRefusedBeforeAnySideEffect(await launchChannelCampaignAction("cc1"), /Peluncuran dibatalkan.*teks iklan belum lengkap/);
  });

  it("copy over the length limit is refused (length message, not the block message)", async () => {
    const tooLong = { ...LAUNCHABLE_PROPOSAL, primary_text: "a".repeat(601) };
    harness = buildHarness({ master: { ai_proposal: tooLong } });
    fx.approvals = approvedWith({ copy_snapshot: snapshotOf(tooLong) });
    const result = await launchChannelCampaignAction("cc1");
    expectRefusedBeforeAnySideEffect(result, /melebihi batas panjang/);
    expect(result.error).not.toMatch(/diblokir/);
  });

  it("a blocking claim in the active copy is refused even when the approval fingerprint matches it", async () => {
    const claim = { ...LAUNCHABLE_PROPOSAL, headline: "Passive income dari rumah" };
    harness = buildHarness({ master: { ai_proposal: claim } });
    fx.approvals = approvedWith({ copy_snapshot: snapshotOf(claim) });
    const result = await launchChannelCampaignAction("cc1");
    expectRefusedBeforeAnySideEffect(result, /memuat hal yang diblokir/);
    expect(result.error).not.toMatch(/melebihi batas panjang|belum lengkap/);
  });

  it("a legacy proposal that only passes the REDUCED check is not launchable (the full gate never ran)", async () => {
    harness = buildHarness({ master: { ai_proposal: LEGACY_COPY } });
    fx.approvals = approvedWith({ copy_snapshot: snapshotOf(LEGACY_COPY) });
    expectRefusedBeforeAnySideEffect(await launchChannelCampaignAction("cc1"), /berformat lama.*Quality Gate penuh/);
  });

  it("copy edited after the approval (fingerprint mismatch) is refused", async () => {
    const edited = { ...LAUNCHABLE_PROPOSAL, headline: "Judul lain yang tidak disetujui Owner" };
    harness = buildHarness({ master: { ai_proposal: edited } });
    fx.approvals = approvedWith({ copy_snapshot: LAUNCHABLE_COPY_SNAPSHOT });
    expectRefusedBeforeAnySideEffect(await launchChannelCampaignAction("cc1"), /copy iklan berbeda dari yang disetujui/);
  });

  it.each([
    ["an old approval without any copy fingerprint", { destination_snapshot: { version: 1, kind: "legacy_unresolved" } }],
    ["a malformed fingerprint", { copy_snapshot: { version: 1, algorithm: "sha256", hash: 42 } }],
    ["a null context", null],
  ])("%s is refused (fail closed, resubmit needed)", async (_name, context) => {
    harness = buildHarness();
    fx.approvals = approvedWith(context);
    expectRefusedBeforeAnySideEffect(await launchChannelCampaignAction("cc1"), /persetujuan ini dibuat sebelum copy dicatat/);
  });

  it("valid copy whose fingerprint matches the approval still goes on to the creative, with exactly that copy", async () => {
    harness = buildHarness();
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toBeNull();
    expect(connectorMock.createCreative).toHaveBeenCalledWith(
      "access-token-abc",
      "act_123",
      expect.objectContaining({ headline: LAUNCHABLE_PROPOSAL.headline, primaryText: LAUNCHABLE_PROPOSAL.primary_text, cta: LAUNCHABLE_PROPOSAL.cta }),
    );
  });

  it("submit and launch use the SAME validator and reach the same decision for the same proposal", async () => {
    const proposals: unknown[] = [
      null,
      {},
      LEGACY_COPY,
      { ...LEGACY_COPY, headline: "" },
      { ...LAUNCHABLE_PROPOSAL, primary_text: "a".repeat(601) },
      { ...LAUNCHABLE_PROPOSAL, headline: "Passive income dari rumah" },
      LAUNCHABLE_PROPOSAL,
    ];
    const ctx = async () => ({ productName: null, knownFacts: null });
    for (const proposal of proposals) {
      const submit = await evaluateCopyGuard(proposal, { action: "SUBMIT", loadContext: ctx });
      const launch = await evaluateCopyGuard(proposal, { action: "LAUNCH", loadContext: ctx });
      expect(launch.ok).toBe(submit.ok);
      expect(launch.level).toBe(submit.level);
      if (!submit.ok && !launch.ok) expect(launch.reason).toBe(submit.reason);
    }
    const root = process.cwd();
    for (const file of ["features/campaigns/actions.ts", "features/campaigns/launch-actions.ts"]) {
      const source = readFileSync(`${root}/${file}`, "utf8");
      expect(source, file).toContain("evaluateCopyGuard(");
      expect(source, file).not.toContain("evaluateCampaignQuality(");
      expect(source, file).not.toContain("scanRawProposalCopy(");
    }
  });

  it("TOCTOU: copy changed in the proposal AFTER the guard (before the creative) is not what gets sent: the approved, checked copy is", async () => {
    const live = JSON.parse(JSON.stringify(LAUNCHABLE_PROPOSAL)) as Record<string, unknown>;
    harness = buildHarness({ master: { ai_proposal: live } });
    // Simulates a direct writer: the stored proposal object changes while the launch is already running.
    connectorMock.createAdSet.mockImplementationOnce(async () => {
      live.headline = "Judul yang disuntikkan setelah guard";
      live.primary_text = "Teks yang disuntikkan setelah guard";
      live.cta = "Klik di sini";
      return { id: "ext_adset_1" };
    });
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toBeNull();
    const creative = (connectorMock.createCreative.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(creative).toMatchObject({
      headline: LAUNCHABLE_PROPOSAL.headline,
      primaryText: LAUNCHABLE_PROPOSAL.primary_text,
      cta: LAUNCHABLE_PROPOSAL.cta,
    });
  });
});

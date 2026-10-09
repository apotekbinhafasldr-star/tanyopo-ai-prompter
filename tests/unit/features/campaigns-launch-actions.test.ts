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
  claimUpdate: ReturnType<typeof vi.fn>;
  auditInsert: ReturnType<typeof vi.fn>;
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
      objective: "INCREASE_SALES",
      currency: "IDR",
      daily_budget: 100000,
      total_budget: null,
      ai_proposal: { headline: "Diskon Besar", primary_text: "Beli sekarang", cta: "Beli Sekarang" },
      ...options.master,
    },
    error: null,
  });
  const connectedAccountMaybeSingle = maybeSingle(options.connectedAccount ?? CONNECTED);
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
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: connectedAccountMaybeSingle }) }) }) };
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
    throw new Error(`Unexpected table on regular client: ${table}`);
  });

  const adminFrom = vi.fn((table: string) => {
    if (table === "prompter_oauth_credentials") {
      return { select: () => ({ eq: () => ({ maybeSingle: credentialsMaybeSingle }) }) };
    }
    throw new Error(`Unexpected table on admin client: ${table}`);
  });

  return { regularFrom, adminFrom, claimUpdate, auditInsert };
}

let harness: Harness;
let metricsGte: ReturnType<typeof vi.fn> | null = null;

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: harness.regularFrom })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ from: harness.adminFrom })) }));

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

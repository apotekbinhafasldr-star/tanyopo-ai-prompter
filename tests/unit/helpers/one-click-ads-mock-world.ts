import { vi } from "vitest";
import { createFakeDb, type FakeDb, type FakeDbOptions, type Row } from "./stateful-fake-db";
import { makeAdminStorage, makePreflightFixtures } from "./meta-preflight-fixtures";

/**
 * MOCK E2E world for the One-Click Ads flow. IN-MEMORY ONLY: a stateful fake
 * database (stateful-fake-db.ts) plus a FAKE ad-platform connector. Nothing here
 * opens a socket, reads a secret or talks to Meta. This proves the ORDER of the
 * flow and its guards inside our own code; it is NOT evidence that a real ad
 * account, the real Meta API or a real database behaves the same way.
 */

export const TENANT_A = "tenant-a";
export const TENANT_B = "tenant-b";
export const OWNER_A = "user-owner-a";
export const MARKETING_A = "user-marketing-a";
export const OWNER_B = "user-owner-b";

export const MASTER_A = "m-a";
export const MASTER_B = "m-b";
export const CHANNEL_A1 = "cc-a1"; // FACEBOOK, 60 %
export const CHANNEL_A2 = "cc-a2"; // INSTAGRAM, 40 %
export const CHANNEL_B1 = "cc-b1"; // FACEBOOK, 100 %

export const AD_ACCOUNT_A = "act_1001";
export const AD_ACCOUNT_B = "act_2002";

export interface SessionShape {
  tenantId: string;
  userId: string;
  role: string;
}

export const sessionOf = (tenantId: string, userId: string, role: string): SessionShape => ({ tenantId, userId, role });

// ---------------------------------------------------------------------------
// Fake connector
// ---------------------------------------------------------------------------

export interface FakeObject {
  type: "campaign" | "adSet" | "creative" | "ad";
  id: string;
  adAccountId: string;
  /** Mirrors the real connector contract: every object is created PAUSED. Nothing here can activate it. */
  status: "PAUSED";
  input: Record<string, unknown>;
}

export interface FakeConnectorCall {
  method: string;
  adAccountId: string | null;
}

export const WRITE_METHODS = ["createCampaign", "createAdSet", "createCreative", "createAd", "updateBudget", "pauseCampaign"] as const;

/**
 * An in-memory PlatformConnector. Every method is recorded in `calls` (method
 * name and ad account id only, never a token). `hooks.afterCreate` lets a test
 * model something happening between two creates (e.g. Emergency Stop turned on).
 */
export function createFakeAdsConnector() {
  const objects: FakeObject[] = [];
  const calls: FakeConnectorCall[] = [];
  const counters = { campaign: 0, adSet: 0, creative: 0, ad: 0 };
  const hooks: { afterCreate?: (type: FakeObject["type"]) => void } = {};
  const insights = { spend: 12345, impressions: 4000, reach: 3100, clicks: 87, raw: { source: "fake-connector" } };

  const record = (method: string, adAccountId: string | null) => calls.push({ method, adAccountId });

  function create(type: FakeObject["type"], method: string, adAccountId: string, input: unknown): { id: string } {
    record(method, adAccountId);
    counters[type] += 1;
    const id = `ext_${type}_${counters[type]}`;
    objects.push({ type, id, adAccountId, status: "PAUSED", input: { ...(input as Record<string, unknown>) } });
    hooks.afterCreate?.(type);
    return { id };
  }

  const connector = {
    platform: "META" as const,
    isConfigured: vi.fn(() => true),
    getAdAccountCurrencyEvidence: vi.fn(async (_token: string, adAccountId: string) => {
      record("getAdAccountCurrencyEvidence", adAccountId);
      return { kind: "VERIFIED" as const, accountId: adAccountId, currency: "IDR" };
    }),
    createCampaign: vi.fn(async (_t: string, adAccountId: string, input: unknown) => create("campaign", "createCampaign", adAccountId, input)),
    createAdSet: vi.fn(async (_t: string, adAccountId: string, input: unknown) => create("adSet", "createAdSet", adAccountId, input)),
    createCreative: vi.fn(async (_t: string, adAccountId: string, input: unknown) => create("creative", "createCreative", adAccountId, input)),
    createAd: vi.fn(async (_t: string, adAccountId: string, input: unknown) => create("ad", "createAd", adAccountId, input)),
    getInsights: vi.fn(async (_t: string, adAccountId: string) => {
      record("getInsights", adAccountId);
      return { ...insights };
    }),
    pauseCampaign: vi.fn(async (_t: string, adAccountId: string) => {
      record("pauseCampaign", adAccountId);
    }),
    updateBudget: vi.fn(async (_t: string, adAccountId: string) => {
      record("updateBudget", adAccountId);
    }),
  };

  return {
    connector,
    objects,
    calls,
    hooks,
    insights,
    /** Calls that create or change anything on the (fake) platform. */
    writeCalls: () => calls.filter((c) => (WRITE_METHODS as readonly string[]).includes(c.method)),
    countOf: (method: string) => calls.filter((c) => c.method === method).length,
  };
}

export type FakeAdsConnector = ReturnType<typeof createFakeAdsConnector>;

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export interface WorldOptions {
  /** Extra seed rows merged into (appended to) the default tables. */
  extraRows?: Record<string, Row[]>;
  db?: FakeDbOptions;
}

function tenantSeed(t: {
  tenant: string;
  master: string;
  product: string;
  account: string;
  adAccount: string;
  channels: { id: string; channel: string; pct: number }[];
}): Record<string, Row[]> {
  return {
    prompter_master_campaigns: [
      {
        id: t.master,
        tenant_id: t.tenant,
        status: "DRAFT",
        name: "Promo Akhir Tahun",
        objective: "BRAND_AWARENESS",
        currency: "IDR",
        daily_budget: 100000,
        total_budget: null,
        product_id: t.product,
        target_country: "Indonesia",
        selected_media_id: null,
        channels: t.channels.map((c) => c.channel),
        ai_proposal: { headline: "Diskon Besar", primary_text: "Beli sekarang", cta: "Beli Sekarang" },
      },
    ],
    prompter_channel_campaigns: t.channels.map((c) => ({
      id: c.id,
      tenant_id: t.tenant,
      master_campaign_id: t.master,
      channel: c.channel,
      status: "DRAFT",
      budget_percentage: c.pct,
      external_campaign_id: null,
      error: null,
    })),
    prompter_products: [{ id: t.product, tenant_id: t.tenant, website_url: "https://toko-saya.co.id/produk", hpp: 20000 }],
    prompter_product_media: [
      {
        id: `media-${t.product}`,
        tenant_id: t.tenant,
        product_id: t.product,
        storage_path: `${t.tenant}/${t.product}/1700-foto.jpg`,
        media_type: "IMAGE",
        position: 0,
      },
    ],
    prompter_connected_accounts: [
      {
        id: t.account,
        tenant_id: t.tenant,
        platform: "META",
        status: "CONNECTED",
        external_account_id: t.adAccount,
        selected_page_id: `page_${t.tenant}`,
        last_refreshed_at: "2026-10-01T00:00:00Z",
        expires_at: null,
      },
    ],
    prompter_oauth_credentials: [
      { connected_account_id: t.account, tenant_id: t.tenant, encrypted_access_token: `cipher-${t.tenant}` },
    ],
  };
}

/**
 * Two tenants, each with one DRAFT campaign, a connected Meta ad account and a
 * product with an image. `session` is what requireSessionContext answers: tests
 * switch it with `world.session = ...` to act as another user or tenant.
 */
export function buildOneClickWorld(options: WorldOptions = {}) {
  const seedA = tenantSeed({
    tenant: TENANT_A,
    master: MASTER_A,
    product: "p-a",
    account: "acct-a",
    adAccount: AD_ACCOUNT_A,
    channels: [
      { id: CHANNEL_A1, channel: "FACEBOOK", pct: 60 },
      { id: CHANNEL_A2, channel: "INSTAGRAM", pct: 40 },
    ],
  });
  const seedB = tenantSeed({
    tenant: TENANT_B,
    master: MASTER_B,
    product: "p-b",
    account: "acct-b",
    adAccount: AD_ACCOUNT_B,
    channels: [{ id: CHANNEL_B1, channel: "FACEBOOK", pct: 100 }],
  });

  const seed: Record<string, Row[]> = {};
  for (const source of [seedA, seedB, options.extraRows ?? {}]) {
    for (const [table, rows] of Object.entries(source)) seed[table] = [...(seed[table] ?? []), ...rows];
  }
  for (const table of [
    "prompter_approvals",
    "prompter_audit_logs",
    "prompter_budget_policies",
    "prompter_automation_settings",
    "prompter_marketing_metrics",
    "prompter_conversions",
    "prompter_brand_profiles",
    "prompter_optimization_recommendations",
  ]) {
    seed[table] ??= [];
  }

  const db: FakeDb = createFakeDb(seed, {
    insertDefaults: {
      // Mirrors the column defaults the real tables fill on INSERT.
      prompter_approvals: (n) => ({ id: `ap-${n}`, status: "PENDING", created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString() }),
      prompter_budget_policies: () => ({
        daily_limit: null,
        monthly_limit: null,
        campaign_limit: null,
        require_approval_above: null,
        autopilot_limit: null,
        currency: "IDR",
      }),
    },
    ...options.db,
  });

  const ads = createFakeAdsConnector();
  const fx = makePreflightFixtures();

  type ReserveChain = { eq: (c: string, v: unknown) => ReserveChain; select: (c: string) => PromiseLike<{ data: Row[] | null }> };

  const state = { session: sessionOf(TENANT_A, OWNER_A, "owner") };

  return {
    db,
    ads,
    fx,
    /** What requireSessionContext answers. Tests switch it to act as another user, role or tenant. */
    get session(): SessionShape {
      return state.session;
    },
    set session(next: SessionShape) {
      state.session = next;
    },
    /** The "server" Supabase client. Tenant filtering is done by the production queries, as with PostgREST. */
    client: {
      from: (table: string) => db.from(table),
      // fn_reserve_active_campaign_slot: DRAFT -> AWAITING_APPROVAL, for the CALLER'S tenant only.
      rpc: async (name: string, args: { p_campaign_id: string }) => {
        if (name !== "fn_reserve_active_campaign_slot") throw new Error(`Unexpected rpc: ${name}`);
        const { data } = await (db.from("prompter_master_campaigns") as unknown as { update: (p: Row) => ReserveChain })
          .update({ status: "AWAITING_APPROVAL" })
          .eq("id", args.p_campaign_id)
          .eq("tenant_id", state.session.tenantId)
          .eq("status", "DRAFT")
          .select("id");
        return data && data.length === 1
          ? { data: [{ allowed: true, reason: null }], error: null }
          : { data: [{ allowed: false, reason: "INVALID_STATE" }], error: null };
      },
    },
    /** The service-role client: only credentials and Storage listing are used by the launch. */
    admin: {
      from: (table: string) => db.from(table),
      storage: makeAdminStorage(fx),
    },
  };
}

export type OneClickWorld = ReturnType<typeof buildOneClickWorld>;

// ---------------------------------------------------------------------------
// Small readers used by the assertions
// ---------------------------------------------------------------------------

export const rowOf = (world: OneClickWorld, table: string, id: string): Row | undefined =>
  world.db.tables[table]?.find((r) => r.id === id);

export const channelStatus = (world: OneClickWorld, id: string): unknown => rowOf(world, "prompter_channel_campaigns", id)?.status;

export const auditActions = (world: OneClickWorld): unknown[] => world.db.tables.prompter_audit_logs.map((r) => r.action);

/** Every statement that changed prompter_channel_campaigns (the claim and every later launch write go through it). */
export const channelWrites = (world: OneClickWorld) =>
  world.db.log.filter((s) => s.table === "prompter_channel_campaigns" && s.op !== "select");

/** Env a launch needs (same values the existing launch tests use). Call from beforeEach. */
export function stubLaunchEnv(): void {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.linoe.id");
  vi.stubEnv("META_REDIRECT_URI", "");
}

// ---------------------------------------------------------------------------
// Flow driver: draft -> submit approval -> Owner approve
// ---------------------------------------------------------------------------

/** The real server actions, injected by the test file (so its vi.mock calls apply to them). */
export interface FlowActions {
  submit: (masterId: string) => Promise<{ error: string | null }>;
  decide: (approvalId: string, decision: "APPROVED" | "REJECTED", reason: string | null) => Promise<{ error: string | null }>;
}

export const approvalFor = (world: OneClickWorld, masterId: string): Row | undefined =>
  [...world.db.tables.prompter_approvals].reverse().find((a) => a.resource_id === masterId);

/**
 * Runs the real submitForApprovalAction as `submitter`, then the real
 * decideApprovalAction as `owner`. Leaves `world.session` on the owner.
 * Starts from the seeded DRAFT campaign.
 */
export async function submitThenOwnerApprove(
  world: OneClickWorld,
  actions: FlowActions,
  masterId: string,
  who: { submitter: SessionShape; owner: SessionShape },
) {
  world.session = who.submitter;
  const submitted = await actions.submit(masterId);
  const approval = approvalFor(world, masterId);
  world.session = who.owner;
  const decided = approval ? await actions.decide(String(approval.id), "APPROVED", null) : { error: "approval row was not created" };
  return { submitted, decided, approvalId: approval ? String(approval.id) : null };
}

export const SESSION_A_OWNER = sessionOf(TENANT_A, OWNER_A, "owner");
export const SESSION_A_MARKETING = sessionOf(TENANT_A, MARKETING_A, "marketing");
export const SESSION_B_OWNER = sessionOf(TENANT_B, OWNER_B, "owner");

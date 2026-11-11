import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApprovalHarness } from "../helpers/budget-gate-harness";

/**
 * Defense-in-depth: every service-role read of prompter_oauth_credentials is
 * filtered by tenant_id AND connected_account_id. The fake db below applies
 * .eq() filters for real. The "parent" lookups (connected accounts) are made
 * deliberately LEAKY (they return tenant A's account to a tenant B session) so
 * the only thing standing between tenant B and tenant A's token is the
 * credentials filter itself.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { sessionMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(async () => ({ tenantId: "tenant-B", userId: "uB", role: "owner" })),
}));
vi.mock("@/services/session", () => ({ requireSessionContext: sessionMock }));

const { decryptMock } = vi.hoisted(() => ({
  decryptMock: vi.fn((cipher: string) => `plain(${cipher})`),
}));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: decryptMock }));

const { connector, getPagesMock } = vi.hoisted(() => ({
  connector: {
    isConfigured: vi.fn(() => true),
    disconnect: vi.fn(async () => undefined),
    getInsights: vi.fn(async () => ({ spend: 1, impressions: 1, reach: 1, clicks: 1, raw: {} })),
    pauseCampaign: vi.fn(async () => undefined),
    updateBudget: vi.fn(async () => undefined),
  },
  getPagesMock: vi.fn(async (_token: string) => [{ id: "p1", name: "Page" }]),
}));
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: vi.fn(() => connector) }));
vi.mock("@/lib/connectors/meta-connector", () => ({
  MetaConnector: class {
    getPages(token: string) {
      return getPagesMock(token);
    }
  },
}));
vi.mock("@/services/channel-campaigns", () => ({
  mirrorChannelCampaignStatus: vi.fn(async () => ({ ok: true, updated: 0, consistent: true })),
  transitionMasterCampaign: vi.fn(async () => "moved"),
  checkChannelCampaignState: vi.fn(async () => ({ ok: true, consistent: true })),
  isMirrorConfirmed: vi.fn(() => true),
}));

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /** Tables whose tenant_id filter is ignored on SELECT (leaky parent lookups). */
  leakyParents: new Set<string>(),
  filtersByTable: {} as Record<string, [string, unknown][][]>,
  regular: null as unknown,
  admin: null as unknown,
}));

function fakeClient(opts: { leaky: boolean }) {
  return {
    from(table: string) {
      const rows = () => db.tables[table] ?? (db.tables[table] = []);
      const filters: [string, unknown][] = [];
      (db.filtersByTable[table] ??= []).push(filters);
      const effective = (isSelect: boolean) =>
        filters.filter(([c]) => !(isSelect && opts.leaky && db.leakyParents.has(table) && c === "tenant_id"));
      const matches = (isSelect: boolean) => rows().filter((r) => effective(isSelect).every(([c, v]) => r[c] === v));
      let mode: "select" | "delete" | "update" = "select";
      let patch: Row = {};
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (c: string, v: unknown) => (filters.push([c, v]), builder);
      builder.maybeSingle = async () => ({ data: matches(true)[0] ?? null, error: null });
      builder.single = async () => {
        const row = matches(true)[0] ?? null;
        return { data: row, error: row ? null : { message: "not found" } };
      };
      builder.delete = () => ((mode = "delete"), builder);
      builder.update = (p: Row) => ((mode = "update"), (patch = p), builder);
      builder.insert = async () => ({ error: null });
      builder.upsert = async () => ({ error: null });
      builder.then = (resolve: (v: unknown) => unknown) => {
        const hit = matches(false);
        if (mode === "delete") db.tables[table] = rows().filter((r) => !hit.includes(r));
        if (mode === "update") hit.forEach((r) => Object.assign(r, patch));
        return resolve({ data: null, error: null });
      };
      return builder;
    },
  };
}

let approvalHarness: ReturnType<typeof buildApprovalHarness>;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => (approvalHarness ? { from: approvalHarness.from } : db.regular)),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => (approvalHarness ? { from: approvalHarness.adminFrom } : db.admin)),
}));

import { disconnectAction, listMetaPagesAction } from "@/features/connections/actions";
import { syncChannelCampaignInsightsAction } from "@/features/campaigns/sync-insights-actions";
import { decideApprovalAction } from "@/features/approvals/actions";

const ACCOUNT_A = { id: "acctA", tenant_id: "tenant-A", platform: "META", status: "CONNECTED", external_account_id: "act_A" };

function seed() {
  db.tables = {
    prompter_connected_accounts: [{ ...ACCOUNT_A }],
    prompter_oauth_credentials: [
      { tenant_id: "tenant-A", connected_account_id: "acctA", encrypted_access_token: "cipher-A" },
    ],
    prompter_channel_campaigns: [
      { id: "ccB", tenant_id: "tenant-B", channel: "FACEBOOK", status: "ACTIVE", external_campaign_id: "ext_B", master_campaign_id: "mcB" },
    ],
  };
  db.leakyParents = new Set(["prompter_connected_accounts"]);
  db.filtersByTable = {};
  db.regular = fakeClient({ leaky: true });
  db.admin = fakeClient({ leaky: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ tenantId: "tenant-B", userId: "uB", role: "owner" });
  seed();
  approvalHarness = undefined as unknown as ReturnType<typeof buildApprovalHarness>;
});

const credFilters = () => db.filtersByTable["prompter_oauth_credentials"] ?? [];

describe("tenant B cannot reach tenant A's OAuth credential (leaky parent lookup)", () => {
  it("listMetaPagesAction: no credential, no decrypt, no Meta call", async () => {
    const result = await listMetaPagesAction();
    expect(result.error).toMatch(/Kredensial/);
    expect(decryptMock).not.toHaveBeenCalled();
    expect(getPagesMock).not.toHaveBeenCalled();
    expect(credFilters()[0]).toContainEqual(["tenant_id", "tenant-B"]);
  });

  it("syncChannelCampaignInsightsAction: no credential, no decrypt, no insights call", async () => {
    const result = await syncChannelCampaignInsightsAction("ccB");
    expect(result.error).toMatch(/Kredensial/);
    expect(decryptMock).not.toHaveBeenCalled();
    expect(connector.getInsights).not.toHaveBeenCalled();
    expect(credFilters()[0]).toContainEqual(["tenant_id", "tenant-B"]);
  });

  it("disconnectAction: no revoke with A's token and A's connection row is NOT deleted", async () => {
    const result = await disconnectAction("META");
    expect(result.error).toBeNull();
    expect(decryptMock).not.toHaveBeenCalled();
    expect(connector.disconnect).not.toHaveBeenCalled();
    expect(credFilters()[0]).toContainEqual(["tenant_id", "tenant-B"]);
    expect(db.tables.prompter_connected_accounts).toHaveLength(1);
    expect(db.tables.prompter_oauth_credentials).toHaveLength(1);
  });

  it("decideApprovalAction (autopilot PAUSE_CHANNEL): credential owned by another tenant is not used", async () => {
    sessionMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "owner" });
    approvalHarness = buildApprovalHarness({ actionType: "PAUSE_CHANNEL", suggestedDailyBudget: null, credentialsTenantId: "tenant-A" });
    const result = await decideApprovalAction("ap1", "APPROVED", null);
    expect(approvalHarness.credentialFilters[0]).toContainEqual(["tenant_id", "t1"]);
    expect(approvalHarness.credentialFilters[0]).toContainEqual(["connected_account_id", "acct1"]);
    expect(decryptMock).not.toHaveBeenCalled();
    expect(connector.pauseCampaign).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("cipher");
  });
});

describe("same-tenant behavior is unchanged", () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ tenantId: "tenant-A", userId: "uA", role: "owner" });
    db.tables.prompter_channel_campaigns = [
      { id: "ccA", tenant_id: "tenant-A", channel: "FACEBOOK", status: "ACTIVE", external_campaign_id: "ext_A", master_campaign_id: "mcA" },
    ];
  });

  it("listMetaPagesAction reads own credential", async () => {
    const result = await listMetaPagesAction();
    expect(result.error).toBeNull();
    expect(getPagesMock).toHaveBeenCalledWith("plain(cipher-A)");
  });

  it("syncChannelCampaignInsightsAction uses own credential", async () => {
    await syncChannelCampaignInsightsAction("ccA");
    expect(connector.getInsights).toHaveBeenCalledWith("plain(cipher-A)", "act_A", "ext_A");
  });

  it("disconnectAction revokes with own token and deletes own connection only", async () => {
    db.tables.prompter_connected_accounts.push({ ...ACCOUNT_A, id: "acctB", tenant_id: "tenant-B", external_account_id: "act_B" });
    const result = await disconnectAction("META");
    expect(result.error).toBeNull();
    expect(connector.disconnect).toHaveBeenCalledWith("plain(cipher-A)", "act_A");
    expect(db.tables.prompter_connected_accounts.map((r) => r.id)).toEqual(["acctB"]);
  });

  it("decideApprovalAction PAUSE_CHANNEL uses own credential", async () => {
    sessionMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "owner" });
    approvalHarness = buildApprovalHarness({ actionType: "PAUSE_CHANNEL", suggestedDailyBudget: null });
    const result = await decideApprovalAction("ap1", "APPROVED", null);
    expect(result.error).toBeNull();
    expect(connector.pauseCampaign).toHaveBeenCalledTimes(1);
  });
});

/**
 * Legacy / inconsistent data: the tenant's OWN, CONNECTED account exists, but
 * its credential row carries another tenant_id (or none). The tenant filter
 * then finds no credential. The required behavior is fail-safe: a "reconnect"
 * message, no decrypt, no platform call, and NO change to the connection or
 * the credential rows (a legitimate customer is never silently disconnected).
 */
describe("legacy credential row (tenant_id differs or is NULL): fail-safe, no data loss", () => {
  const OWN = { id: "acctB", tenant_id: "tenant-B", platform: "META", status: "CONNECTED", external_account_id: "act_B" };

  function seedLegacy(credentialTenant: string | null) {
    db.tables = {
      prompter_connected_accounts: [{ ...ACCOUNT_A }, { ...OWN }],
      prompter_oauth_credentials: [
        { tenant_id: "tenant-A", connected_account_id: "acctA", encrypted_access_token: "cipher-A" },
        { tenant_id: credentialTenant, connected_account_id: "acctB", encrypted_access_token: "cipher-B-legacy" },
      ],
      prompter_channel_campaigns: [
        { id: "ccB", tenant_id: "tenant-B", channel: "FACEBOOK", status: "ACTIVE", external_campaign_id: "ext_B", master_campaign_id: "mcB" },
      ],
    };
    // Parent lookups are tenant-correct here (not leaky): this is about the credential row only.
    db.leakyParents = new Set();
    db.filtersByTable = {};
    db.regular = fakeClient({ leaky: false });
    db.admin = fakeClient({ leaky: false });
  }

  const snapshot = () => JSON.stringify([db.tables.prompter_connected_accounts, db.tables.prompter_oauth_credentials]);

  it.each([
    ["another tenant", "tenant-LEGACY"],
    ["NULL", null],
  ])("listMetaPagesAction (%s): asks to reconnect, calls nothing, changes nothing", async (_label, credTenant) => {
    seedLegacy(credTenant);
    const before = snapshot();
    const result = await listMetaPagesAction();
    expect(result.error).toMatch(/hubungkan ulang/i);
    expect(decryptMock).not.toHaveBeenCalled();
    expect(getPagesMock).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(/cipher/);
  });

  it.each([
    ["another tenant", "tenant-LEGACY"],
    ["NULL", null],
  ])("syncChannelCampaignInsightsAction (%s): asks to reconnect, no platform call, rows intact", async (_label, credTenant) => {
    seedLegacy(credTenant);
    const before = snapshot();
    const result = await syncChannelCampaignInsightsAction("ccB");
    expect(result.error).toMatch(/hubungkan ulang/i);
    expect(decryptMock).not.toHaveBeenCalled();
    expect(connector.getInsights).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(/cipher/);
  });

  it("decideApprovalAction (autopilot): reconnect note, no platform write, no connection change", async () => {
    sessionMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "owner" });
    approvalHarness = buildApprovalHarness({ actionType: "PAUSE_CHANNEL", suggestedDailyBudget: null, credentialsTenantId: "legacy-tenant" });
    await decideApprovalAction("ap1", "APPROVED", null);
    expect(decryptMock).not.toHaveBeenCalled();
    expect(connector.pauseCampaign).not.toHaveBeenCalled();
    const note = approvalHarness.approvalUpdates.find((u) => "reason" in u && u.reason);
    expect(String(note?.reason)).toMatch(/hubungkan ulang/i);
    expect(JSON.stringify(approvalHarness.approvalUpdates)).not.toMatch(/cipher/);
  });

  it("disconnectAction on an explicit Owner request: no revoke with the unmatched credential, removes ONLY the caller's own connection", async () => {
    seedLegacy("tenant-LEGACY");
    const result = await disconnectAction("META");
    expect(result.error).toBeNull();
    expect(decryptMock).not.toHaveBeenCalled();
    expect(connector.disconnect).not.toHaveBeenCalled();
    // Tenant A's connection and credential are untouched.
    expect(db.tables.prompter_connected_accounts.map((r) => r.id)).toEqual(["acctA"]);
    expect(db.tables.prompter_oauth_credentials.some((r) => r.connected_account_id === "acctA")).toBe(true);
  });

  it("disconnectAction delete is scoped by tenant_id as well as id", async () => {
    seedLegacy("tenant-B");
    await disconnectAction("META");
    expect(connector.disconnect).toHaveBeenCalledWith("plain(cipher-B-legacy)", "act_B");
    const deleteFilters = (db.filtersByTable["prompter_connected_accounts"] ?? []).find(
      (f) => f.some(([c, v]) => c === "id" && v === "acctB") && f.some(([c]) => c === "tenant_id"),
    );
    expect(deleteFilters).toContainEqual(["tenant_id", "tenant-B"]);
  });
});

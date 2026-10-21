import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * PR-A — prompter_oauth_credentials is read through the admin (service-role) client, which bypasses RLS.
 * Isolation therefore depends on the query itself: every read must carry an explicit
 * `.eq("tenant_id", <trusted tenant>)` next to `.eq("connected_account_id", ...)`.
 *
 * Part 1 (behavioural): syncChannelCampaignInsightsAction against a fake table that applies the filters it receives.
 * Part 2 (structural): all five reads under features/ carry the tenant filter, and no new unfiltered read can appear.
 * No token or secret value is used anywhere here: the only strings are inert placeholders.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireSessionContextMock } = vi.hoisted(() => ({
  requireSessionContextMock: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("@/services/session", () => ({ requireSessionContext: requireSessionContextMock }));

const { decryptTokenMock } = vi.hoisted(() => ({ decryptTokenMock: vi.fn(() => "placeholder-plaintext") }));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: decryptTokenMock }));

const { getInsightsMock } = vi.hoisted(() => ({
  getInsightsMock: vi.fn(async () => ({ spend: 1, impressions: 2, reach: 3, clicks: 4, raw: {} })),
}));
vi.mock("@/lib/connectors/get-connector", () => ({
  getConnector: () => ({ isConfigured: () => true, getInsights: getInsightsMock }),
}));

interface CredRow {
  connected_account_id: string;
  tenant_id: string;
  encrypted_access_token: string;
}

let credRow: CredRow | null;
const credFilters: Record<string, unknown> = {};

function credentialsTable() {
  const maybeSingle = async () => {
    const ok = credRow !== null && Object.entries(credFilters).every(([c, v]) => (credRow as unknown as Record<string, unknown>)[c] === v);
    return { data: ok ? { encrypted_access_token: credRow!.encrypted_access_token } : null, error: null };
  };
  const chain = (col: string, val: unknown) => {
    credFilters[col] = val;
    return { eq: chain, maybeSingle };
  };
  return { select: () => ({ eq: chain }) };
}

function regularTable(table: string) {
  if (table === "prompter_channel_campaigns") {
    const row = { id: "cc1", channel: "META_ADS", status: "ACTIVE", master_campaign_id: "m1", external_campaign_id: "ext1" };
    const q = { eq: () => q, single: async () => ({ data: row, error: null }) };
    return { select: () => q };
  }
  if (table === "prompter_connected_accounts") {
    const q = { eq: () => q, maybeSingle: async () => ({ data: { id: "acct_1", external_account_id: "ext_acct", status: "CONNECTED" }, error: null }) };
    return { select: () => q };
  }
  if (table === "prompter_marketing_metrics") return { upsert: async () => ({ error: null }) };
  if (table === "prompter_audit_logs") return { insert: async () => ({ error: null }) };
  throw new Error(`Unexpected table on regular client: ${table}`);
}

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: regularTable })) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "prompter_oauth_credentials") return credentialsTable();
      throw new Error(`Unexpected table on admin client: ${table}`);
    },
  })),
}));
vi.mock("@/lib/connectors/channel-map", () => ({ CHANNEL_TO_CONNECTOR: { META_ADS: "META" } }));

import { syncChannelCampaignInsightsAction } from "@/features/campaigns/sync-insights-actions";

describe("syncChannelCampaignInsightsAction — credential read is tenant-scoped", () => {
  beforeEach(() => {
    for (const k of Object.keys(credFilters)) delete credFilters[k];
    credRow = { connected_account_id: "acct_1", tenant_id: "t1", encrypted_access_token: "placeholder-cipher" };
    requireSessionContextMock.mockReset();
    requireSessionContextMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "owner" });
    decryptTokenMock.mockClear();
    getInsightsMock.mockClear();
  });

  it("correct tenant: succeeds, filters on connected_account_id AND tenant_id", async () => {
    const result = await syncChannelCampaignInsightsAction("cc1");

    expect(result.error).toBeNull();
    expect(credFilters).toEqual({ connected_account_id: "acct_1", tenant_id: "t1" });
    expect(decryptTokenMock).toHaveBeenCalledTimes(1);
    expect(getInsightsMock).toHaveBeenCalledTimes(1);
  });

  it("different tenant: the other tenant's credential row is not returned, decrypted or used", async () => {
    credRow = { connected_account_id: "acct_1", tenant_id: "t2", encrypted_access_token: "placeholder-other" };

    const result = await syncChannelCampaignInsightsAction("cc1");

    expect(result.error).toMatch(/Kredensial koneksi tidak ditemukan/);
    expect(decryptTokenMock).not.toHaveBeenCalled();
    expect(getInsightsMock).not.toHaveBeenCalled();
  });

  it("invalid/empty tenant in the session: fails closed", async () => {
    requireSessionContextMock.mockResolvedValue({ tenantId: "", userId: "u1", role: "owner" });

    const result = await syncChannelCampaignInsightsAction("cc1");

    expect(result.error).toMatch(/Kredensial koneksi tidak ditemukan/);
    expect(decryptTokenMock).not.toHaveBeenCalled();
    expect(getInsightsMock).not.toHaveBeenCalled();
  });
});

describe("prompter_oauth_credentials admin reads — structural guard", () => {
  const root = path.resolve(__dirname, "../../..");

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  // Every production read of the table (not the OAuth callback's tenant-scoped upsert, which writes).
  const files = ["features", "app", "lib", "services"].flatMap((d) => walk(path.join(root, d)));
  const reads: { file: string; block: string }[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf-8");
    let i = src.indexOf('.from("prompter_oauth_credentials")');
    while (i !== -1) {
      const block = src.slice(i, i + 260);
      if (/\.select\(/.test(block.split(".maybeSingle")[0] ?? block)) {
        reads.push({ file: path.relative(root, file), block });
      }
      i = src.indexOf('.from("prompter_oauth_credentials")', i + 1);
    }
  }

  it("finds exactly the five known credential reads", () => {
    expect(reads.map((r) => r.file).sort()).toEqual([
      "features/approvals/actions.ts",
      "features/campaigns/launch-actions.ts",
      "features/campaigns/sync-insights-actions.ts",
      "features/connections/actions.ts",
      "features/connections/actions.ts",
    ]);
  });

  it("every read pins connected_account_id AND a tenant id taken from the server session / validated row", () => {
    for (const { file, block } of reads) {
      const head = block.split(".maybeSingle")[0] ?? block;
      expect(head, file).toMatch(/\.eq\("connected_account_id", [A-Za-z.]+\)/);
      expect(head, file).toMatch(/\.eq\("tenant_id", (session\.tenantId|tenantId)\)/);
    }
  });

  it("never takes the tenant from request input (formData / searchParams / body)", () => {
    for (const { file, block } of reads) {
      expect(block, file).not.toMatch(/formData|searchParams|request\.|body\./);
    }
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Architecture guard for Phase F-2b (ad-account selection). Source-level, same
 * style as meta-readiness-readonly.test.ts: it fails if someone later lets the
 * selection path write anything beyond the stored account choice and its audit
 * row, touch the Budget Gate or campaign creation, or leak sensitive data.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const WRITE = /\.(insert|update|upsert|delete|rpc)\(/;

const PURE_AND_UI = [
  "features/connections/meta-ad-account-selection-core.ts",
  "features/connections/meta-ad-account-list.tsx",
  "features/connections/meta-ad-account-picker.tsx",
  "features/connections/meta-ad-account-section.tsx",
];

function between(text: string, start: string, end?: string): string {
  const from = text.indexOf(start);
  expect(from, `${start} must exist`).toBeGreaterThan(-1);
  const to = end ? text.indexOf(end, from + start.length) : text.length;
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe("ad-account selection: no writes outside the two allowed ones", () => {
  for (const file of PURE_AND_UI) {
    it(`${file} performs no database write`, () => {
      expect(WRITE.test(read(file))).toBe(false);
    });
  }

  it("MetaConnector#listAdAccounts is a single read-only GET", () => {
    const source = read("lib/connectors/meta-connector.ts");
    const method = between(source, "async listAdAccounts(", "async createCampaign(");
    expect(method).not.toMatch(/method:\s*["'](POST|DELETE|PUT|PATCH)["']/);
    expect(method).not.toContain("funding_source_details");
    expect(method.match(/graphFetch</g)).toHaveLength(1);
  });

  it("the selection wiring writes exactly one connection update and one audit insert", () => {
    const actions = read("features/connections/actions.ts");
    const wiring = between(actions, "function buildAdAccountSelectionDeps(", "export async function listMetaAdAccountsAction");
    expect(wiring.match(/\.update\(/g)).toHaveLength(1);
    expect(wiring.match(/\.insert\(/g)).toHaveLength(1);
    expect(wiring).not.toMatch(/\.(upsert|delete|rpc)\(/);

    const update = between(wiring, ".update(", ".select(\"id\")");
    expect(update).toContain('.eq("external_account_id", input.previousAdAccountId)');
    expect(update).toContain("external_account_id: input.adAccountId");
    expect(update).toContain("external_account_name: input.adAccountName");
    // Bound to the tenant, the platform, the CONNECTED state and the exact connect timestamp.
    expect(update).toContain('.eq("tenant_id", input.tenantId)');
    expect(update).toContain('.eq("platform", "META")');
    expect(update).toContain('.eq("status", "CONNECTED")');
    expect(update).toContain('.eq("last_refreshed_at", input.expectedLastRefreshedAt)');
    expect(update).not.toMatch(/status:|scopes:|expires_at:|connected_by:|selected_page/);
  });

  it("the audit insert records the choice for this tenant and connection and nothing sensitive", () => {
    const actions = read("features/connections/actions.ts");
    const wiring = between(actions, "function buildAdAccountSelectionDeps(", "export async function listMetaAdAccountsAction");
    const insert = between(wiring, 'admin.from("prompter_audit_logs").insert(', "// 2) Compare-and-set");
    expect(insert).toContain("connected_at: input.expectedLastRefreshedAt");
    expect(insert).toContain("tenant_id: input.tenantId");
    expect(insert).toContain("action: AD_ACCOUNT_SELECTED_ACTION");
    expect(insert).toContain("resource_id: input.connectionId");
    expect(insert).not.toMatch(/token|funding|secret|encrypted/i);
  });

  it("records the confirmation BEFORE changing the account (a failed confirmation can never leave a changed, unconfirmed account)", () => {
    const actions = read("features/connections/actions.ts");
    const wiring = between(actions, "async persistSelection(input)", "now: () => new Date()");
    expect(wiring.indexOf(".insert(")).toBeGreaterThan(-1);
    expect(wiring.indexOf(".update(")).toBeGreaterThan(wiring.indexOf(".insert("));
  });

  it("the actions take no tenant or role from the client", () => {
    const actions = read("features/connections/actions.ts");
    expect(actions).toMatch(/export async function listMetaAdAccountsAction\(\)/);
    expect(actions).toMatch(/export async function selectMetaAdAccountAction\(adAccountId: string\)/);
  });
});

describe("ad-account selection: never touches ads, budgets or the Budget Gate", () => {
  it("has no reference to the gate, flags, billing or campaign/budget methods", () => {
    const actions = read("features/connections/actions.ts");
    const f2b = actions.slice(actions.indexOf("const PRE_LAUNCH_STATUSES"));
    for (const text of [...PURE_AND_UI.map(read), f2b]) {
      expect(text).not.toContain("external-budget-guard");
      expect(text).not.toContain("BUDGET_WRITE_ENABLED_PLATFORMS");
      expect(text).not.toMatch(/isFeatureEnabled|midtrans|subscription/i);
      expect(text).not.toMatch(/\.(createCampaign|createAdSet|createCreative|createAd|updateBudget|pauseCampaign)\(/);
    }
  });

  it("does not modify the OAuth callback or the Budget Gate source (reconnect behaviour is unchanged)", () => {
    // The reconnect-staleness protection lives in the confirmation marker, not in the callback.
    const callback = read("lib/connectors/oauth-callback.ts");
    expect(callback).not.toContain("meta_ad_account_selected");
  });
});

describe("ad-account selection: sensitive data and client boundary", () => {
  it("logs only through the allowlisted summary", () => {
    const actions = read("features/connections/actions.ts");
    const wiring = actions.slice(actions.indexOf("function buildAdAccountSelectionDeps("));
    expect(wiring).toContain("describeSafeError");
    expect(wiring).not.toMatch(/console\.(log|error|warn)\([^)]*(accessToken|token|\.message|encrypted)/);
    expect(read("features/connections/meta-ad-account-selection-core.ts")).not.toMatch(/console\./);
  });

  it("client components import no server-only module directly", () => {
    for (const file of ["features/connections/meta-ad-account-picker.tsx", "features/connections/meta-ad-account-section.tsx"]) {
      const text = read(file);
      expect(text).not.toContain("server-only");
      expect(text).not.toContain("@/lib/supabase");
      expect(text).not.toContain("token-cipher");
      expect(text).not.toContain("meta-connector");
    }
  });

  it("the connector never returns or logs a funding source id", () => {
    const source = read("lib/connectors/meta-connector.ts");
    const toSnapshot = between(source, "function toSnapshot(", "/** optimization_goal");
    expect(toSnapshot).toContain("hasFundingSource: typeof row.funding_source === \"string\"");
    expect(toSnapshot).not.toMatch(/funding_source:\s*row/);
  });
});

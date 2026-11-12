import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getMonthlyAiJobCount, getVerifiedAttributedValueThisMonth, listInvoices } from "@/services/billing";
import { recordSingleTouchAttribution } from "@/services/attribution";

/**
 * Tenant isolation at CODE / UNIT level: does the service layer itself filter by tenant_id, on top of RLS?
 * This says nothing about RLS or any real database (UNKNOWN without a dated read-only check). It only protects
 * against the service layer quietly becoming the weak link when a client that bypasses RLS (service role) is used.
 * `it.fails` marks a KNOWN GAP: it passes while the gap exists and turns red when the gap is fixed.
 */

const TENANT = "22222222-2222-4222-8222-222222222222";
const CONVERSION = "33333333-3333-4333-8333-333333333333";

interface Call {
  chain: number;
  table: string;
  method: string;
  args: unknown[];
}

/** Records every builder call (per chain) and resolves any awaited chain to `result`. */
function recordingClient(result: unknown) {
  const calls: Call[] = [];
  let chainCounter = 0;
  const client = {
    from: (table: string) => {
      const chain = ++chainCounter;
      const proxy: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") return (resolve: (value: unknown) => unknown) => resolve(result);
            return (...args: unknown[]) => {
              calls.push({ chain, table, method: String(prop), args });
              return proxy;
            };
          },
        },
      );
      return proxy;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

const filtersTenant = (calls: Call[], table: string) =>
  calls.some((c) => c.table === table && c.method === "eq" && c.args[0] === "tenant_id" && c.args[1] === TENANT);

describe("billing reads are scoped to the tenant (CODE/UNIT)", () => {
  it("getMonthlyAiJobCount filters prompter_ai_jobs by tenant_id", async () => {
    const { client, calls } = recordingClient({ count: 3, error: null });
    expect(await getMonthlyAiJobCount(client, TENANT)).toBe(3);
    expect(filtersTenant(calls, "prompter_ai_jobs")).toBe(true);
  });

  it("getVerifiedAttributedValueThisMonth filters prompter_attributions by tenant_id and only counts UMKMPRO_VERIFIED", async () => {
    const { client, calls } = recordingClient({ data: [{ attributed_value: 10 }, { attributed_value: 5 }], error: null });
    expect(await getVerifiedAttributedValueThisMonth(client, TENANT)).toBe(15);
    expect(filtersTenant(calls, "prompter_attributions")).toBe(true);
    expect(calls).toContainEqual(expect.objectContaining({ method: "eq", args: ["attribution_model", "UMKMPRO_VERIFIED"] }));
  });

  it("listInvoices filters prompter_invoices by tenant_id", async () => {
    const { client, calls } = recordingClient({ data: [], error: null });
    expect(await listInvoices(client, TENANT)).toEqual([]);
    expect(filtersTenant(calls, "prompter_invoices")).toBe(true);
  });
});

describe("recordSingleTouchAttribution (runs on the service-role client for UMKMpro webhooks)", () => {
  const input = {
    tenantId: TENANT,
    conversionId: CONVERSION,
    masterCampaignId: "44444444-4444-4444-8444-444444444444",
    channelCampaignId: null,
    value: 100,
    model: "UMKMPRO_VERIFIED" as const,
  };

  it("inserts the attribution row with the tenant_id", async () => {
    const { client, calls } = recordingClient({ data: null, error: null });
    await recordSingleTouchAttribution(client, input);
    const insert = calls.find((c) => c.method === "insert");
    expect(insert?.table).toBe("prompter_attributions");
    expect(insert?.args[0]).toMatchObject({ tenant_id: TENANT, conversion_id: CONVERSION });
  });

  it("does nothing when no campaign is known (never guesses)", async () => {
    const { client, calls } = recordingClient({ data: null, error: null });
    await recordSingleTouchAttribution(client, { ...input, masterCampaignId: null, channelCampaignId: null });
    expect(calls).toHaveLength(0);
  });

  it.fails("KNOWN GAP: the delete-before-insert is also scoped by tenant_id, not only by conversion_id", async () => {
    // services/attribution.ts deletes by conversion_id alone. With the service role (RLS bypassed) the only thing
    // keeping this inside one tenant is that the id came from the same tenant's upsert a moment earlier.
    // Defence in depth: add .eq("tenant_id", tenantId). Needs a change outside this task's files.
    const { client, calls } = recordingClient({ data: null, error: null });
    await recordSingleTouchAttribution(client, input);
    const del = calls.find((c) => c.method === "delete");
    expect(del).toBeDefined();
    const sameChain = calls.filter((c) => c.chain === del!.chain);
    expect(sameChain).toContainEqual(expect.objectContaining({ method: "eq", args: ["tenant_id", TENANT] }));
  });
});

describe("services/*.ts: every query is tenant-scoped or explicitly reviewed (CODE, static heuristic)", () => {
  const dir = path.resolve(__dirname, "../../../services");

  /** `<file>|<table>|<operations>` -> why no tenant_id filter is needed (or why it is a known gap). */
  const REVIEWED: Record<string, string> = {
    "admin-audit.ts|finance_audit_logs|insert": "platform audit log, not tenant data",
    "ai-jobs.ts|prompter_ai_jobs|update": "by job id on the tenant's own RLS client; id came from the entitlement RPC",
    "channel-campaigns.ts|prompter_channel_campaigns|upsert": "rows are built with tenant_id just above the chain",
    "checkout.ts|prompter_payment_transactions|update": "service role, by transaction id returned by the checkout RPC, PENDING only",
    "payment-alerts.ts|prompter_payment_alerts|select": "platform operator view",
    "payment-alerts.ts|prompter_payment_alert_sync_state|select": "platform operator view",
    "payment-alerts.ts|prompter_payment_alert_notify_state|select": "platform operator view",
    "payment-alerts.ts|prompter_payment_alert_notification_batches|select": "platform operator view",
    "payment-health.ts|prompter_webhook_events|select": "platform health, aggregated across tenants",
    "payment-health.ts|prompter_payment_transactions|select": "platform health, aggregated across tenants",
    "payment-recheck.ts|prompter_payment_transactions|select": "operator recheck by transaction id / PENDING list",
    "payment-sweeper.ts|prompter_payment_transactions|select": "cross-tenant sweeper of PENDING transactions",
    "payment-verification.ts|prompter_payment_transactions|select": "service role, by transaction id; tenant read from the row",
    "payment-verification.ts|prompter_payment_transactions|update": "service role, by transaction id, PENDING only",
    "payment-webhook.ts|prompter_webhook_events|insert+select": "webhook receipt log, tenant unknown at receipt time",
    "payment-webhook.ts|prompter_webhook_events|select": "webhook receipt log, keyed by provider event id",
    "payment-webhook.ts|prompter_webhook_events|update": "webhook receipt log, keyed by row id",
    "platform-admin.ts|finance_platform_admins|select": "by the signed-in user's own id",
    "session.ts|user_profiles|select": "by the signed-in user's own id (this is where tenant_id comes from)",
    "session.ts|tenants|select": "by the tenant id of the signed-in user's own profile",
    "umkmpro.ts|tenants|select": "existence check of the tenant id in a signed webhook",
    "umkmpro.ts|prompter_webhook_events|select": "idempotency lookup by provider event id",
    "attribution.ts|prompter_attributions|delete": "KNOWN GAP: delete by conversion_id only (see the it.fails above)",
  };

  const found = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts")).sort()) {
    const text = readFileSync(path.join(dir, file), "utf-8");
    const re = /\.from\(\s*"([a-z_]+)"\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const rest = text.slice(match.index);
      const end = rest.indexOf(";");
      const chain = end < 0 ? rest : rest.slice(0, end);
      const ops = [...new Set([...chain.matchAll(/\.(select|insert|update|upsert|delete)\(/g)].map((m) => m[1]))];
      const writes = ops.some((op) => op === "insert" || op === "upsert");
      const scoped = writes ? /tenant_id/.test(chain) : /\.eq\(\s*"tenant_id"/.test(chain);
      if (!scoped) found.add(`${file}|${match[1]}|${ops.join("+")}`);
    }
  }

  it("no new query in services/ lacks a tenant_id filter without being reviewed here", () => {
    const unreviewed = [...found].filter((key) => !(key in REVIEWED)).sort();
    expect(unreviewed).toEqual([]);
  });

  it("the reviewed list has no stale entries (remove an entry when its query gets scoped)", () => {
    const stale = Object.keys(REVIEWED).filter((key) => !found.has(key)).sort();
    expect(stale).toEqual([]);
  });
});

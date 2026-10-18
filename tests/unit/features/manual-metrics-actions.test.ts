import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  current: { tenantId: "tenant-A", userId: "user-1", role: "owner" } as {
    tenantId: string;
    userId: string;
    role: string;
  },
}));

vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => session.current),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => currentClient),
}));

import {
  addManualMetricAction,
  deleteManualMetricAction,
  updateManualMetricAction,
} from "@/features/campaigns/manual-metrics-actions";

type Result = { data: unknown; error: { code?: string; message?: string } | null };
interface Call {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentClient: any;
let calls: Call[] = [];

/** A recording fake of the PostgREST builder. `resolve` decides what each terminal call returns. */
function makeClient(resolve: (c: Call) => Result) {
  return {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (p: Record<string, unknown>) => {
          call.op = "insert";
          call.payload = p;
          return builder;
        },
        update: (p: Record<string, unknown>) => {
          call.op = "update";
          call.payload = p;
          return builder;
        },
        delete: () => {
          call.op = "delete";
          return builder;
        },
        eq: (c: string, v: unknown) => {
          call.filters.push([c, v]);
          return builder;
        },
        order: () => builder,
        maybeSingle: () => Promise.resolve(done()),
        single: () => Promise.resolve(done()),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(done()).then(res, rej),
      };
      const done = () => {
        calls.push({ ...call, filters: [...call.filters] });
        return resolve(call);
      };
      return builder;
    },
  };
}

/** The tenant that owns every row in the fake world. */
const OWNER_TENANT = "tenant-A";
const ok = (data: unknown): Result => ({ data, error: null });
const CC_ID = "8f1c3a52-6a3e-4b8e-9a3b-2f7d6f6f2c11";
const ROW_ID = "11111111-2222-3333-4444-555555555555";
const MASTER_ID = "99999999-aaaa-bbbb-cccc-dddddddddddd";

const channelCampaign = { id: CC_ID, channel: "FACEBOOK", master_campaign_id: MASTER_ID, external_campaign_id: null };
const existingRow = {
  id: ROW_ID,
  tenant_id: "tenant-A",
  master_campaign_id: MASTER_ID,
  channel_campaign_id: CC_ID,
  channel: "FACEBOOK",
  metric_date: "2026-10-10",
  spend: 100000,
  impressions: 5000,
  clicks: 100,
  conversions: 5,
  revenue: 200000,
  currency: "IDR",
};

interface World {
  channelCampaign: typeof channelCampaign | null;
  master: { id: string; currency: string } | null;
  existing: unknown;
  row: typeof existingRow | null;
  auditError?: { code?: string; message?: string } | null;
  insertError?: { code?: string; message?: string } | null;
  updateRows?: unknown[];
  deleteRows?: unknown[];
  readError?: { code?: string; message?: string } | null;
}

function defaultWorld(over: Partial<World> = {}): World {
  return { channelCampaign, master: { id: MASTER_ID, currency: "IDR" }, existing: null, row: existingRow, ...over };
}

function installWorld(w: World) {
  currentClient = makeClient((c) => {
    switch (c.table) {
      case "prompter_channel_campaigns": {
        // tenant scoping is part of the contract: a lookup without the tenant filter finds nothing here
        const scoped = c.filters.some(([k, v]) => k === "tenant_id" && v === OWNER_TENANT);
        return ok(scoped ? w.channelCampaign : null);
      }
      case "prompter_master_campaigns": {
        const scoped = c.filters.some(([k, v]) => k === "tenant_id" && v === OWNER_TENANT);
        return ok(scoped ? w.master : null);
      }
      case "prompter_manual_ad_metrics":
        if (c.op === "select") {
          if (w.readError) return { data: null, error: w.readError };
          const scoped = c.filters.some(([k, v]) => k === "tenant_id" && v === OWNER_TENANT);
          // "existing" is the duplicate-date probe, "row" is a lookup by id
          return ok(c.filters.some(([k]) => k === "id") ? (scoped ? w.row : null) : w.existing);
        }
        if (c.op === "insert") return { data: null, error: w.insertError ?? null };
        if (c.op === "update") return ok(w.updateRows ?? [{ id: ROW_ID }]);
        return ok(w.deleteRows ?? [{ id: ROW_ID }]);
      case "prompter_audit_logs":
        return { data: null, error: w.auditError ?? null };
      default:
        throw new Error(`unexpected table ${c.table}`);
    }
  });
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const addFields = {
  channelCampaignId: CC_ID,
  metricDate: new Date().toISOString().slice(0, 10),
  spend: "150000",
  impressions: "12500",
  clicks: "240",
  conversions: "12",
  revenue: "480000",
};
const editFields = { id: ROW_ID, spend: "120000", impressions: "6000", clicks: "120", conversions: "6", revenue: "240000" };
const prev = { error: null, success: null };

const tablesTouched = () => [...new Set(calls.map((c) => c.table))].sort();
const idx = (table: string, op: Call["op"]) => calls.findIndex((c) => c.table === table && c.op === op);

beforeEach(() => {
  calls = [];
  session.current = { tenantId: "tenant-A", userId: "user-1", role: "owner" };
  installWorld(defaultWorld());
});

describe("addManualMetricAction", () => {
  it("saves a valid entry: audit is written BEFORE the row, values come from the server, never the client", async () => {
    const r = await addManualMetricAction(
      prev,
      form({ ...addFields, currency: "USD", tenantId: "tenant-B", channel: "TIKTOK", enteredBy: "attacker" }),
    );
    expect(r).toEqual({ error: null, success: "Data tersimpan." });

    const audit = idx("prompter_audit_logs", "insert");
    const insert = idx("prompter_manual_ad_metrics", "insert");
    expect(audit).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(audit);

    const payload = calls[insert].payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      tenant_id: "tenant-A",
      master_campaign_id: MASTER_ID,
      channel_campaign_id: CC_ID,
      channel: "FACEBOOK",
      currency: "IDR",
      entered_by: "user-1",
      spend: 150000,
      impressions: 12500,
      clicks: 240,
      conversions: 12,
      revenue: 480000,
    });

    const auditPayload = calls[audit].payload as Record<string, unknown>;
    expect(auditPayload).toMatchObject({ tenant_id: "tenant-A", actor_user_id: "user-1", action: "manual_metrics.create" });
    expect(auditPayload.resource_id).toBe(payload.id);
    expect(auditPayload.context).toMatchObject({ source: "manual", verified_by_platform: false });
  });

  it("only ever touches the four allowed tables — never connector metrics, approvals, or campaign status", async () => {
    await addManualMetricAction(prev, form(addFields));
    expect(tablesTouched()).toEqual([
      "prompter_audit_logs",
      "prompter_channel_campaigns",
      "prompter_manual_ad_metrics",
      "prompter_master_campaigns",
    ]);
    expect(calls.filter((c) => c.table === "prompter_channel_campaigns").every((c) => c.op === "select")).toBe(true);
    expect(calls.filter((c) => c.table === "prompter_master_campaigns").every((c) => c.op === "select")).toBe(true);
  });

  it.each(["viewer", "finance", "support", "member", ""])("role %s is refused before any database access", async (role) => {
    session.current = { ...session.current, role };
    const r = await addManualMetricAction(prev, form(addFields));
    expect(r.error).toMatch(/tidak memiliki izin/);
    expect(calls).toHaveLength(0);
  });

  it("marketing is allowed", async () => {
    session.current = { ...session.current, role: "marketing" };
    expect((await addManualMetricAction(prev, form(addFields))).error).toBeNull();
  });

  it("invalid input is rejected before any database access", async () => {
    for (const patch of [{ spend: "-1" }, { spend: "150.000" }, { clicks: "99999", impressions: "10" }, { metricDate: "2999-01-01" }, { channelCampaignId: "x" }]) {
      const r = await addManualMetricAction(prev, form({ ...addFields, ...patch }));
      expect(r.error).not.toBeNull();
    }
    expect(calls).toHaveLength(0);
  });

  it("a channel campaign of ANOTHER tenant is indistinguishable from missing: no insert, no audit", async () => {
    session.current = { ...session.current, tenantId: "tenant-B" }; // the world belongs to tenant-A
    const r = await addManualMetricAction(prev, form(addFields));
    expect(r.error).toBe("Channel campaign tidak ditemukan.");
    expect(calls.some((c) => c.op === "insert")).toBe(false);
    expect(calls.every((c) => c.filters.some(([k, v]) => k === "tenant_id" && v === "tenant-B"))).toBe(true);
  });

  it("rejects a channel campaign that already has an external_campaign_id (platform is the source of truth)", async () => {
    installWorld(defaultWorld({ channelCampaign: { ...channelCampaign, external_campaign_id: "ext-1" } }));
    const r = await addManualMetricAction(prev, form(addFields));
    expect(r.error).toMatch(/sudah terhubung ke campaign di platform/);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("rejects SEO channels", async () => {
    installWorld(defaultWorld({ channelCampaign: { ...channelCampaign, channel: "SEO" } }));
    const r = await addManualMetricAction(prev, form(addFields));
    expect(r.error).toMatch(/bukan SEO/);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("works for a non-ACTIVE (DRAFT) campaign and never reads or writes status", async () => {
    // channelCampaign has no status column at all in the select list: the action must not need it.
    const r = await addManualMetricAction(prev, form(addFields));
    expect(r.error).toBeNull();
    const select = calls.find((c) => c.table === "prompter_channel_campaigns");
    expect(select?.op).toBe("select");
  });

  it("a duplicate date is rejected up front, with no audit entry", async () => {
    installWorld(defaultWorld({ existing: { id: "other" } }));
    const r = await addManualMetricAction(prev, form(addFields));
    expect(r.error).toMatch(/sudah ada/);
    expect(calls.some((c) => c.table === "prompter_audit_logs")).toBe(false);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("a duplicate that slips past the probe (race) is mapped from the unique violation and leaves a failure audit", async () => {
    installWorld(defaultWorld({ insertError: { code: "23505", message: "duplicate key" } }));
    const r = await addManualMetricAction(prev, form(addFields));
    expect(r.error).toMatch(/sudah ada/);
    const audits = calls.filter((c) => c.table === "prompter_audit_logs").map((c) => (c.payload as { action: string }).action);
    expect(audits).toEqual(["manual_metrics.create", "manual_metrics.create_failed"]);
  });

  it("fails closed when the audit row cannot be written: nothing is saved", async () => {
    installWorld(defaultWorld({ auditError: { message: "boom" } }));
    const r = await addManualMetricAction(prev, form(addFields));
    expect(r.error).toMatch(/audit log/);
    expect(calls.some((c) => c.table === "prompter_manual_ad_metrics" && c.op === "insert")).toBe(false);
  });

  it("fails closed with a clear message when the table does not exist (migration not applied)", async () => {
    installWorld(defaultWorld({ readError: { code: "42P01", message: "relation does not exist" } }));
    const r = await addManualMetricAction(prev, form(addFields));
    expect(r.error).toMatch(/belum aktif/);
    expect(calls.some((c) => c.op === "insert")).toBe(false);

    calls = [];
    installWorld(defaultWorld({ insertError: { code: "PGRST205", message: "schema cache" } }));
    expect((await addManualMetricAction(prev, form(addFields))).error).toMatch(/belum aktif/);
  });

  it("maps database integrity/permission rejections to safe messages (no raw SQL error leaks)", async () => {
    installWorld(defaultWorld({ insertError: { code: "42501", message: 'new row violates row-level security policy for table "x"' } }));
    const r = await addManualMetricAction(prev, form(addFields));
    expect(r.error).toBe("Anda tidak memiliki izin untuk data ini.");
    installWorld(defaultWorld({ insertError: { code: "23514", message: "check constraint secret_name" } }));
    expect((await addManualMetricAction(prev, form(addFields))).error).not.toMatch(/secret_name/);
  });

  it("uses the currency of the campaign, so a USD campaign stores USD", async () => {
    installWorld(defaultWorld({ master: { id: MASTER_ID, currency: "USD" } }));
    await addManualMetricAction(prev, form(addFields));
    const insert = calls.find((c) => c.table === "prompter_manual_ad_metrics" && c.op === "insert");
    expect((insert?.payload as { currency: string }).currency).toBe("USD");
  });
});

describe("updateManualMetricAction", () => {
  it("updates metrics only, tenant-scoped, with before/after audit written first", async () => {
    const r = await updateManualMetricAction(prev, form(editFields));
    expect(r).toEqual({ error: null, success: "Perubahan tersimpan." });

    const audit = calls.find((c) => c.table === "prompter_audit_logs");
    const update = calls.find((c) => c.table === "prompter_manual_ad_metrics" && c.op === "update");
    expect(idx("prompter_audit_logs", "insert")).toBeLessThan(idx("prompter_manual_ad_metrics", "update"));
    expect(Object.keys(update?.payload ?? {}).sort()).toEqual(["clicks", "conversions", "impressions", "revenue", "spend"]);
    expect(update?.filters).toContainEqual(["tenant_id", "tenant-A"]);
    expect(update?.filters).toContainEqual(["id", ROW_ID]);
    const a = audit?.payload as { action: string; before_data: { spend: number }; after_data: { spend: number } };
    expect(a.action).toBe("manual_metrics.update");
    expect(a.before_data.spend).toBe(100000);
    expect(a.after_data.spend).toBe(120000);
  });

  it("cannot be used to change identity: date/channel/currency/tenant in the form are ignored", async () => {
    await updateManualMetricAction(prev, form({ ...editFields, metricDate: "2020-01-01", currency: "USD", tenantId: "tenant-B", channel: "X" }));
    const update = calls.find((c) => c.op === "update");
    expect(update?.payload).not.toHaveProperty("metric_date");
    expect(update?.payload).not.toHaveProperty("currency");
    expect(update?.payload).not.toHaveProperty("tenant_id");
    expect(update?.payload).not.toHaveProperty("channel");
  });

  it("another tenant's entry id is 'not found' and nothing is written", async () => {
    session.current = { ...session.current, tenantId: "tenant-B" };
    const r = await updateManualMetricAction(prev, form(editFields));
    expect(r.error).toBe("Entri tidak ditemukan.");
    expect(calls.some((c) => c.op === "update" || c.table === "prompter_audit_logs")).toBe(false);
  });

  it("refuses to edit once the channel is linked to a platform campaign", async () => {
    installWorld(defaultWorld({ channelCampaign: { ...channelCampaign, external_campaign_id: "ext-1" } }));
    const r = await updateManualMetricAction(prev, form(editFields));
    expect(r.error).toMatch(/tidak bisa diubah/);
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("viewer is refused, invalid values are refused, malformed ids are refused — all without database access", async () => {
    session.current = { ...session.current, role: "viewer" };
    expect((await updateManualMetricAction(prev, form(editFields))).error).toMatch(/izin/);
    session.current = { ...session.current, role: "owner" };
    expect((await updateManualMetricAction(prev, form({ ...editFields, spend: "-5" }))).error).not.toBeNull();
    expect((await updateManualMetricAction(prev, form({ ...editFields, id: "../x" }))).error).toBe("Entri tidak valid.");
    expect(calls).toHaveLength(0);
  });

  it("fails closed when audit cannot be written, and reports a zero-row update instead of claiming success", async () => {
    installWorld(defaultWorld({ auditError: { message: "x" } }));
    expect((await updateManualMetricAction(prev, form(editFields))).error).toMatch(/audit log/);
    expect(calls.some((c) => c.op === "update")).toBe(false);

    calls = [];
    installWorld(defaultWorld({ updateRows: [] }));
    const r = await updateManualMetricAction(prev, form(editFields));
    expect(r.success).toBeNull();
    expect(r.error).not.toBeNull();
  });
});

describe("deleteManualMetricAction", () => {
  it("deletes tenant-scoped with the full previous row captured in the audit first", async () => {
    const r = await deleteManualMetricAction(prev, form({ id: ROW_ID }));
    expect(r).toEqual({ error: null, success: "Entri dihapus." });
    expect(idx("prompter_audit_logs", "insert")).toBeLessThan(idx("prompter_manual_ad_metrics", "delete"));
    const del = calls.find((c) => c.op === "delete");
    expect(del?.filters).toContainEqual(["tenant_id", "tenant-A"]);
    const audit = calls.find((c) => c.table === "prompter_audit_logs");
    expect((audit?.payload as { before_data: { id: string } }).before_data.id).toBe(ROW_ID);
  });

  it("is still allowed after the channel was linked to a platform campaign (stale-data cleanup)", async () => {
    installWorld(defaultWorld({ channelCampaign: { ...channelCampaign, external_campaign_id: "ext-1" } }));
    expect((await deleteManualMetricAction(prev, form({ id: ROW_ID }))).error).toBeNull();
  });

  it("refuses viewers, other tenants, and a failed audit write", async () => {
    session.current = { ...session.current, role: "viewer" };
    expect((await deleteManualMetricAction(prev, form({ id: ROW_ID }))).error).toMatch(/izin/);
    expect(calls).toHaveLength(0);

    session.current = { ...session.current, role: "owner", tenantId: "tenant-B" };
    expect((await deleteManualMetricAction(prev, form({ id: ROW_ID }))).error).toBe("Entri tidak ditemukan.");
    expect(calls.some((c) => c.op === "delete")).toBe(false);

    session.current = { ...session.current, tenantId: "tenant-A" };
    calls = [];
    installWorld(defaultWorld({ auditError: { message: "x" } }));
    expect((await deleteManualMetricAction(prev, form({ id: ROW_ID }))).error).toMatch(/audit log/);
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("does not claim success when nothing was deleted", async () => {
    installWorld(defaultWorld({ deleteRows: [] }));
    const r = await deleteManualMetricAction(prev, form({ id: ROW_ID }));
    expect(r.success).toBeNull();
    expect(r.error).not.toBeNull();
  });
});

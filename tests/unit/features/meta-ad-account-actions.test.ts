import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-2b wiring test: drives the real server actions with a recording fake
 * Supabase client, to prove the SQL-level guarantees the DI-core tests cannot:
 * every query is filtered by the SESSION's tenant, the write is bound to
 * tenant + platform + CONNECTED + the exact connect timestamp, and nothing but
 * the connection row's account fields and one audit row is ever written.
 */

type Rec = { table: string; ops: Array<[string, unknown[]]> };

const hoisted = vi.hoisted(() => {
  const h = {
    session: { tenantId: "tenant-A", userId: "user-A", role: "owner" } as { tenantId: string; userId: string; role: string },
    regularLog: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
    adminLog: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
    results: {} as Record<string, unknown>,
    listAdAccounts: (async (_token: string) => ({ accounts: [], truncated: false })) as (token: string) => Promise<unknown>,
    readiness: (async (_t: string, _i: string, _o: unknown) => ({ kind: "NONE" })) as (t: string, i: string, o: unknown) => Promise<unknown>,
    revalidatePath: (..._a: unknown[]): void => {},
    makeClient(log: Array<{ table: string; ops: Array<[string, unknown[]]> }>) {
      return {
        from(table: string) {
          const rec = { table, ops: [] as Array<[string, unknown[]]> };
          log.push(rec);
          const chain: unknown = new Proxy(
            {},
            {
              get(_t, prop) {
                if (prop === "then") {
                  return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
                    const verb = rec.ops.find(([name]) => name === "update" || name === "insert")?.[0] ?? "select";
                    const result = h.results[`${table}:${verb}`] ?? { data: null, error: null };
                    return Promise.resolve(result).then(resolve, reject);
                  };
                }
                return (...args: unknown[]) => {
                  rec.ops.push([String(prop), args]);
                  return chain;
                };
              },
            },
          );
          return chain;
        },
      };
    },
  };
  return h;
});

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => hoisted.revalidatePath(...a) }));
vi.mock("@/services/session", () => ({ requireSessionContext: vi.fn(async () => hoisted.session) }));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: vi.fn(() => "plain-token") }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => hoisted.makeClient(hoisted.regularLog)) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => hoisted.makeClient(hoisted.adminLog)) }));
vi.mock("@/lib/connectors/meta-connector", () => ({
  MetaConnector: class {
    isConfigured() {
      return true;
    }
    getPages() {
      return Promise.resolve([]);
    }
    listAdAccounts(token: string) {
      return hoisted.listAdAccounts(token);
    }
    getAccountReadinessSnapshot(token: string, id: string, options: unknown) {
      return hoisted.readiness(token, id, options);
    }
  },
}));

import {
  checkMetaAdAccountReadinessAction,
  listMetaAdAccountsAction,
  selectMetaAdAccountAction,
} from "@/features/connections/actions";

const CONNECT_TS = "2026-10-20T00:00:00.000Z";
const CONNECTION = {
  id: "conn-A",
  status: "CONNECTED",
  external_account_id: "act_111",
  expires_at: "2099-01-01T00:00:00.000Z",
  last_refreshed_at: CONNECT_TS,
};
const SNAP = { accountStatus: 1, currency: "IDR", isPrepayAccount: false, hasFundingSource: true, minDailyBudgetRaw: null };

function allLogs() {
  return [...hoisted.regularLog, ...hoisted.adminLog];
}
function ops(rec: Rec, name: string) {
  return rec.ops.filter(([n]) => n === name).map(([, args]) => args);
}
function tenantFiltered(rec: Rec, tenant: string) {
  return ops(rec, "eq").some(([col, val]) => col === "tenant_id" && val === tenant);
}

beforeEach(() => {
  hoisted.session = { tenantId: "tenant-A", userId: "user-A", role: "owner" };
  hoisted.regularLog = [];
  hoisted.adminLog = [];
  hoisted.revalidatePath = vi.fn() as unknown as typeof hoisted.revalidatePath;
  hoisted.listAdAccounts = vi.fn(async (_t: string) => ({
    accounts: [
      { id: "act_111", name: "Akun Lama", snapshot: SNAP },
      { id: "act_222", name: "PT Tanyopo", snapshot: SNAP },
    ],
    truncated: false,
  }));
  hoisted.readiness = vi.fn(async () => ({ kind: "OK", snapshot: SNAP }));
  hoisted.results = {
    "prompter_connected_accounts:select": { data: CONNECTION, error: null },
    "prompter_oauth_credentials:select": { data: { encrypted_access_token: "cipher" }, error: null },
    "prompter_channel_campaigns:select": { data: [], error: null },
    "prompter_connected_accounts:update": { data: [{ id: "conn-A" }], error: null },
    "prompter_audit_logs:insert": { data: null, error: null },
    "prompter_audit_logs:select": { data: null, error: null },
  };
});

describe("selectMetaAdAccountAction wiring", () => {
  it("writes only the account fields on the tenant's CONNECTED connection and one audit row", async () => {
    const r = await selectMetaAdAccountAction("act_222");
    expect(r).toEqual({ error: null, selected: { id: "act_222", name: "PT Tanyopo" } });

    const update = allLogs().find((l) => l.table === "prompter_connected_accounts" && ops(l, "update").length > 0);
    expect(update).toBeDefined();
    if (!update) return;
    expect(ops(update, "update")[0][0]).toEqual({ external_account_id: "act_222", external_account_name: "PT Tanyopo" });
    const eqs = ops(update, "eq").map(([c, v]) => `${c}=${v}`);
    expect(eqs).toEqual(
      expect.arrayContaining([
        "id=conn-A",
        "tenant_id=tenant-A",
        "platform=META",
        "status=CONNECTED",
        `last_refreshed_at=${CONNECT_TS}`,
      ]),
    );

    const audit = hoisted.adminLog.find((l) => l.table === "prompter_audit_logs");
    expect(audit).toBeDefined();
    if (!audit) return;
    expect(ops(audit, "insert")[0][0]).toEqual({
      tenant_id: "tenant-A",
      actor_user_id: "user-A",
      action: "connection.meta_ad_account_selected",
      resource_type: "prompter_connected_accounts",
      resource_id: "conn-A",
      context: { platform: "META", external_account_id: "act_222", previous_external_account_id: "act_111" },
    });
    expect(hoisted.revalidatePath).toHaveBeenCalledWith("/connections");

    // Nothing else was written anywhere.
    const writes = allLogs().filter((l) => l.ops.some(([n]) => ["update", "insert", "upsert", "delete", "rpc"].includes(n)));
    expect(writes.map((w) => w.table).sort()).toEqual(["prompter_audit_logs", "prompter_connected_accounts"]);
  });

  it("filters every read and write by the session tenant", async () => {
    await selectMetaAdAccountAction("act_222");
    for (const rec of allLogs()) {
      const inserted = ops(rec, "insert")[0]?.[0] as { tenant_id?: string } | undefined;
      // Reads and the update are filtered with .eq("tenant_id", …); the insert carries it in the row.
      expect(inserted ? inserted.tenant_id === "tenant-A" : tenantFiltered(rec, "tenant-A")).toBe(true);
    }
    const creds = hoisted.adminLog.find((l) => l.table === "prompter_oauth_credentials");
    expect(creds && ops(creds, "eq").map(([c, v]) => `${c}=${v}`)).toEqual(
      expect.arrayContaining(["connected_account_id=conn-A", "tenant_id=tenant-A"]),
    );
  });

  it("uses the tenant of the session, not anything the client sends (another tenant's id is simply not in the list)", async () => {
    hoisted.session = { tenantId: "tenant-B", userId: "user-B", role: "owner" };
    hoisted.results["prompter_connected_accounts:select"] = {
      data: { ...CONNECTION, id: "conn-B", external_account_id: "act_777" },
      error: null,
    };
    hoisted.listAdAccounts = vi.fn(async (_t: string) => ({ accounts: [{ id: "act_777", name: "Toko B", snapshot: SNAP }], truncated: false }));
    const r = await selectMetaAdAccountAction("act_222"); // tenant A's account
    expect(r.error).toMatch(/tidak ditemukan atau sudah tidak dapat diakses/);
    expect(allLogs().every((l) => tenantFiltered(l, "tenant-B"))).toBe(true); // reads only: nothing was inserted
    expect(allLogs().some((l) => l.ops.some(([n]) => n === "update" || n === "insert"))).toBe(false);
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("is refused for a non-owner without touching the database or Meta", async () => {
    hoisted.session = { tenantId: "tenant-A", userId: "user-X", role: "marketing" };
    const r = await selectMetaAdAccountAction("act_222");
    expect(r.error).toMatch(/Owner/);
    expect(allLogs()).toHaveLength(0);
    expect(hoisted.listAdAccounts).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a conflict and writes no audit row when the connection changed meanwhile (reconnect)", async () => {
    hoisted.results["prompter_connected_accounts:update"] = { data: [], error: null };
    const r = await selectMetaAdAccountAction("act_222");
    expect(r.error).toMatch(/berubah saat Anda memilih/);
    expect(hoisted.adminLog.some((l) => l.table === "prompter_audit_logs")).toBe(false);
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not claim success when the audit row cannot be written", async () => {
    hoisted.results["prompter_audit_logs:insert"] = { data: null, error: { code: "XX000" } };
    const r = await selectMetaAdAccountAction("act_222");
    expect(r.error).toMatch(/gagal disimpan/);
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("blocks a change when Meta ads already exist (checked per tenant, Facebook/Instagram, with an external id)", async () => {
    hoisted.results["prompter_channel_campaigns:select"] = { data: [{ id: "cc-1" }], error: null };
    const r = await selectMetaAdAccountAction("act_222");
    expect(r.error).toMatch(/Sudah ada iklan/);
    const q = hoisted.regularLog.find((l) => l.table === "prompter_channel_campaigns");
    expect(q).toBeDefined();
    if (!q) return;
    expect(tenantFiltered(q, "tenant-A")).toBe(true);
    expect(ops(q, "in")[0]).toEqual(["channel", ["FACEBOOK", "INSTAGRAM"]]);
    expect(ops(q, "not")[0]).toEqual(["external_campaign_id", "is", null]);
    expect(allLogs().some((l) => l.ops.some(([n]) => n === "update" || n === "insert"))).toBe(false);
  });

  it("fails closed when the campaign check errors", async () => {
    hoisted.results["prompter_channel_campaigns:select"] = { data: null, error: { code: "42P01" } };
    const r = await selectMetaAdAccountAction("act_222");
    expect(r.error).not.toBeNull();
    expect(allLogs().some((l) => l.ops.some(([n]) => n === "update" || n === "insert"))).toBe(false);
  });
});

describe("listMetaAdAccountsAction and the readiness action: confirmation marker", () => {
  it("reads the marker for THIS connection after the latest connect, newest first, tenant-filtered", async () => {
    hoisted.results["prompter_audit_logs:select"] = { data: { context: { external_account_id: "act_111" } }, error: null };
    const r = await listMetaAdAccountsAction();
    if (r.error !== null) throw new Error("unexpected");
    expect(r.selectionConfirmed).toBe(true);

    const q = hoisted.adminLog.find((l) => l.table === "prompter_audit_logs");
    expect(q).toBeDefined();
    if (!q) return;
    const eqs = ops(q, "eq").map(([c, v]) => `${c}=${v}`);
    expect(eqs).toEqual(
      expect.arrayContaining(["tenant_id=tenant-A", "action=connection.meta_ad_account_selected", "resource_id=conn-A"]),
    );
    expect(ops(q, "gte")[0]).toEqual(["created_at", CONNECT_TS]);
    expect(ops(q, "order")[0][0]).toBe("created_at");
    expect(ops(q, "limit")[0]).toEqual([1]);
  });

  it("is NOT confirmed when the newest marker names a different account than the stored one (stale / changed)", async () => {
    hoisted.results["prompter_audit_logs:select"] = { data: { context: { external_account_id: "act_222" } }, error: null };
    const r = await listMetaAdAccountsAction();
    if (r.error !== null) throw new Error("unexpected");
    expect(r.selectionConfirmed).toBe(false);
  });

  it("is NOT confirmed without any marker, when the marker read fails, or when the connection has no connect timestamp", async () => {
    const none = await listMetaAdAccountsAction();
    if (none.error !== null) throw new Error("unexpected");
    expect(none.selectionConfirmed).toBe(false);

    hoisted.results["prompter_audit_logs:select"] = { data: null, error: { code: "XX000" } };
    const failed = await listMetaAdAccountsAction();
    if (failed.error !== null) throw new Error("unexpected");
    expect(failed.selectionConfirmed).toBe(false);

    hoisted.regularLog = [];
    hoisted.adminLog = [];
    hoisted.results["prompter_connected_accounts:select"] = { data: { ...CONNECTION, last_refreshed_at: null }, error: null };
    hoisted.results["prompter_audit_logs:select"] = { data: { context: { external_account_id: "act_111" } }, error: null };
    const noTs = await listMetaAdAccountsAction();
    if (noTs.error !== null) throw new Error("unexpected");
    expect(noTs.selectionConfirmed).toBe(false);
    expect(hoisted.adminLog.some((l) => l.table === "prompter_audit_logs")).toBe(false);
  });

  it("the readiness check evaluates the stored account with confirmed=true only when the marker matches", async () => {
    hoisted.results["prompter_audit_logs:select"] = { data: { context: { external_account_id: "act_111" } }, error: null };
    const ok = await checkMetaAdAccountReadinessAction();
    expect(ok.error).toBeNull();
    expect(hoisted.readiness).toHaveBeenCalledWith("plain-token", "act_111", { selectionConfirmed: true });

    hoisted.readiness = vi.fn(async () => ({ kind: "MULTIPLE" }));
    hoisted.results["prompter_audit_logs:select"] = { data: null, error: null };
    const unconfirmed = await checkMetaAdAccountReadinessAction();
    expect(hoisted.readiness).toHaveBeenCalledWith("plain-token", "act_111", { selectionConfirmed: false });
    if (unconfirmed.error !== null) throw new Error("unexpected");
    expect(unconfirmed.result.state).toBe("UNKNOWN");
  });

  it("list is read-only: no write of any kind", async () => {
    await listMetaAdAccountsAction();
    expect(allLogs().some((l) => l.ops.some(([n]) => ["update", "insert", "upsert", "delete", "rpc"].includes(n)))).toBe(false);
  });
});

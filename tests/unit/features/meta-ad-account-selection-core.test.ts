import { describe, expect, it, vi } from "vitest";
import {
  listMetaAdAccounts,
  selectMetaAdAccount,
  type MetaAdAccountSelectionDeps,
  type SelectionConnectionRow,
} from "@/features/connections/meta-ad-account-selection-core";
import { ConnectorApiError, ConnectorConfigError } from "@/lib/connectors/types";
import type { MetaAdAccountListItem, MetaAdAccountListing } from "@/lib/connectors/meta-connector";

const FUTURE = "2099-01-01T00:00:00.000Z";
const NOW = new Date("2026-10-28T00:00:00.000Z");
const CONNECTED_AT = "2026-10-20T00:00:00.000Z";
const TOKEN_PLAIN = "EAAB-super-secret-access-token";
const FUNDING_ID = "FUNDING-SOURCE-ID-98765";

const ACTIVE = { accountStatus: 1, currency: "IDR", isPrepayAccount: false, hasFundingSource: true, minDailyBudgetRaw: null };

function account(id: string, name: string, snapshot = ACTIVE): MetaAdAccountListItem {
  return { id, name, snapshot };
}

const A = account("act_111", "Akun Lama");
const B = account("act_222", "PT Tanyopo Future Technology");

function connection(over: Partial<SelectionConnectionRow> = {}): SelectionConnectionRow {
  return {
    id: "conn-A",
    status: "CONNECTED",
    external_account_id: "act_111",
    expires_at: FUTURE,
    last_refreshed_at: CONNECTED_AT,
    ...over,
  };
}

function makeDeps(over: Partial<MetaAdAccountSelectionDeps> = {}, listing: MetaAdAccountListing = { accounts: [A, B], truncated: false }) {
  const listAdAccounts = vi.fn(async (): Promise<MetaAdAccountListing> => listing);
  const loadConnection = vi.fn(async () => ({ ok: true as const, connection: connection() }));
  const loadEncryptedToken = vi.fn(async () => ({ ok: true as const, encrypted: "cipher" }));
  const decrypt = vi.fn((blob: string) => (blob === "cipher" ? TOKEN_PLAIN : "other"));
  const isSelectionConfirmed = vi.fn(async () => ({ ok: true as const, confirmed: false }));
  const hasMetaAdActivity = vi.fn(async () => ({ ok: true as const, has: false }));
  const persistSelection = vi.fn(async () => ({ ok: true as const }));
  const logFailure = vi.fn();
  const deps: MetaAdAccountSelectionDeps = {
    loadConnection,
    loadEncryptedToken,
    decrypt,
    connector: { isConfigured: () => true, listAdAccounts },
    isSelectionConfirmed,
    hasMetaAdActivity,
    persistSelection,
    now: () => NOW,
    logFailure,
    ...over,
  };
  return { deps, listAdAccounts, loadConnection, loadEncryptedToken, decrypt, isSelectionConfirmed, hasMetaAdActivity, persistSelection, logFailure };
}

const OWNER = { tenantId: "tenant-A", userId: "user-A", role: "owner" };

describe("listMetaAdAccounts", () => {
  it("lists several accounts and marks only the stored one as current (never picks one)", async () => {
    const h = makeDeps();
    const r = await listMetaAdAccounts(OWNER, h.deps);
    expect(r.error).toBeNull();
    if (r.error !== null) return;
    expect(r.accounts.map((a) => a.id)).toEqual(["act_111", "act_222"]);
    expect(r.accounts.filter((a) => a.isCurrent).map((a) => a.id)).toEqual(["act_111"]);
    expect(r.selectionConfirmed).toBe(false);
    expect(r.currentMissing).toBe(false);
    expect(h.persistSelection).not.toHaveBeenCalled();
  });

  it("shows currency, a status label and per-account readiness", async () => {
    const bad = account("act_333", "Akun USD", { ...ACTIVE, currency: "USD", accountStatus: 2 });
    const h = makeDeps({}, { accounts: [A, bad], truncated: false });
    const r = await listMetaAdAccounts(OWNER, h.deps);
    if (r.error !== null) throw new Error("unexpected");
    const [ok, notOk] = r.accounts;
    expect(ok).toMatchObject({ currency: "IDR", statusLabel: "Aktif", readiness: "READY", notes: [] });
    expect(notOk).toMatchObject({ currency: "USD", statusLabel: "Dinonaktifkan", readiness: "NOT_READY" });
    expect(notOk.notes.length).toBeGreaterThan(0);
  });

  it("supports exactly one account", async () => {
    const h = makeDeps({}, { accounts: [A], truncated: false });
    const r = await listMetaAdAccounts(OWNER, h.deps);
    if (r.error !== null) throw new Error("unexpected");
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0].isCurrent).toBe(true);
  });

  it("supports no ad account at all", async () => {
    const h = makeDeps({}, { accounts: [], truncated: false });
    const r = await listMetaAdAccounts(OWNER, h.deps);
    if (r.error !== null) throw new Error("unexpected");
    expect(r.accounts).toEqual([]);
    expect(r.currentMissing).toBe(true);
  });

  it("reports the truncation flag", async () => {
    const h = makeDeps({}, { accounts: [A], truncated: true });
    const r = await listMetaAdAccounts(OWNER, h.deps);
    if (r.error !== null) throw new Error("unexpected");
    expect(r.truncated).toBe(true);
  });

  it("flags a stored account that the connection can no longer access (changed access after reconnect)", async () => {
    const h = makeDeps({}, { accounts: [B], truncated: false });
    const r = await listMetaAdAccounts(OWNER, h.deps);
    if (r.error !== null) throw new Error("unexpected");
    expect(r.currentMissing).toBe(true);
    expect(r.accounts.some((a) => a.isCurrent)).toBe(false);
  });

  it("reports confirmation only when the marker says so; a failing marker read means NOT confirmed", async () => {
    const yes = makeDeps({ isSelectionConfirmed: vi.fn(async () => ({ ok: true as const, confirmed: true })) });
    const r1 = await listMetaAdAccounts(OWNER, yes.deps);
    if (r1.error !== null) throw new Error("unexpected");
    expect(r1.selectionConfirmed).toBe(true);

    const broken = makeDeps({ isSelectionConfirmed: vi.fn(async () => ({ ok: false as const })) });
    const r2 = await listMetaAdAccounts(OWNER, broken.deps);
    if (r2.error !== null) throw new Error("unexpected");
    expect(r2.selectionConfirmed).toBe(false);
    expect(broken.logFailure).toHaveBeenCalledWith("read_confirmation");
  });

  it("refuses a non-owner before touching anything", async () => {
    for (const role of ["marketing", "admin", "viewer", ""]) {
      const h = makeDeps();
      const r = await listMetaAdAccounts({ tenantId: "tenant-A", role }, h.deps);
      expect(r.error).toMatch(/Owner/);
      expect(h.loadConnection).not.toHaveBeenCalled();
      expect(h.loadEncryptedToken).not.toHaveBeenCalled();
      expect(h.listAdAccounts).not.toHaveBeenCalled();
    }
  });

  it("is not available when Meta is not configured, and calls nothing", async () => {
    const h = makeDeps({ connector: { isConfigured: () => false, listAdAccounts: vi.fn() } });
    const r = await listMetaAdAccounts(OWNER, h.deps);
    expect(r.error).toMatch(/belum dikonfigurasi/);
    expect(h.loadConnection).not.toHaveBeenCalled();
  });

  it("does not list for a missing or non-CONNECTED connection", async () => {
    for (const row of [null, connection({ status: "ACTION_REQUIRED" }), connection({ status: "DISCONNECTED" })]) {
      const h = makeDeps({ loadConnection: vi.fn(async () => ({ ok: true as const, connection: row })) });
      const r = await listMetaAdAccounts(OWNER, h.deps);
      expect(r.error).toMatch(/belum terhubung/);
      expect(h.listAdAccounts).not.toHaveBeenCalled();
    }
  });

  it("does not call Meta with an expired or unparseable expiry (expired token)", async () => {
    for (const expires_at of ["2020-01-01T00:00:00.000Z", "not-a-date", NOW.toISOString()]) {
      const h = makeDeps({ loadConnection: vi.fn(async () => ({ ok: true as const, connection: connection({ expires_at }) })) });
      const r = await listMetaAdAccounts(OWNER, h.deps);
      expect(r.error).toMatch(/kedaluwarsa/);
      expect(h.loadEncryptedToken).not.toHaveBeenCalled();
      expect(h.listAdAccounts).not.toHaveBeenCalled();
    }
  });

  it("maps Meta failures to safe Indonesian messages (expired token, permission denied, rate limit, provider error, timeout)", async () => {
    const cases: Array<[ConnectorApiError, RegExp]> = [
      [new ConnectorApiError("META", `Error validating access token ${TOKEN_PLAIN}`, { status: 400, code: 190 }), /kedaluwarsa/],
      [new ConnectorApiError("META", `(#200) permission ${TOKEN_PLAIN}`, { status: 403, code: 200 }), /izin/],
      [new ConnectorApiError("META", "limit", { status: 400, code: 17 }), /membatasi permintaan/],
      [new ConnectorApiError("META", `boom ${TOKEN_PLAIN}`, { status: 500 }), /tidak merespons dengan benar/],
      [new ConnectorApiError("META", "timeout", {}), /tidak merespons dengan benar/],
    ];
    for (const [err, pattern] of cases) {
      const h = makeDeps({ connector: { isConfigured: () => true, listAdAccounts: vi.fn(async () => { throw err; }) } });
      const r = await listMetaAdAccounts(OWNER, h.deps);
      expect(r.error).toMatch(pattern);
      expect(JSON.stringify(r)).not.toContain(TOKEN_PLAIN);
      expect(h.logFailure).toHaveBeenCalledWith("graph_list", err);
    }
  });

  it("treats a connector config error as not configured", async () => {
    const h = makeDeps({ connector: { isConfigured: () => true, listAdAccounts: vi.fn(async () => { throw new ConnectorConfigError("META", "x"); }) } });
    const r = await listMetaAdAccounts(OWNER, h.deps);
    expect(r.error).toMatch(/belum dikonfigurasi/);
  });

  it("fails closed on unreadable connection / credentials / decrypt", async () => {
    const a = makeDeps({ loadConnection: vi.fn(async () => ({ ok: false as const })) });
    expect((await listMetaAdAccounts(OWNER, a.deps)).error).toMatch(/tidak dapat dibaca/);
    const b = makeDeps({ loadEncryptedToken: vi.fn(async () => ({ ok: false as const })) });
    expect((await listMetaAdAccounts(OWNER, b.deps)).error).toMatch(/tidak dapat dibaca/);
    const c = makeDeps({ loadEncryptedToken: vi.fn(async () => ({ ok: true as const, encrypted: null })) });
    expect((await listMetaAdAccounts(OWNER, c.deps)).error).toMatch(/sambungkan ulang/i);
    const d = makeDeps({ decrypt: vi.fn(() => { throw new Error(`bad key ${TOKEN_PLAIN}`); }) });
    const rd = await listMetaAdAccounts(OWNER, d.deps);
    expect(rd.error).toMatch(/sambungkan ulang/i);
    expect(JSON.stringify(rd)).not.toContain(TOKEN_PLAIN);
    expect(d.listAdAccounts).not.toHaveBeenCalled();
  });

  it("never includes a token or funding identifier in the result", async () => {
    const leaky = { ...A, snapshot: { ...ACTIVE, hasFundingSource: true } } as MetaAdAccountListItem & { funding_source?: string };
    leaky.funding_source = FUNDING_ID;
    const h = makeDeps({}, { accounts: [leaky, B], truncated: false });
    const r = await listMetaAdAccounts(OWNER, h.deps);
    const text = JSON.stringify(r);
    expect(text).not.toContain(TOKEN_PLAIN);
    expect(text).not.toContain(FUNDING_ID);
    expect(text).not.toContain("funding");
  });
});

describe("selectMetaAdAccount", () => {
  it("stores a valid choice from the live list, scoped to the session tenant, and confirms it", async () => {
    const h = makeDeps();
    const r = await selectMetaAdAccount(OWNER, "act_222", h.deps);
    expect(r).toEqual({ error: null, selected: { id: "act_222", name: "PT Tanyopo Future Technology" } });
    expect(h.loadConnection).toHaveBeenCalledWith("tenant-A");
    expect(h.loadEncryptedToken).toHaveBeenCalledWith("tenant-A", "conn-A");
    expect(h.persistSelection).toHaveBeenCalledTimes(1);
    expect(h.persistSelection).toHaveBeenCalledWith({
      tenantId: "tenant-A",
      userId: "user-A",
      connectionId: "conn-A",
      expectedLastRefreshedAt: CONNECTED_AT,
      adAccountId: "act_222",
      adAccountName: "PT Tanyopo Future Technology",
      previousAdAccountId: "act_111",
    });
  });

  it("works with a single account and with confirming the already stored account", async () => {
    const one = makeDeps({}, { accounts: [A], truncated: false });
    expect((await selectMetaAdAccount(OWNER, "act_111", one.deps)).error).toBeNull();
    expect(one.hasMetaAdActivity).not.toHaveBeenCalled(); // no change => no campaign check needed
  });

  it("rejects a non-owner before reading anything", async () => {
    for (const role of ["marketing", "viewer", "admin", ""]) {
      const h = makeDeps();
      const r = await selectMetaAdAccount({ tenantId: "tenant-A", userId: "u", role }, "act_222", h.deps);
      expect(r.error).toMatch(/Owner/);
      expect(h.loadConnection).not.toHaveBeenCalled();
      expect(h.listAdAccounts).not.toHaveBeenCalled();
      expect(h.persistSelection).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed ids without any lookup (IDOR / injection attempts)", async () => {
    const bad: unknown[] = [undefined, null, 123, {}, [], "", "222", "act_", "act_abc", "act_12 34", "act_1; drop", "ACT_222", " act_222", "act_222\n", "../act_222", "act_" + "9".repeat(33)];
    for (const id of bad) {
      const h = makeDeps();
      const r = await selectMetaAdAccount(OWNER, id, h.deps);
      expect(r.error).toBe("Akun iklan tidak valid.");
      expect(h.loadConnection).not.toHaveBeenCalled();
      expect(h.persistSelection).not.toHaveBeenCalled();
    }
  });

  it("rejects an id that is not accessible through this tenant's own connection (cross-tenant / invented id)", async () => {
    const h = makeDeps();
    const r = await selectMetaAdAccount(OWNER, "act_999999", h.deps);
    expect(r.error).toMatch(/tidak ditemukan atau sudah tidak dapat diakses/);
    expect(h.persistSelection).not.toHaveBeenCalled();
  });

  it("isolates tenants: tenant B cannot select tenant A's account, and each tenant uses only its own connection and token", async () => {
    const tenantA = makeDeps({}, { accounts: [A, B], truncated: false });
    const tenantBAccount = account("act_777", "Toko B");
    const loadConnectionB = vi.fn(async (tenantId: string) => ({
      ok: true as const,
      connection: tenantId === "tenant-B" ? connection({ id: "conn-B", external_account_id: "act_777" }) : null,
    }));
    const loadTokenB = vi.fn(async () => ({ ok: true as const, encrypted: "cipher" }));
    const tenantB = makeDeps(
      { loadConnection: loadConnectionB, loadEncryptedToken: loadTokenB },
      { accounts: [tenantBAccount], truncated: false },
    );

    const ok = await selectMetaAdAccount(OWNER, "act_222", tenantA.deps);
    expect(ok.error).toBeNull();

    const attack = await selectMetaAdAccount({ tenantId: "tenant-B", userId: "user-B", role: "owner" }, "act_222", tenantB.deps);
    expect(attack.error).toMatch(/tidak ditemukan atau sudah tidak dapat diakses/);
    expect(tenantB.persistSelection).not.toHaveBeenCalled();
    expect(loadConnectionB).toHaveBeenCalledWith("tenant-B");
    expect(loadTokenB).toHaveBeenCalledWith("tenant-B", "conn-B");

    // A tenant without a connection gets nothing at all.
    const noConn = makeDeps({ loadConnection: vi.fn(async () => ({ ok: true as const, connection: null })) });
    const r = await selectMetaAdAccount({ tenantId: "tenant-C", userId: "u", role: "owner" }, "act_222", noConn.deps);
    expect(r.error).toMatch(/belum terhubung/);
    expect(noConn.listAdAccounts).not.toHaveBeenCalled();
  });

  it("does not select when the token is expired or Meta denies access / fails", async () => {
    const expired = makeDeps({ loadConnection: vi.fn(async () => ({ ok: true as const, connection: connection({ expires_at: "2020-01-01T00:00:00.000Z" }) })) });
    expect((await selectMetaAdAccount(OWNER, "act_222", expired.deps)).error).toMatch(/kedaluwarsa/);
    expect(expired.persistSelection).not.toHaveBeenCalled();

    for (const err of [
      new ConnectorApiError("META", "denied", { status: 403, code: 200 }),
      new ConnectorApiError("META", "token", { status: 400, code: 190 }),
      new ConnectorApiError("META", "boom", { status: 500 }),
    ]) {
      const h = makeDeps({ connector: { isConfigured: () => true, listAdAccounts: vi.fn(async () => { throw err; }) } });
      const r = await selectMetaAdAccount(OWNER, "act_222", h.deps);
      expect(r.error).not.toBeNull();
      expect(r.selected).toBeNull();
      expect(h.persistSelection).not.toHaveBeenCalled();
    }
  });

  it("refuses to change the account once ads exist on the current one, and when that cannot be checked", async () => {
    const has = makeDeps({ hasMetaAdActivity: vi.fn(async () => ({ ok: true as const, has: true })) });
    const r1 = await selectMetaAdAccount(OWNER, "act_222", has.deps);
    expect(r1.error).toMatch(/Sudah ada iklan/);
    expect(has.persistSelection).not.toHaveBeenCalled();

    const unknown = makeDeps({ hasMetaAdActivity: vi.fn(async () => ({ ok: false as const })) });
    const r2 = await selectMetaAdAccount(OWNER, "act_222", unknown.deps);
    expect(r2.error).not.toBeNull();
    expect(unknown.persistSelection).not.toHaveBeenCalled();

    // Re-confirming the SAME account stays allowed even with campaigns.
    const same = makeDeps({ hasMetaAdActivity: vi.fn(async () => ({ ok: true as const, has: true })) });
    expect((await selectMetaAdAccount(OWNER, "act_111", same.deps)).error).toBeNull();
  });

  it("reports a conflict when the connection changed meanwhile (reconnect) and nothing is claimed saved", async () => {
    const h = makeDeps({ persistSelection: vi.fn(async () => ({ ok: false as const, reason: "CONFLICT" as const })) });
    const r = await selectMetaAdAccount(OWNER, "act_222", h.deps);
    expect(r.error).toMatch(/berubah saat Anda memilih/);
    expect(r.selected).toBeNull();
  });

  it("reports a save error without claiming success", async () => {
    const h = makeDeps({ persistSelection: vi.fn(async () => ({ ok: false as const, reason: "ERROR" as const })) });
    const r = await selectMetaAdAccount(OWNER, "act_222", h.deps);
    expect(r.error).toMatch(/gagal disimpan/);
    expect(r.selected).toBeNull();
  });

  it("refuses when the connection has no connect timestamp (cannot bind the choice to this connection)", async () => {
    const h = makeDeps({ loadConnection: vi.fn(async () => ({ ok: true as const, connection: connection({ last_refreshed_at: null }) })) });
    const r = await selectMetaAdAccount(OWNER, "act_222", h.deps);
    expect(r.error).toMatch(/Sambungkan ulang/);
    expect(h.persistSelection).not.toHaveBeenCalled();
  });

  it("never leaks the token into results or logs", async () => {
    const h = makeDeps({ persistSelection: vi.fn(async () => ({ ok: false as const, reason: "ERROR" as const })) });
    const r = await selectMetaAdAccount(OWNER, "act_222", h.deps);
    expect(JSON.stringify(r)).not.toContain(TOKEN_PLAIN);
    expect(JSON.stringify(h.logFailure.mock.calls)).not.toContain(TOKEN_PLAIN);
  });
});

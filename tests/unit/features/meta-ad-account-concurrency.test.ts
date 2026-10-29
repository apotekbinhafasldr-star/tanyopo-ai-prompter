import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-2b consistency / concurrency regression tests.
 *
 * The real server actions run against a small STATEFUL in-memory database that
 * applies each statement atomically (like Postgres row-level statements) but
 * lets concurrent requests interleave between statements at random points
 * (seeded, so failures are reproducible). Invariants are checked after every
 * schedule instead of hand-picking one interleaving.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

const hoisted = vi.hoisted(() => {
  const h = {
    session: { tenantId: "tenant-A", userId: "user-A", role: "owner" } as { tenantId: string; userId: string; role: string },
    db: {} as Record<string, Row[]>,
    clock: 0,
    seed: 1,
    faults: { auditInsertError: false, updateError: false, updateAppliedButErrors: false },
    accessible: ["act_111", "act_222", "act_333"] as string[],
    revalidations: 0,
    rand(): number {
      // mulberry32
      h.seed = (h.seed + 0x6d2b79f5) | 0;
      let t = Math.imul(h.seed ^ (h.seed >>> 15), 1 | h.seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    async jitter(): Promise<void> {
      const ticks = Math.floor(h.rand() * 5);
      for (let i = 0; i < ticks; i += 1) await Promise.resolve();
    },
    makeClient() {
      return {
        from(table: string) {
          const filters: Filter[] = [];
          let verb: "select" | "update" | "insert" = "select";
          let patch: Row = {};
          let inserted: Row = {};
          let wantsRows = false;
          let single = false;
          let max = Infinity;
          const chain: Record<string, unknown> = {};
          const add = (f: Filter) => {
            filters.push(f);
            return chain;
          };
          const valueAt = (row: Row, col: string): unknown => {
            if (col.includes("->>")) {
              const [base, key] = col.split("->>");
              return (row[base] as Row | undefined)?.[key];
            }
            return row[col];
          };
          chain.select = () => {
            if (verb === "update" || verb === "insert") wantsRows = true;
            return chain;
          };
          chain.update = (p: Row) => {
            verb = "update";
            patch = p;
            return chain;
          };
          chain.insert = (r: Row) => {
            verb = "insert";
            inserted = r;
            return chain;
          };
          chain.eq = (col: string, v: unknown) => add((r) => valueAt(r, col) === v);
          chain.filter = (col: string, op: string, v: unknown) => {
            if (op !== "eq") throw new Error("unsupported filter op");
            return add((r) => valueAt(r, col) === v);
          };
          chain.in = (col: string, vs: unknown[]) => add((r) => vs.includes(valueAt(r, col)));
          chain.limit = (n: number) => {
            max = n;
            return chain;
          };
          chain.maybeSingle = () => {
            single = true;
            return chain;
          };
          chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            (async () => {
              await h.jitter();
              // ---- one atomic statement ----
              const rows = (h.db[table] ??= []);
              if (verb === "insert") {
                if (table === "prompter_audit_logs" && h.faults.auditInsertError) return { data: null, error: { code: "XX000" } };
                h.clock += 1;
                rows.push({ id: `${table}-${h.clock}`, created_at: h.clock, ...inserted });
                return { data: null, error: null };
              }
              const matched = rows.filter((r) => filters.every((f) => f(r))).slice(0, max);
              if (verb === "update") {
                if (h.faults.updateError && table === "prompter_connected_accounts") return { data: null, error: { code: "XX000" } };
                for (const r of matched) Object.assign(r, patch);
                if (h.faults.updateAppliedButErrors && table === "prompter_connected_accounts") {
                  return { data: null, error: { code: "08006" } }; // committed, but the response was lost
                }
                return { data: wantsRows ? matched.map((r) => ({ id: r.id })) : null, error: null };
              }
              const copy = matched.map((r) => ({ ...r }));
              return { data: single ? (copy[0] ?? null) : copy, error: null };
            })().then(resolve, reject);
          return chain;
        },
      };
    },
  };
  return h;
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    hoisted.revalidations += 1;
  },
}));
vi.mock("@/services/session", () => ({ requireSessionContext: vi.fn(async () => hoisted.session) }));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: vi.fn(() => "plain-token") }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => hoisted.makeClient()) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => hoisted.makeClient()) }));
vi.mock("@/lib/connectors/meta-connector", () => ({
  MetaConnector: class {
    isConfigured() {
      return true;
    }
    getPages() {
      return Promise.resolve([]);
    }
    async listAdAccounts() {
      await hoisted.jitter();
      const snapshot = { accountStatus: 1, currency: "IDR", isPrepayAccount: false, hasFundingSource: true, minDailyBudgetRaw: null };
      return { accounts: hoisted.accessible.map((id) => ({ id, name: `Akun ${id}`, snapshot })), truncated: false };
    }
    getAccountReadinessSnapshot() {
      return Promise.resolve({ kind: "NONE" });
    }
  },
}));

import { listMetaAdAccountsAction, selectMetaAdAccountAction } from "@/features/connections/actions";

const STAMP_1 = "2026-10-20T00:00:00+00:00";
const STAMP_2 = "2026-10-28T09:00:00+00:00";

function connectionRow(): Row {
  return {
    id: "conn-A",
    tenant_id: "tenant-A",
    platform: "META",
    status: "CONNECTED",
    external_account_id: "act_111",
    external_account_name: "Akun act_111",
    expires_at: "2099-01-01T00:00:00.000Z",
    last_refreshed_at: STAMP_1,
  };
}
const conn = () => hoisted.db.prompter_connected_accounts[0];
const audits = () => hoisted.db.prompter_audit_logs;

async function confirmedNow(): Promise<boolean> {
  const r = await listMetaAdAccountsAction();
  if (r.error !== null) throw new Error(`list failed: ${r.error}`);
  return r.selectionConfirmed;
}

beforeEach(() => {
  hoisted.session = { tenantId: "tenant-A", userId: "user-A", role: "owner" };
  hoisted.db = {
    prompter_connected_accounts: [connectionRow()],
    prompter_oauth_credentials: [{ id: "cred-A", tenant_id: "tenant-A", connected_account_id: "conn-A", encrypted_access_token: "cipher" }],
    prompter_audit_logs: [],
    prompter_channel_campaigns: [],
    // The confirmation marker only counts when its actor is a current Owner of the tenant.
    user_profiles: [{ id: "user-A", tenant_id: "tenant-A", role: "owner" }],
  };
  hoisted.clock = 0;
  hoisted.faults = { auditInsertError: false, updateError: false, updateAppliedButErrors: false };
  hoisted.accessible = ["act_111", "act_222", "act_333"];
  hoisted.revalidations = 0;
});

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

describe("simultaneous selections of different ad accounts", () => {
  it("exactly one wins, the other gets a conflict, and the winner is the stored AND confirmed account (60 schedules)", async () => {
    for (const seed of SEEDS) {
      hoisted.seed = seed;
      hoisted.db.prompter_connected_accounts = [connectionRow()];
      hoisted.db.prompter_audit_logs = [];
      hoisted.revalidations = 0;

      const [a, b] = await Promise.all([selectMetaAdAccountAction("act_222"), selectMetaAdAccountAction("act_333")]);

      const winners = [a, b].filter((r) => r.error === null);
      const losers = [a, b].filter((r) => r.error !== null);
      expect(winners, `seed ${seed}`).toHaveLength(1);
      expect(losers, `seed ${seed}`).toHaveLength(1);
      expect(losers[0].error, `seed ${seed}`).toMatch(/berubah saat Anda memilih/);
      expect(hoisted.revalidations, `seed ${seed}`).toBe(1);

      const winnerId = winners[0].selected?.id;
      expect(conn().external_account_id, `seed ${seed}`).toBe(winnerId);
      expect(conn().external_account_name, `seed ${seed}`).toBe(`Akun ${winnerId}`);
      expect(await confirmedNow(), `seed ${seed}`).toBe(true);
    }
  });

  it("the account never changes without a matching confirmation bound to the current connect stamp", async () => {
    for (const seed of SEEDS) {
      hoisted.seed = seed;
      hoisted.db.prompter_connected_accounts = [connectionRow()];
      hoisted.db.prompter_audit_logs = [];
      await Promise.all([selectMetaAdAccountAction("act_222"), selectMetaAdAccountAction("act_333"), selectMetaAdAccountAction("act_222")]);
      const stored = conn().external_account_id as string;
      if (stored !== "act_111") {
        const matching = audits().filter((r) => {
          const c = r.context as Row;
          return c.external_account_id === stored && c.connected_at === conn().last_refreshed_at;
        });
        expect(matching.length, `seed ${seed}`).toBeGreaterThan(0);
      }
    }
  });

  it("two requests for the SAME account both end consistent (one may report a conflict, none corrupts state)", async () => {
    for (const seed of SEEDS) {
      hoisted.seed = seed;
      hoisted.db.prompter_connected_accounts = [connectionRow()];
      hoisted.db.prompter_audit_logs = [];
      const results = await Promise.all([selectMetaAdAccountAction("act_222"), selectMetaAdAccountAction("act_222")]);
      expect(results.filter((r) => r.error === null).length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(conn().external_account_id, `seed ${seed}`).toBe("act_222");
      expect(await confirmedNow(), `seed ${seed}`).toBe(true);
    }
  });
});

describe("a reconnect racing a selection", () => {
  /** What the OAuth callback does: demote, then promote with a NEW stamp and the first account Meta returns. */
  async function reconnect(firstAccount: string) {
    await hoisted.jitter();
    Object.assign(conn(), { status: "ACTION_REQUIRED" });
    await hoisted.jitter();
    Object.assign(conn(), {
      status: "CONNECTED",
      external_account_id: firstAccount,
      external_account_name: `Akun ${firstAccount}`,
      last_refreshed_at: STAMP_2,
    });
  }

  it("after the reconnect completes, no earlier confirmation survives (60 schedules)", async () => {
    for (const seed of SEEDS) {
      hoisted.seed = seed;
      hoisted.db.prompter_connected_accounts = [connectionRow()];
      hoisted.db.prompter_audit_logs = [];
      // The reconnected token only sees these accounts; the first one is act_333.
      await Promise.all([selectMetaAdAccountAction("act_222"), reconnect("act_333")]);

      expect(conn().last_refreshed_at, `seed ${seed}`).toBe(STAMP_2);
      expect(conn().status, `seed ${seed}`).toBe("CONNECTED");
      const stored = conn().external_account_id;
      const confirmed = await confirmedNow();
      if (stored === "act_333") {
        // The reconnect value stands (the selection ran before it, or lost): no OLD choice may confirm it.
        expect(confirmed, `seed ${seed}`).toBe(false);
      } else {
        // The selection ran entirely AFTER the reconnect finished: it is a legitimate choice against the
        // NEW connection, so it must be confirmed by a row bound to the NEW stamp, never the old one.
        expect(stored, `seed ${seed}`).toBe("act_222");
        expect(
          audits().some((r) => (r.context as Row).external_account_id === "act_222" && (r.context as Row).connected_at === STAMP_2),
          `seed ${seed}`,
        ).toBe(true);
        expect(confirmed, `seed ${seed}`).toBe(true);
      }
    }
  });

  it("an old confirmation for the same account id is still rejected after a reconnect", async () => {
    hoisted.accessible = ["act_111", "act_222"];
    const ok = await selectMetaAdAccountAction("act_222");
    expect(ok.error).toBeNull();
    expect(await confirmedNow()).toBe(true);

    await reconnect("act_222"); // Meta now returns the same account first
    expect(conn().external_account_id).toBe("act_222");
    expect(await confirmedNow()).toBe(false);

    const again = await selectMetaAdAccountAction("act_222");
    expect(again.error).toBeNull();
    expect(await confirmedNow()).toBe(true);
  });
});

describe("failure atomicity", () => {
  it("a failed confirmation changes nothing", async () => {
    hoisted.faults.auditInsertError = true;
    const r = await selectMetaAdAccountAction("act_222");
    expect(r.error).not.toBeNull();
    expect(conn().external_account_id).toBe("act_111");
    expect(conn().external_account_name).toBe("Akun act_111");
    expect(audits()).toHaveLength(0);
    expect(hoisted.revalidations).toBe(0);
  });

  it("a failed update leaves the previously confirmed account confirmed and the new one unconfirmed", async () => {
    expect((await selectMetaAdAccountAction("act_111")).error).toBeNull(); // Owner confirms act_111
    expect(await confirmedNow()).toBe(true);

    hoisted.faults.updateError = true;
    const r = await selectMetaAdAccountAction("act_222");
    expect(r.error).not.toBeNull();
    expect(conn().external_account_id).toBe("act_111");
    expect(await confirmedNow()).toBe(true); // still the account the Owner confirmed
    // The orphan confirmation names act_222 and cannot confirm anything while act_111 is stored.
    expect(audits().some((a) => (a.context as Row).external_account_id === "act_222")).toBe(true);
  });

  it("a lost update response (change committed, caller sees an error) still ends consistent: stored account and its confirmation agree", async () => {
    hoisted.faults.updateAppliedButErrors = true;
    const r = await selectMetaAdAccountAction("act_222");
    expect(r.error).not.toBeNull(); // we cannot claim success
    expect(conn().external_account_id).toBe("act_222");
    hoisted.faults.updateAppliedButErrors = false;
    expect(await confirmedNow()).toBe(true); // the confirmation was written first, so the committed change is confirmed
  });

  it("an orphan confirmation can never confirm an account that was not chosen through the action", async () => {
    hoisted.faults.updateError = true;
    await selectMetaAdAccountAction("act_222"); // audit row for act_222 written, account unchanged
    hoisted.faults.updateError = false;
    // Something else (e.g. a manual change) moves the stored account to act_222 without a new selection.
    Object.assign(conn(), { external_account_id: "act_222", last_refreshed_at: STAMP_2 });
    expect(await confirmedNow()).toBe(false); // the orphan row carries the OLD stamp
  });
});

describe("campaign safety under switching", () => {
  async function campaign(status: string, external: string | null) {
    hoisted.db.prompter_channel_campaigns = [
      { id: "cc-1", tenant_id: "tenant-A", channel: "FACEBOOK", status, external_campaign_id: external },
    ];
  }

  it("never switches while ads exist, are launching, or failed half-way", async () => {
    for (const [status, external] of [
      ["ACTIVE", "120001"],
      ["PAUSED", "120001"],
      ["FAILED", null], // an in-progress launch claim: the Meta id is not recorded yet
      ["FAILED", "120001"],
      ["COMPLETED", null],
    ] as const) {
      hoisted.db.prompter_connected_accounts = [connectionRow()];
      hoisted.db.prompter_audit_logs = [];
      await campaign(status, external);
      const r = await selectMetaAdAccountAction("act_222");
      expect(r.error, `${status}/${external}`).toMatch(/Sudah ada iklan/);
      expect(conn().external_account_id, `${status}/${external}`).toBe("act_111");
      expect(audits(), `${status}/${external}`).toHaveLength(0);
    }
  });

  it("other tenants' campaigns do not block this tenant, and Instagram counts like Facebook", async () => {
    hoisted.db.prompter_channel_campaigns = [
      { id: "cc-x", tenant_id: "tenant-OTHER", channel: "FACEBOOK", status: "ACTIVE", external_campaign_id: "9" },
    ];
    expect((await selectMetaAdAccountAction("act_222")).error).toBeNull();

    hoisted.db.prompter_connected_accounts = [connectionRow()];
    hoisted.db.prompter_channel_campaigns = [
      { id: "cc-ig", tenant_id: "tenant-A", channel: "INSTAGRAM", status: "ACTIVE", external_campaign_id: "7" },
    ];
    expect((await selectMetaAdAccountAction("act_333")).error).toMatch(/Sudah ada iklan/);
  });

  it("re-confirming the SAME account stays possible with ads present (nothing is orphaned)", async () => {
    await campaign("ACTIVE", "120001");
    expect((await selectMetaAdAccountAction("act_111")).error).toBeNull();
    expect(await confirmedNow()).toBe(true);
  });
});

describe("tenant isolation and authorization with shared state", () => {
  it("another tenant's connection, credentials and confirmations are never touched or used", async () => {
    hoisted.db.prompter_connected_accounts.push({
      ...connectionRow(),
      id: "conn-B",
      tenant_id: "tenant-B",
      external_account_id: "act_111",
    });
    hoisted.db.prompter_oauth_credentials.push({ id: "cred-B", tenant_id: "tenant-B", connected_account_id: "conn-B", encrypted_access_token: "cipher-B" });

    const r = await selectMetaAdAccountAction("act_222"); // tenant A
    expect(r.error).toBeNull();
    const other = hoisted.db.prompter_connected_accounts.find((c) => c.tenant_id === "tenant-B");
    expect(other?.external_account_id).toBe("act_111"); // untouched
    expect(audits().every((a) => a.tenant_id === "tenant-A" && a.resource_id === "conn-A")).toBe(true);

    // Tenant B has no confirmation even though A's row names the same account ids.
    hoisted.session = { tenantId: "tenant-B", userId: "user-B", role: "owner" };
    expect(await confirmedNow()).toBe(false);
  });

  it("a non-owner cannot list or select and changes nothing", async () => {
    hoisted.session = { tenantId: "tenant-A", userId: "user-X", role: "marketing" };
    const l = await listMetaAdAccountsAction();
    expect(l.error).toMatch(/Owner/);
    const s = await selectMetaAdAccountAction("act_222");
    expect(s.error).toMatch(/Owner/);
    expect(conn().external_account_id).toBe("act_111");
    expect(audits()).toHaveLength(0);
  });

  it("an id outside the live list is rejected even if it exists for another tenant", async () => {
    hoisted.accessible = ["act_111", "act_222"];
    const r = await selectMetaAdAccountAction("act_333");
    expect(r.error).toMatch(/tidak ditemukan atau sudah tidak dapat diakses/);
    expect(conn().external_account_id).toBe("act_111");
    expect(audits()).toHaveLength(0);
  });
});

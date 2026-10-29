import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR #73 remediation (P1-1): the F-2b confirmation marker must be unforgeable
 * by tenant members who are not Owners.
 *
 * `prompter_audit_logs` can be INSERTed by any signed-in member of the tenant;
 * the live INSERT policy only requires tenant_id = fn_current_tenant_id() and
 * actor_user_id NULL or = auth.uid(). `user_profiles` has no INSERT/UPDATE
 * policy for clients, so a member cannot change their own role. This file
 * models exactly that, with an in-memory database that applies the real query
 * filters, and checks that readSelectionConfirmed only honours markers whose
 * actor is a CURRENT Owner of the same tenant.
 */

type Profile = { id: string; tenant_id: string; role: string };
type AuditRow = {
  tenant_id: string;
  action: string;
  resource_id: string;
  actor_user_id: string | null;
  context: Record<string, unknown>;
};

const db = vi.hoisted(() => ({
  profiles: [] as Array<{ id: string; tenant_id: string; role: string }>,
  audit: [] as Array<{
    tenant_id: string;
    action: string;
    resource_id: string;
    actor_user_id: string | null;
    context: Record<string, unknown>;
  }>,
  profilesError: false,
  auditError: false,
  noAdmin: false,
  calls: [] as string[],
}));

type Filter = (row: Record<string, unknown>) => boolean;

function builder(table: "user_profiles" | "prompter_audit_logs") {
  const filters: Filter[] = [];
  let max = Infinity;
  db.calls.push(table);
  const rows = (): Array<Record<string, unknown>> => {
    const source = (table === "user_profiles" ? db.profiles : db.audit) as unknown as Array<Record<string, unknown>>;
    return source.filter((row) => filters.every((f) => f(row))).slice(0, max);
  };
  const failed = () => (table === "user_profiles" ? db.profilesError : db.auditError);
  const chain = {
    select: () => chain,
    eq: (col: string, value: unknown) => {
      filters.push((row) => row[col] === value);
      return chain;
    },
    in: (col: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[col]));
      return chain;
    },
    filter: (col: string, _op: string, value: unknown) => {
      const [root, key] = col.split("->>");
      filters.push((row) => (row[root] as Record<string, unknown> | undefined)?.[key] === value);
      return chain;
    },
    limit: (n: number) => {
      max = n;
      return chain;
    },
    maybeSingle: async () => (failed() ? { data: null, error: { code: "XX000" } } : { data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(failed() ? { data: null, error: { code: "XX000" } } : { data: rows(), error: null }).then(resolve, reject),
  };
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => (db.noAdmin ? null : { from: (table: "user_profiles" | "prompter_audit_logs") => builder(table) })),
}));

import { AD_ACCOUNT_SELECTED_ACTION, readSelectionConfirmed } from "@/features/connections/meta-selection-confirmation";

const A = "tenant-A";
const B = "tenant-B";
const OWNER_A = "owner-A";
const MARKETING_A = "marketing-A";
const OWNER_B = "owner-B";
const STAMP = "2026-10-01T00:00:00.000Z";
const CONN = { id: "conn-A", external_account_id: "act_111", last_refreshed_at: STAMP };

/** Mirrors the live INSERT policy of prompter_audit_logs (captured from pg_policies). */
function rlsInsert(caller: { tenantId: string; userId: string }, row: AuditRow): boolean {
  const allowed = row.tenant_id === caller.tenantId && (row.actor_user_id === null || row.actor_user_id === caller.userId);
  if (allowed) db.audit.push(row);
  return allowed;
}

const marker = (actor: string | null, over: Partial<AuditRow> = {}, ctx: Record<string, unknown> = {}): AuditRow => ({
  tenant_id: A,
  action: AD_ACCOUNT_SELECTED_ACTION,
  resource_id: CONN.id,
  actor_user_id: actor,
  context: { platform: "META", external_account_id: "act_111", connected_at: STAMP, ...ctx },
  ...over,
});

beforeEach(() => {
  db.profiles = [
    { id: OWNER_A, tenant_id: A, role: "owner" },
    { id: MARKETING_A, tenant_id: A, role: "marketing" },
    { id: OWNER_B, tenant_id: B, role: "owner" },
  ];
  db.audit = [];
  db.profilesError = false;
  db.auditError = false;
  db.noAdmin = false;
  db.calls = [];
});

describe("readSelectionConfirmed: Owner-authored markers only", () => {
  it("accepts a marker written by a current Owner of the tenant", async () => {
    db.audit.push(marker(OWNER_A));
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: true, confirmed: true });
  });

  it("rejects a marker a marketing user wrote for themselves (passes RLS, is not an Owner)", async () => {
    expect(rlsInsert({ tenantId: A, userId: MARKETING_A }, marker(MARKETING_A))).toBe(true);
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: true, confirmed: false });
  });

  it("rejects a forged marker with a NULL actor (RLS allows it, the Owner check does not)", async () => {
    expect(rlsInsert({ tenantId: A, userId: MARKETING_A }, marker(null))).toBe(true);
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: true, confirmed: false });
  });

  it("a marketing user cannot write the Owner's id: RLS refuses it, so nothing is stored", async () => {
    expect(rlsInsert({ tenantId: A, userId: MARKETING_A }, marker(OWNER_A))).toBe(false);
    expect(db.audit).toHaveLength(0);
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: true, confirmed: false });
  });

  it("a flood of forged markers can neither hide nor replace the genuine one", async () => {
    for (let i = 0; i < 500; i += 1) rlsInsert({ tenantId: A, userId: MARKETING_A }, marker(i % 2 ? null : MARKETING_A));
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: true, confirmed: false });
    db.audit.push(marker(OWNER_A));
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: true, confirmed: true });
  });

  it("does not trust a marker authored by a demoted or removed Owner", async () => {
    db.audit.push(marker(OWNER_A));
    db.profiles = db.profiles.map((p) => (p.id === OWNER_A ? { ...p, role: "marketing" } : p));
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: true, confirmed: false });
    db.profiles = db.profiles.filter((p) => p.id !== OWNER_A);
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: true, confirmed: false });
  });
});

describe("readSelectionConfirmed: tenant isolation", () => {
  it("an Owner of another tenant cannot write a marker for this tenant (RLS) and cannot confirm it", async () => {
    expect(rlsInsert({ tenantId: B, userId: OWNER_B }, marker(OWNER_B))).toBe(false);
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: true, confirmed: false });
  });

  it("even a stored marker whose actor is another tenant's Owner does not count", async () => {
    db.audit.push(marker(OWNER_B));
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: true, confirmed: false });
  });

  it("an Owner marker stored under another tenant id does not confirm this tenant's connection", async () => {
    db.audit.push(marker(OWNER_A, { tenant_id: B }));
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: true, confirmed: false });
  });

  it("the Owner lookup is scoped to the tenant: another tenant's Owner is never in the list", async () => {
    db.audit.push(marker(OWNER_B));
    expect(await readSelectionConfirmed(B, CONN)).toEqual({ ok: true, confirmed: false });
  });
});

describe("readSelectionConfirmed: missing, stale and reconnected", () => {
  it("is not confirmed without any marker", async () => {
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: true, confirmed: false });
  });

  it("is not confirmed when the tenant has no Owner row at all", async () => {
    db.profiles = db.profiles.filter((p) => p.tenant_id !== A || p.role !== "owner");
    db.audit.push(marker(OWNER_A));
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: true, confirmed: false });
  });

  it("a reconnect (new connect stamp) invalidates the earlier Owner confirmation", async () => {
    db.audit.push(marker(OWNER_A));
    const reconnected = { ...CONN, last_refreshed_at: "2026-10-20T00:00:00.000Z" };
    expect(await readSelectionConfirmed(A, reconnected)).toEqual({ ok: true, confirmed: false });
  });

  it("a different stored account or connection is not covered by the earlier confirmation", async () => {
    db.audit.push(marker(OWNER_A));
    expect(await readSelectionConfirmed(A, { ...CONN, external_account_id: "act_222" })).toEqual({ ok: true, confirmed: false });
    expect(await readSelectionConfirmed(A, { ...CONN, id: "conn-other" })).toEqual({ ok: true, confirmed: false });
  });

  it("a connection without an account or connect stamp is unconfirmed and reads nothing", async () => {
    db.audit.push(marker(OWNER_A));
    expect(await readSelectionConfirmed(A, { ...CONN, external_account_id: null })).toEqual({ ok: true, confirmed: false });
    expect(await readSelectionConfirmed(A, { ...CONN, last_refreshed_at: null })).toEqual({ ok: true, confirmed: false });
    expect(db.calls).toEqual([]);
  });
});

describe("readSelectionConfirmed: fail closed", () => {
  it("is unreadable (never confirmed) when the admin client, the Owner lookup or the marker read fails", async () => {
    db.audit.push(marker(OWNER_A));
    db.noAdmin = true;
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: false });
    db.noAdmin = false;
    db.profilesError = true;
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: false });
    db.profilesError = false;
    db.auditError = true;
    expect(await readSelectionConfirmed(A, CONN)).toEqual({ ok: false });
  });
});

describe("readSelectionConfirmed: source guarantees", () => {
  const source = readFileSync("features/connections/meta-selection-confirmation.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("is not a server-action module and filters by the Owner set inside the query", () => {
    expect(code).not.toMatch(/["']use server["']/);
    expect(code).toContain('.in("actor_user_id", ownerIds)');
    expect(code).toContain('.from("user_profiles")');
    expect(code).toContain('.eq("role", "owner")');
  });

  it("filters BOTH queries by the tenant", () => {
    expect(code.match(/\.eq\("tenant_id", tenantId\)/g)).toHaveLength(2);
  });
});

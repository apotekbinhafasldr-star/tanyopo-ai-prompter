import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsOf, type AdminPrincipal } from "@/lib/admin/permissions";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  /** Pages of auth users. `pageFn(page)` returns that page's users. */
  pageFn: (_page: number): Array<Record<string, unknown>> => [],
  rows: [] as Array<Record<string, unknown>>,
  superCount: 1,
  failAudit: new Set<string>(),
  events: [] as Array<{ actorId: string; action: string; entityId?: string | null; details?: Record<string, unknown> }>,
  log: [] as string[],
  insertError: false,
  /** Runs right before the first write (insert/update), to simulate a concurrent change. */
  beforeWrite: null as null | (() => void),
}));

vi.mock("@/services/admin-audit", () => ({
  recordAdminAudit: vi.fn(async (e: { actorId: string; action: string }) => {
    h.log.push(e.action);
    if (h.failAudit.has(e.action)) return false;
    h.events.push(e as never);
    return true;
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        listUsers: async ({ page }: { page: number }) => ({ data: { users: h.pageFn(page) }, error: null }),
        getUserById: async () => ({ data: { user: null } }),
      },
    },
    from: () => {
      let op: "select" | "insert" | "update" = "select";
      let head = false;
      let wantRows = false;
      let payload: Row = {};
      const filters: Array<[string, unknown]> = [];
      const q: Record<string, unknown> = {};
      q.select = (_c: string, o?: { head?: boolean }) => {
        head = Boolean(o?.head);
        if (op === "update") wantRows = true;
        return q;
      };
      q.eq = (c: string, v: unknown) => (filters.push([c, v]), q);
      q.is = () => q;
      q.order = () => q;
      q.insert = (row: Row) => ((op = "insert"), (payload = row), q);
      q.update = (row: Row) => ((op = "update"), (payload = row), q);
      q.then = (resolve: (v: unknown) => unknown) => {
        const match = (r: Row) => filters.every(([c, v]) => r[c] === v);
        if (op === "insert") {
          if (h.beforeWrite) {
            const f = h.beforeWrite;
            h.beforeWrite = null;
            f();
          }
          h.log.push("write:insert");
          if (h.insertError || h.rows.some((r) => r.user_id === payload.user_id)) return resolve({ data: null, error: { message: "duplicate key" } });
          h.rows.push({ ...payload });
          return resolve({ data: null, error: null });
        }
        if (op === "update") {
          if (h.beforeWrite) {
            const f = h.beforeWrite;
            h.beforeWrite = null;
            f();
          }
          h.log.push("write:update");
          const hit = h.rows.filter(match);
          hit.forEach((r) => Object.assign(r, payload));
          return resolve({ data: wantRows ? hit.map((r) => ({ user_id: r.user_id })) : null, error: null });
        }
        if (head) return resolve({ data: null, error: null, count: h.superCount });
        return resolve({ data: h.rows.filter(match), error: null });
      };
      return q;
    },
  }),
}));

import { applyStaffChange, USER_SEARCH_LIMIT } from "@/services/staff-admin";

const founder: AdminPrincipal = { userId: "founder", role: "SUPER_ADMIN", permissions: permissionsOf({ role: "SUPER_ADMIN" }) };
const staff: AdminPrincipal = { userId: "s1", role: "STAFF", permissions: permissionsOf({ role: "STAFF", permissions: ["finance.view"] }) };
const CONFIRMED = "2026-01-01T00:00:00Z";
const user = (id: string, email: string, confirmed: string | null = CONFIRMED) => ({ id, email, email_confirmed_at: confirmed });
const grant = (email = "ana@x.id", permissions: string[] = ["finance.view"], isActive = true) => applyStaffChange(founder, { email, permissions, isActive });
const writes = () => h.log.filter((l) => l.startsWith("write:"));

beforeEach(() => {
  const users = [user("founder", "founder@x.id"), user("u2", "Ana@X.id"), user("u3", "pending@x.id", null)];
  h.pageFn = (page) => (page === 1 ? users : []);
  h.rows = [{ user_id: "founder", role: "SUPER_ADMIN", is_active: true }];
  h.superCount = 1;
  h.failAudit = new Set();
  h.events = [];
  h.log = [];
  h.insertError = false;
  h.beforeWrite = null;
});

describe("applyStaffChange: happy path and audit events", () => {
  it("records attempt BEFORE the write and a succeeded outcome AFTER, tied by one attemptId and the actor id", async () => {
    const r = await grant(" ana@x.id ", ["finance.view", "tax.view"]);
    expect(r).toEqual({ ok: true, outcomeLogged: true });
    expect(h.log).toEqual(["staff.access.change.attempt", "write:insert", "staff.access.change.succeeded"]);
    const [attempt, done] = h.events;
    expect(attempt).toMatchObject({ actorId: "founder", entityId: "u2" });
    expect(done).toMatchObject({ actorId: "founder", entityId: "u2" });
    expect(done.details?.outcome).toBe("SUCCEEDED");
    expect(done.details?.attemptId).toBe(attempt.details?.attemptId);
    expect(typeof attempt.details?.attemptId).toBe("string");
    expect(h.rows.find((x) => x.user_id === "u2")).toMatchObject({ role: "STAFF", permissions: ["finance.view", "tax.view"], is_active: true, revoked_at: null, granted_by: "founder" });
  });
  it("updates an existing STAFF row and stamps revoked_at when deactivated", async () => {
    h.rows.push({ user_id: "u2", role: "STAFF", is_active: true, permissions: ["tax.view"] });
    const r = await grant("ana@x.id", ["finance.view"], false);
    expect(r).toEqual({ ok: true, outcomeLogged: true });
    expect(writes()).toEqual(["write:update"]);
    const row = h.rows.find((x) => x.user_id === "u2");
    expect(row).toMatchObject({ is_active: false, permissions: ["finance.view"] });
    expect(typeof row?.revoked_at).toBe("string");
  });
});

describe("applyStaffChange: email must be confirmed (fail closed)", () => {
  it("refuses an unconfirmed account: no audit, no write", async () => {
    expect(await grant("pending@x.id")).toEqual({ ok: false, code: "unconfirmed" });
    expect(h.log).toEqual([]);
    expect(h.rows).toHaveLength(1);
  });
  it("treats a missing email_confirmed_at field as unconfirmed", async () => {
    h.pageFn = () => [{ id: "u9", email: "ana@x.id" }];
    expect(await grant("ana@x.id")).toEqual({ ok: false, code: "unconfirmed" });
    expect(h.log).toEqual([]);
  });
});

describe("applyStaffChange: account search limit", () => {
  const full = (page: number) => Array.from({ length: USER_SEARCH_LIMIT.perPage }, (_, i) => user(`p${page}-${i}`, `n${page}-${i}@x.id`));
  it("says so (fail closed) when the scan ends on a full page without a match", async () => {
    h.pageFn = full;
    expect(await grant("nobody@x.id")).toEqual({ ok: false, code: "search_limit" });
    expect(h.log).toEqual([]);
  });
  it("still finds an account on the last scanned page", async () => {
    h.pageFn = (page) => (page === USER_SEARCH_LIMIT.pages ? [...full(page).slice(1), user("u2", "ana@x.id")] : full(page));
    // last page returned a full page including the match
    expect((await grant("ana@x.id")).ok).toBe(true);
  });
  it("reports not-registered when the scan reaches a short page", async () => {
    h.pageFn = (page) => (page === 3 ? [user("z", "z@x.id")] : full(page));
    expect(await grant("nobody@x.id")).toEqual({ ok: false, code: "unregistered" });
  });
});

describe("applyStaffChange: failures after the attempt is recorded", () => {
  it("write failure: attempt then a FAILED outcome with a code; nothing saved", async () => {
    h.insertError = true;
    expect(await grant()).toEqual({ ok: false, code: "conflict" });
    expect(h.log).toEqual(["staff.access.change.attempt", "write:insert", "staff.access.change.failed"]);
    expect(h.events[1].details).toMatchObject({ outcome: "FAILED", code: "conflict", attemptId: h.events[0].details?.attemptId });
    expect(h.rows).toHaveLength(1);
  });
  it("attempt cannot be recorded: nothing is written", async () => {
    h.failAudit.add("staff.access.change.attempt");
    expect(await grant()).toEqual({ ok: false, code: "audit" });
    expect(writes()).toEqual([]);
  });
  it("outcome cannot be recorded after a successful write: change stays, result says it is unlogged", async () => {
    h.failAudit.add("staff.access.change.succeeded");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await grant()).toEqual({ ok: true, outcomeLogged: false });
    expect(h.rows.some((r) => r.user_id === "u2")).toBe(true);
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/ana@x|x\.id/);
    spy.mockRestore();
  });
  it("failed-outcome record also failing does not change the returned failure", async () => {
    h.insertError = true;
    h.failAudit.add("staff.access.change.failed");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await grant()).toEqual({ ok: false, code: "conflict" });
    spy.mockRestore();
  });
});

describe("applyStaffChange: concurrent changes", () => {
  it("a row inserted by someone else between read and write is a conflict, not an overwrite", async () => {
    h.beforeWrite = () => void h.rows.push({ user_id: "u2", role: "STAFF", is_active: true, permissions: ["tax.view"] });
    expect(await grant()).toEqual({ ok: false, code: "conflict" });
    expect(h.rows.find((r) => r.user_id === "u2")?.permissions).toEqual(["tax.view"]);
    expect(h.events[h.events.length - 1]?.details?.outcome).toBe("FAILED");
  });
  it("a STAFF row promoted to SUPER_ADMIN between read and write is never overwritten", async () => {
    h.rows.push({ user_id: "u2", role: "STAFF", is_active: true, permissions: [] });
    h.beforeWrite = () => void Object.assign(h.rows.find((r) => r.user_id === "u2")!, { role: "SUPER_ADMIN" });
    expect(await grant()).toEqual({ ok: false, code: "conflict" });
    expect(h.rows.find((r) => r.user_id === "u2")?.role).toBe("SUPER_ADMIN");
  });
  it("a row changed by someone else (active flag) between read and write is a conflict", async () => {
    h.rows.push({ user_id: "u2", role: "STAFF", is_active: true, permissions: [] });
    h.beforeWrite = () => void Object.assign(h.rows.find((r) => r.user_id === "u2")!, { is_active: false });
    expect(await grant()).toEqual({ ok: false, code: "conflict" });
  });
  it("two simultaneous grants: one row at most, never a SUPER_ADMIN overwrite, every attempt has exactly one outcome", async () => {
    const results = await Promise.all([grant("ana@x.id", ["finance.view"]), grant("ana@x.id", ["tax.view"])]);
    expect(results.some((r) => r.ok)).toBe(true);
    expect(h.rows.filter((r) => r.user_id === "u2")).toHaveLength(1);
    expect(h.rows.find((r) => r.user_id === "founder")?.role).toBe("SUPER_ADMIN");
    const attempts = h.events.filter((e) => e.action.endsWith(".attempt"));
    for (const a of attempts) {
      const terminal = h.events.filter((e) => e.details?.attemptId === a.details?.attemptId && !e.action.endsWith(".attempt"));
      expect(terminal).toHaveLength(1);
    }
  });
});

describe("applyStaffChange: legacy roles (regression for the role guard)", () => {
  const legacy = (role: string) => h.rows.push({ user_id: "u2", role, is_active: true, permissions: [] });
  it.each(["FINANCE_ADMIN", "FINANCE_VIEWER"])("converts a legacy %s row to STAFF and records previousRole", async (role) => {
    legacy(role);
    const r = await grant("ana@x.id", ["finance.view"]);
    expect(r).toEqual({ ok: true, outcomeLogged: true });
    expect(writes()).toEqual(["write:update"]);
    expect(h.rows.find((x) => x.user_id === "u2")).toMatchObject({ role: "STAFF", permissions: ["finance.view"], granted_by: "founder" });
    expect(h.events[0].details).toMatchObject({ existed: true, previousRole: role });
    expect(h.events[1].details?.outcome).toBe("SUCCEEDED");
  });
  it("a brand-new account records previousRole as null", async () => {
    await grant();
    expect(h.events[0].details?.previousRole).toBeNull();
  });
  it("a legacy row promoted to SUPER_ADMIN between read and write is never overwritten", async () => {
    legacy("FINANCE_ADMIN");
    h.beforeWrite = () => void Object.assign(h.rows.find((r) => r.user_id === "u2")!, { role: "SUPER_ADMIN" });
    expect(await grant()).toEqual({ ok: false, code: "conflict" });
    expect(h.rows.find((r) => r.user_id === "u2")?.role).toBe("SUPER_ADMIN");
    expect(h.events[1].details).toMatchObject({ outcome: "FAILED", code: "conflict" });
  });
  it("a legacy row whose role changed to another role between read and write is a conflict, not an overwrite", async () => {
    legacy("FINANCE_ADMIN");
    h.beforeWrite = () => void Object.assign(h.rows.find((r) => r.user_id === "u2")!, { role: "FINANCE_VIEWER" });
    expect(await grant()).toEqual({ ok: false, code: "conflict" });
    expect(h.rows.find((r) => r.user_id === "u2")?.role).toBe("FINANCE_VIEWER");
  });
  it("a legacy row deactivated by someone else between read and write is a conflict", async () => {
    legacy("FINANCE_VIEWER");
    h.beforeWrite = () => void Object.assign(h.rows.find((r) => r.user_id === "u2")!, { is_active: false });
    expect(await grant()).toEqual({ ok: false, code: "conflict" });
  });
  it("an existing SUPER_ADMIN row is refused before any audit or write (fail closed)", async () => {
    h.rows.push({ user_id: "u2", role: "SUPER_ADMIN", is_active: true });
    expect(await grant("ana@x.id", ["finance.view"])).toEqual({ ok: false, code: "rules" });
    expect(h.log).toEqual([]);
    expect(h.rows.find((r) => r.user_id === "u2")?.role).toBe("SUPER_ADMIN");
  });
  it("an unknown stored role is refused before any audit or write (fail closed)", async () => {
    legacy("OWNER");
    expect(await grant()).toEqual({ ok: false, code: "rules" });
    expect(h.log).toEqual([]);
  });
  it("two simultaneous conversions of a legacy row: never more than one row, never SUPER_ADMIN overwritten, one terminal event per attempt", async () => {
    legacy("FINANCE_ADMIN");
    const results = await Promise.all([grant("ana@x.id", ["finance.view"]), grant("ana@x.id", ["tax.view"])]);
    expect(results.some((r) => r.ok)).toBe(true);
    expect(h.rows.filter((r) => r.user_id === "u2")).toHaveLength(1);
    expect(h.rows.find((r) => r.user_id === "founder")?.role).toBe("SUPER_ADMIN");
    for (const a of h.events.filter((e) => e.action.endsWith(".attempt"))) {
      expect(h.events.filter((e) => e.details?.attemptId === a.details?.attemptId && !e.action.endsWith(".attempt"))).toHaveLength(1);
    }
  });
});

describe("applyStaffChange: existing protections are kept", () => {
  it("refuses everything for someone without staff.manage", async () => {
    expect((await applyStaffChange(staff, { email: "ana@x.id", permissions: ["finance.view"], isActive: true })).ok).toBe(false);
    expect(writes()).toEqual([]);
  });
  it("never grants Founder-only permissions", async () => {
    for (const p of ["refund.approve", "staff.manage", "tax.optimization.approve"]) expect((await grant("ana@x.id", [p])).ok).toBe(false);
    expect(writes()).toEqual([]);
  });
  it("rejects unknown permissions, bad emails and unregistered accounts", async () => {
    expect((await grant("ana@x.id", ["hack.all"])).ok).toBe(false);
    expect((await grant("bukan-email")).ok).toBe(false);
    expect((await grant("nobody@x.id")).ok).toBe(false);
    expect(writes()).toEqual([]);
  });
  it("cannot change a Super Admin or itself", async () => {
    expect((await grant("founder@x.id")).ok).toBe(false);
    expect(writes()).toEqual([]);
  });
});

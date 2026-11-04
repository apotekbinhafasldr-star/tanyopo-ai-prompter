import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsOf, type AdminPrincipal } from "@/lib/admin/permissions";

const h = vi.hoisted(() => ({
  users: [] as Array<{ id: string; email: string }>,
  rows: [] as Array<Record<string, unknown>>,
  superCount: 1,
  auditOk: true,
  order: [] as string[],
  upserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/services/admin-audit", () => ({
  recordAdminAudit: vi.fn(async () => {
    h.order.push("audit");
    return h.auditOk;
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: h.users }, error: null }),
        getUserById: async (id: string) => ({ data: { user: h.users.find((u) => u.id === id) ?? null } }),
      },
    },
    from: () => {
      const q: Record<string, unknown> = {};
      let head = false;
      let user: string | null = null;
      q.select = (_c: string, o?: { head?: boolean }) => {
        head = Boolean(o?.head);
        return q;
      };
      q.eq = (c: string, v: unknown) => {
        if (c === "user_id") user = String(v);
        return q;
      };
      q.is = () => q;
      q.order = () => q;
      q.upsert = (row: Record<string, unknown>) => {
        h.order.push("write");
        h.upserts.push(row);
        return Promise.resolve({ data: null, error: null });
      };
      q.then = (resolve: (v: unknown) => unknown) =>
        resolve(head ? { data: null, error: null, count: h.superCount } : { data: user ? h.rows.filter((r) => r.user_id === user) : h.rows, error: null });
      return q;
    },
  }),
}));

import { applyStaffChange } from "@/services/staff-admin";

const founder: AdminPrincipal = { userId: "founder", role: "SUPER_ADMIN", permissions: permissionsOf({ role: "SUPER_ADMIN" }) };
const staff: AdminPrincipal = { userId: "s1", role: "STAFF", permissions: permissionsOf({ role: "STAFF", permissions: ["finance.view"] }) };

beforeEach(() => {
  h.users = [
    { id: "founder", email: "founder@x.id" },
    { id: "u2", email: "Ana@X.id" },
  ];
  h.rows = [{ user_id: "founder", role: "SUPER_ADMIN", is_active: true }];
  h.superCount = 1;
  h.auditOk = true;
  h.order = [];
  h.upserts = [];
});

describe("applyStaffChange", () => {
  it("grants permissions to a registered account: audit first, then one write as STAFF", async () => {
    const r = await applyStaffChange(founder, { email: " ana@x.id ", permissions: ["finance.view", "tax.view"], isActive: true });
    expect(r).toEqual({ ok: true });
    expect(h.order).toEqual(["audit", "write"]);
    expect(h.upserts[0]).toMatchObject({ user_id: "u2", role: "STAFF", permissions: ["finance.view", "tax.view"], is_active: true, revoked_at: null, granted_by: "founder" });
  });
  it("refuses everything for someone without staff.manage", async () => {
    const r = await applyStaffChange(staff, { email: "ana@x.id", permissions: ["finance.view"], isActive: true });
    expect(r.ok).toBe(false);
    expect(h.upserts).toHaveLength(0);
  });
  it("never grants Founder-only permissions", async () => {
    for (const p of ["refund.approve", "staff.manage", "tax.optimization.approve"]) {
      const r = await applyStaffChange(founder, { email: "ana@x.id", permissions: [p], isActive: true });
      expect(r.ok).toBe(false);
    }
    expect(h.upserts).toHaveLength(0);
  });
  it("rejects unknown permissions, bad emails and unregistered accounts", async () => {
    expect((await applyStaffChange(founder, { email: "ana@x.id", permissions: ["hack.all"], isActive: true })).ok).toBe(false);
    expect((await applyStaffChange(founder, { email: "bukan-email", permissions: [], isActive: true })).ok).toBe(false);
    expect((await applyStaffChange(founder, { email: "nobody@x.id", permissions: [], isActive: true })).ok).toBe(false);
    expect(h.upserts).toHaveLength(0);
  });
  it("cannot change a Super Admin or itself", async () => {
    const r = await applyStaffChange(founder, { email: "founder@x.id", permissions: ["finance.view"], isActive: true });
    expect(r.ok).toBe(false);
    expect(h.upserts).toHaveLength(0);
  });
  it("aborts without writing when the audit log cannot be written", async () => {
    h.auditOk = false;
    const r = await applyStaffChange(founder, { email: "ana@x.id", permissions: ["finance.view"], isActive: true });
    expect(r.ok).toBe(false);
    expect(h.upserts).toHaveLength(0);
  });
  it("deactivating stamps revoked_at", async () => {
    await applyStaffChange(founder, { email: "ana@x.id", permissions: ["finance.view"], isActive: false });
    expect(h.upserts[0].is_active).toBe(false);
    expect(typeof h.upserts[0].revoked_at).toBe("string");
  });
});

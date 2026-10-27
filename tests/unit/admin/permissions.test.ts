import { describe, expect, it } from "vitest";
import {
  AdminAccessError,
  GRANTABLE_PERMISSIONS,
  PERMISSIONS,
  authorizePermission,
  can,
  evaluateStaffChange,
  permissionsOf,
  type AdminPrincipal,
  type PlatformAdminRecord,
  type PlatformRole,
} from "@/lib/admin/permissions";
import { ADMIN_NAV_ITEMS, activeAdminHref, visibleAdminNav } from "@/lib/admin/nav";
import { FinanceAccessError, authorizeFinanceAction } from "@/lib/finance/admin-access";
import { formatRupiah, monthLabel, shortDate } from "@/lib/admin/format";
import { money } from "@/lib/finance";

const rec = (over: Partial<PlatformAdminRecord> = {}): PlatformAdminRecord => ({
  userId: "u1",
  role: "STAFF",
  isActive: true,
  revokedAt: null,
  permissions: [],
  ...over,
});

const principal = (role: PlatformRole, permissions: string[] = [], userId = "actor"): AdminPrincipal => ({
  userId,
  role,
  permissions: permissionsOf({ role, permissions }),
});

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as AdminAccessError).code;
  }
  return "NO_ERROR";
}

describe("roles and permissions", () => {
  it("Super Admin holds every permission, including staff management", () => {
    expect([...permissionsOf({ role: "SUPER_ADMIN" })].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("STAFF holds only what was granted (plus overview) and ignores unknown or ungrantable strings", () => {
    const perms = permissionsOf({ role: "STAFF", permissions: ["finance.view", "staff.manage", "root", "tax.view"] });
    expect([...perms].sort()).toEqual(["admin.overview", "finance.view", "tax.view"]);
    expect(permissionsOf({ role: "STAFF", permissions: [] }).size).toBe(0);
    expect(permissionsOf({ role: "STAFF" }).size).toBe(0);
  });

  it("a tenant owner role, or any unknown role, holds nothing", () => {
    expect(permissionsOf({ role: "owner" }).size).toBe(0);
    expect(permissionsOf({ role: "marketing" }).size).toBe(0);
    expect(permissionsOf({ role: "super_admin" }).size).toBe(0);
  });

  it("the legacy PR #61 roles keep their finance sets and cannot manage staff or banks", () => {
    const admin = permissionsOf({ role: "FINANCE_ADMIN" });
    const viewer = permissionsOf({ role: "FINANCE_VIEWER" });
    expect(admin.has("finance.expense.write")).toBe(true);
    expect(admin.has("staff.manage")).toBe(false);
    expect(admin.has("bank.manage")).toBe(false);
    expect(viewer.has("finance.view")).toBe(true);
    expect(viewer.has("finance.expense.write")).toBe(false);
    expect(viewer.has("refund.approve")).toBe(false);
  });

  it("an employee cannot approve a refund or change the bank account unless explicitly granted", () => {
    const staff = permissionsOf({ role: "STAFF", permissions: ["finance.view", "finance.export", "tax.view"] });
    expect(staff.has("refund.approve")).toBe(false);
    expect(staff.has("bank.manage")).toBe(false);
    // Founder-only at the initial stage: even an explicit grant is ignored.
    const granted = permissionsOf({ role: "STAFF", permissions: ["refund.approve", "finance.view"] });
    expect(granted.has("refund.approve")).toBe(false);
    expect(granted.has("finance.view")).toBe(true);
    expect(permissionsOf({ role: "SUPER_ADMIN" }).has("refund.approve")).toBe(true);
    expect(permissionsOf({ role: "FINANCE_ADMIN" }).has("refund.approve")).toBe(false);
    expect(evaluateStaffChange(principal("SUPER_ADMIN", [], "founder"), null, { role: "STAFF", permissions: ["refund.approve"], isActive: true }, 1).ok).toBe(false);
  });

  it("staff.manage can never be granted", () => {
    expect(GRANTABLE_PERMISSIONS).not.toContain("staff.manage");
  });

  it("tax optimization: view is grantable, final approval is Founder-only, legacy finance roles get neither", () => {
    expect(GRANTABLE_PERMISSIONS).toContain("tax.optimization.view");
    expect(GRANTABLE_PERMISSIONS).not.toContain("tax.optimization.approve");
    expect(permissionsOf({ role: "SUPER_ADMIN" }).has("tax.optimization.approve")).toBe(true);
    for (const role of ["FINANCE_ADMIN", "FINANCE_VIEWER"] as const) {
      expect(permissionsOf({ role }).has("tax.optimization.view")).toBe(false);
      expect(permissionsOf({ role }).has("tax.optimization.approve")).toBe(false);
    }
    expect(permissionsOf({ role: "STAFF", permissions: ["tax.optimization.approve"] }).has("tax.optimization.approve")).toBe(false);
    expect(permissionsOf({ role: "STAFF", permissions: ["tax.optimization.view"] }).has("tax.optimization.view")).toBe(true);
  });
});

describe("authorizePermission — non-admin access is rejected", () => {
  it("rejects a signed-out caller", () => {
    expect(codeOf(() => authorizePermission(null, rec(), "admin.overview"))).toBe("UNAUTHENTICATED");
    expect(codeOf(() => authorizePermission(undefined, rec(), "admin.overview"))).toBe("UNAUTHENTICATED");
  });

  it("rejects a signed-in customer with no admin record", () => {
    expect(codeOf(() => authorizePermission("customer", null, "admin.overview"))).toBe("FORBIDDEN");
  });

  it("rejects inactive, revoked, someone else's and unknown-role records", () => {
    const s = rec({ role: "SUPER_ADMIN" });
    expect(codeOf(() => authorizePermission("u1", { ...s, isActive: false }, "admin.overview"))).toBe("FORBIDDEN");
    expect(codeOf(() => authorizePermission("u1", { ...s, revokedAt: "2026-10-01T00:00:00Z" }, "admin.overview"))).toBe("FORBIDDEN");
    expect(codeOf(() => authorizePermission("u1", { ...s, userId: "u2" }, "admin.overview"))).toBe("FORBIDDEN");
    expect(codeOf(() => authorizePermission("u1", { ...s, role: "owner" }, "admin.overview"))).toBe("FORBIDDEN");
  });

  it("a STAFF with no grants cannot even open the overview", () => {
    expect(codeOf(() => authorizePermission("u1", rec(), "admin.overview"))).toBe("FORBIDDEN");
  });

  it("a STAFF is limited to the modules granted", () => {
    const r = rec({ permissions: ["finance.view"] });
    expect(authorizePermission("u1", r, "finance.view").role).toBe("STAFF");
    expect(authorizePermission("u1", r, "admin.overview").userId).toBe("u1");
    expect(codeOf(() => authorizePermission("u1", r, "tax.view"))).toBe("FORBIDDEN");
    expect(codeOf(() => authorizePermission("u1", r, "staff.view"))).toBe("FORBIDDEN");
    expect(codeOf(() => authorizePermission("u1", r, "refund.approve"))).toBe("FORBIDDEN");
  });

  it("the Super Admin is identified by the database row only, never by an email address", () => {
    // The record carries no email field at all, and a "super admin"-looking user id grants nothing.
    expect(codeOf(() => authorizePermission("founder@example.com", null, "admin.overview"))).toBe("FORBIDDEN");
  });

  it("finance actions go through the same model (STAFF without grant is rejected, SUPER_ADMIN is allowed)", () => {
    expect(authorizeFinanceAction("u1", rec({ role: "SUPER_ADMIN" }), "RECORD_REFUND").role).toBe("SUPER_ADMIN");
    expect(() => authorizeFinanceAction("u1", rec(), "VIEW_DASHBOARD")).toThrow(FinanceAccessError);
    expect(authorizeFinanceAction("u1", rec({ permissions: ["finance.view"] }), "VIEW_DASHBOARD").role).toBe("STAFF");
    expect(() => authorizeFinanceAction("u1", rec({ permissions: ["finance.view"] }), "RECORD_REFUND")).toThrow(FinanceAccessError);
  });
});

describe("evaluateStaffChange — no self-promotion", () => {
  const sa = principal("SUPER_ADMIN", [], "founder");
  const target = { userId: "emp", role: "STAFF" as const, isActive: true };
  const change = { role: "STAFF" as const, permissions: ["finance.view"], isActive: true };

  it("a Super Admin may grant ordinary permissions to another employee", () => {
    expect(evaluateStaffChange(sa, target, change, 1)).toEqual({ ok: true });
  });

  it("an employee cannot change anyone's access", () => {
    const staff = principal("STAFF", ["finance.view", "tax.manage", "refund.approve"], "emp");
    expect(evaluateStaffChange(staff, { ...target, userId: "other" }, change, 1).ok).toBe(false);
  });

  it("nobody can change their own access or make themselves Super Admin", () => {
    const staff = principal("STAFF", ["finance.view"], "emp");
    expect(evaluateStaffChange(staff, target, { ...change, role: "SUPER_ADMIN" }, 1).ok).toBe(false);
    expect(evaluateStaffChange(sa, { ...target, userId: "founder", role: "SUPER_ADMIN" }, change, 1).ok).toBe(false);
  });

  it("a new Super Admin cannot be created from the app", () => {
    const r = evaluateStaffChange(sa, target, { ...change, role: "SUPER_ADMIN" }, 1);
    expect(r.ok).toBe(false);
  });

  it("an existing Super Admin cannot be edited from the app", () => {
    expect(evaluateStaffChange(sa, { userId: "sa2", role: "SUPER_ADMIN", isActive: true }, change, 2).ok).toBe(false);
  });

  it("staff.manage and unknown permissions cannot be granted", () => {
    expect(evaluateStaffChange(sa, target, { ...change, permissions: ["staff.manage"] }, 1).ok).toBe(false);
    expect(evaluateStaffChange(sa, target, { ...change, permissions: ["root"] }, 1).ok).toBe(false);
  });

  it("requires at least one active Super Admin", () => {
    expect(evaluateStaffChange(sa, target, change, 0).ok).toBe(false);
  });

  it("a legacy finance admin cannot manage staff", () => {
    expect(evaluateStaffChange(principal("FINANCE_ADMIN", [], "fa"), target, change, 1).ok).toBe(false);
  });
});

describe("navigation model", () => {
  it("shows the Super Admin every section", () => {
    expect(visibleAdminNav(principal("SUPER_ADMIN")).map((i) => i.href)).toEqual(ADMIN_NAV_ITEMS.map((i) => i.href));
  });

  it("shows an employee only the sections granted", () => {
    const nav = visibleAdminNav(principal("STAFF", ["finance.view"]));
    expect(nav.map((i) => i.href)).toEqual(["/admin", "/admin/finance"]);
    expect(can(principal("STAFF", ["finance.view"]), "tax.view")).toBe(false);
  });

  it("highlights the most specific section", () => {
    const items = ADMIN_NAV_ITEMS;
    expect(activeAdminHref("/admin", items)).toBe("/admin");
    expect(activeAdminHref("/admin/finance", items)).toBe("/admin/finance");
    expect(activeAdminHref("/admin/finance/tax", items)).toBe("/admin/finance/tax");
    expect(activeAdminHref("/admin/staff", items)).toBe("/admin/staff");
    expect(activeAdminHref("/dashboard", items)).toBeNull();
  });
});

describe("formatting (exact, no floating point)", () => {
  it("formats rupiah with Indonesian grouping", () => {
    expect(formatRupiah(money("1234567", "IDR"))).toBe("Rp 1.234.567");
    expect(formatRupiah(money("1234.5", "IDR"))).toBe("Rp 1.234,50");
    expect(formatRupiah(money("-4000", "IDR"))).toBe("-Rp 4.000");
    expect(formatRupiah(money("0", "IDR"))).toBe("Rp 0");
  });

  it("labels months and dates", () => {
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(monthLabel("nope")).toBe("nope");
    expect(shortDate("2026-11-04")).toBe("4 Nov 2026");
  });
});

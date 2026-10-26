import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceAccessError, authorizeFinanceAction, roleCan, type PlatformAdminRecord } from "@/lib/finance/admin-access";

const getUser = vi.fn();
const maybeSingle = vi.fn();
const adminHolder: { client: unknown } = { client: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminHolder.client,
}));

import { requireFinanceAdmin, withFinanceAdmin } from "@/services/finance-admin";

const record = (over: Partial<PlatformAdminRecord> = {}): PlatformAdminRecord => ({
  userId: "u1",
  role: "FINANCE_ADMIN",
  isActive: true,
  revokedAt: null,
  ...over,
});

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as FinanceAccessError).code;
  }
  return "NO_ERROR";
}

describe("authorizeFinanceAction (pure rules)", () => {
  it("rejects an unauthenticated caller", () => {
    expect(codeOf(() => authorizeFinanceAction(null, record(), "VIEW_DASHBOARD"))).toBe("UNAUTHENTICATED");
  });

  it("rejects a signed-in user with no admin record (a tenant owner is not a platform finance admin)", () => {
    expect(codeOf(() => authorizeFinanceAction("tenant-owner", null, "VIEW_DASHBOARD"))).toBe("FORBIDDEN");
  });

  it("rejects inactive, revoked, someone else's and unknown-role records", () => {
    expect(codeOf(() => authorizeFinanceAction("u1", record({ isActive: false }), "VIEW_DASHBOARD"))).toBe("FORBIDDEN");
    expect(codeOf(() => authorizeFinanceAction("u1", record({ revokedAt: "2026-10-01T00:00:00Z" }), "VIEW_DASHBOARD"))).toBe("FORBIDDEN");
    expect(codeOf(() => authorizeFinanceAction("u1", record({ userId: "u2" }), "VIEW_DASHBOARD"))).toBe("FORBIDDEN");
    expect(codeOf(() => authorizeFinanceAction("u1", record({ role: "owner" }), "VIEW_DASHBOARD"))).toBe("FORBIDDEN");
  });

  it("a viewer can read and export but cannot write", () => {
    const viewer = record({ role: "FINANCE_VIEWER" });
    expect(authorizeFinanceAction("u1", viewer, "VIEW_DASHBOARD").role).toBe("FINANCE_VIEWER");
    expect(authorizeFinanceAction("u1", viewer, "EXPORT_CSV").role).toBe("FINANCE_VIEWER");
    expect(codeOf(() => authorizeFinanceAction("u1", viewer, "RECORD_EXPENSE"))).toBe("FORBIDDEN");
    expect(roleCan("FINANCE_VIEWER", "MANAGE_TAX_SETTINGS")).toBe(false);
    expect(roleCan("FINANCE_ADMIN", "MANAGE_TAX_SETTINGS")).toBe(true);
  });
});

describe("requireFinanceAdmin (server gate)", () => {
  beforeEach(() => {
    getUser.mockReset();
    maybeSingle.mockReset();
    adminHolder.client = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    };
  });

  it("rejects when nobody is signed in, without touching the database", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireFinanceAdmin("VIEW_DASHBOARD")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("rejects a non-admin user (no row)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(requireFinanceAdmin("VIEW_DASHBOARD")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails closed when the lookup errors", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(requireFinanceAdmin("VIEW_DASHBOARD")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails closed when the service key is not configured", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    adminHolder.client = null;
    await expect(requireFinanceAdmin("VIEW_DASHBOARD")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("admits an active admin and passes the service client only to the callback", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue({
      data: { user_id: "u1", role: "FINANCE_ADMIN", is_active: true, revoked_at: null },
      error: null,
    });
    const ctx = await requireFinanceAdmin("RECORD_EXPENSE");
    expect(ctx).toEqual({ userId: "u1", role: "FINANCE_ADMIN" });
    const seen = await withFinanceAdmin("VIEW_DASHBOARD", async (c, client) => ({ role: c.role, hasClient: client !== null }));
    expect(seen).toEqual({ role: "FINANCE_ADMIN", hasClient: true });
    expect(JSON.stringify(ctx)).not.toMatch(/secret|key/i);
  });

  it("does not run the callback for a non-admin", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const fn = vi.fn();
    await expect(withFinanceAdmin("VIEW_DASHBOARD", fn)).rejects.toBeInstanceOf(FinanceAccessError);
    expect(fn).not.toHaveBeenCalled();
  });
});

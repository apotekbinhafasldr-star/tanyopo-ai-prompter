import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const maybeSingle = vi.fn();
const createClientMock = vi.fn();
const adminHolder: { client: unknown } = { client: null };

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    createClientMock();
    return { auth: { getUser } };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminHolder.client }));

import { canSeeAdminCenterLink, requireAdminPage, requireAdminPermission } from "@/services/platform-admin";

const adminRow = (over: Record<string, unknown> = {}) => ({
  data: { user_id: "u1", role: "SUPER_ADMIN", is_active: true, revoked_at: null, permissions: [], ...over },
  error: null,
});

beforeEach(() => {
  getUser.mockReset();
  maybeSingle.mockReset();
  createClientMock.mockReset();
  adminHolder.client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) };
  vi.stubEnv("ADMIN_CENTER_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("requireAdminPermission", () => {
  it("rejects when nobody is signed in, without touching the admin table", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireAdminPermission("admin.overview")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("rejects a customer (no admin row)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "customer" } } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(requireAdminPermission("admin.overview")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails closed on a lookup error, such as the table not existing yet", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'relation "finance_platform_admins" does not exist' } });
    await expect(requireAdminPermission("admin.overview")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails closed when the service key is missing", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    adminHolder.client = null;
    await expect(requireAdminPermission("admin.overview")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("takes identity from the session, so a row for another user is never trusted", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "attacker" } } });
    maybeSingle.mockResolvedValue(adminRow({ user_id: "u1" }));
    await expect(requireAdminPermission("admin.overview")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admits a Super Admin and honours a STAFF member's granted permissions only", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue(adminRow());
    expect((await requireAdminPermission("staff.manage")).role).toBe("SUPER_ADMIN");

    maybeSingle.mockResolvedValue(adminRow({ role: "STAFF", permissions: ["finance.view"] }));
    expect((await requireAdminPermission("finance.view")).role).toBe("STAFF");
    await expect(requireAdminPermission("tax.view")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireAdminPermission("staff.view")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("never returns the service client or any key in the principal", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue(adminRow());
    const p = await requireAdminPermission("admin.overview");
    expect(Object.keys(p).sort()).toEqual(["permissions", "role", "userId"]);
  });
});

describe("requireAdminPage — customers, employees and misconfiguration all see a 404", () => {
  it("is a 404 when the Admin Center is switched off, before any database work", async () => {
    vi.stubEnv("ADMIN_CENTER_ENABLED", "");
    await expect(requireAdminPage("admin.overview")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("is a 404 for any value other than exactly 'true'", async () => {
    for (const v of ["1", "TRUE", "yes", "false"]) {
      vi.stubEnv("ADMIN_CENTER_ENABLED", v);
      await expect(requireAdminPage("admin.overview")).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("is a 404 for a customer and for an unprivileged employee", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(requireAdminPage("admin.overview")).rejects.toThrow("NEXT_NOT_FOUND");
    maybeSingle.mockResolvedValue(adminRow({ role: "STAFF", permissions: [] }));
    await expect(requireAdminPage("admin.overview")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is a 404 for a signed-out visitor and when the lookup breaks", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireAdminPage("finance.view")).rejects.toThrow("NEXT_NOT_FOUND");
    getUser.mockRejectedValue(new Error("boom"));
    await expect(requireAdminPage("finance.view")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("returns the principal for an authorised admin", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue(adminRow());
    expect((await requireAdminPage("finance.view")).userId).toBe("u1");
  });
});

describe("canSeeAdminCenterLink — the 'Admin Perusahaan' button", () => {
  it("is hidden and does no database work while the Admin Center is off", async () => {
    vi.stubEnv("ADMIN_CENTER_ENABLED", "");
    expect(await canSeeAdminCenterLink()).toBe(false);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("is hidden for customers, tenant owners, signed-out visitors and employees without access", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await canSeeAdminCenterLink()).toBe(false);
    maybeSingle.mockResolvedValue(adminRow({ role: "owner" }));
    expect(await canSeeAdminCenterLink()).toBe(false);
    maybeSingle.mockResolvedValue(adminRow({ role: "STAFF", permissions: [] }));
    expect(await canSeeAdminCenterLink()).toBe(false);
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await canSeeAdminCenterLink()).toBe(false);
  });

  it("never throws, even when the lookup fails", async () => {
    getUser.mockRejectedValue(new Error("boom"));
    await expect(canSeeAdminCenterLink()).resolves.toBe(false);
  });

  it("is shown to an authorised platform admin", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue(adminRow());
    expect(await canSeeAdminCenterLink()).toBe(true);
    maybeSingle.mockResolvedValue(adminRow({ role: "STAFF", permissions: ["tax.view"] }));
    expect(await canSeeAdminCenterLink()).toBe(true);
  });
});

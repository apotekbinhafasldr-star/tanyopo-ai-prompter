import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { permissionsOf, type AdminPrincipal } from "@/lib/admin/permissions";

const h = vi.hoisted(() => ({ principal: null as AdminPrincipal | null, flag: true, applied: [] as unknown[] }));

vi.mock("@/lib/admin/flag", () => ({ isAdminCenterEnabled: () => h.flag }));
vi.mock("@/services/platform-admin", () => ({
  requireAdminPermission: vi.fn(async (p: string) => {
    if (!h.principal || !h.principal.permissions.has(p as never)) throw new Error("FORBIDDEN");
    return h.principal;
  }),
}));
vi.mock("@/services/staff-admin", () => ({
  applyStaffChange: vi.fn(async (_a: unknown, input: unknown) => {
    h.applied.push(input);
    return { ok: true };
  }),
}));

import { POST } from "@/app/admin/staff/save/route";
import * as route from "@/app/admin/staff/save/route";

const as = (role: "SUPER_ADMIN" | "STAFF", permissions: string[] = []) => {
  h.principal = { userId: `u-${role}`, role, permissions: permissionsOf({ role, permissions }) };
};
const req = (fields: Array<[string, string]>, origin: string | null = "http://localhost") => {
  const body = new URLSearchParams(fields);
  return new NextRequest("http://localhost/admin/staff/save", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}) },
    body,
  });
};

beforeEach(() => {
  h.principal = null;
  h.flag = true;
  h.applied = [];
});

describe("staff save route", () => {
  it("is 404 with the flag off, with no/foreign origin, and for anyone without staff.manage", async () => {
    as("SUPER_ADMIN");
    h.flag = false;
    expect((await POST(req([["email", "a@b.id"]]))).status).toBe(404);
    h.flag = true;
    expect((await POST(req([["email", "a@b.id"]], null))).status).toBe(404);
    expect((await POST(req([["email", "a@b.id"]], "https://evil.example"))).status).toBe(404);
    as("STAFF", ["staff.view", "finance.view"]);
    expect((await POST(req([["email", "a@b.id"]]))).status).toBe(404);
    h.principal = null;
    expect((await POST(req([["email", "a@b.id"]]))).status).toBe(404);
    expect(h.applied).toHaveLength(0);
  });
  it("the Founder saves and is redirected with a fixed code", async () => {
    as("SUPER_ADMIN");
    const res = await POST(req([["email", "a@b.id"], ["permissions", "finance.view"], ["isActive", "on"]]));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost/admin/staff?r=ok");
    expect(h.applied).toEqual([{ email: "a@b.id", permissions: ["finance.view"], isActive: true }]);
  });
  it("refuses Founder-only permissions before touching the service", async () => {
    as("SUPER_ADMIN");
    const res = await POST(req([["email", "a@b.id"], ["permissions", "refund.approve"]]));
    expect(res.headers.get("location")).toBe("http://localhost/admin/staff?r=permission");
    expect(h.applied).toHaveLength(0);
  });
  it("exports POST only", () => {
    for (const m of ["GET", "PUT", "PATCH", "DELETE"]) expect((route as Record<string, unknown>)[m]).toBeUndefined();
  });
});

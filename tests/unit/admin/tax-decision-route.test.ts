import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ flag: true, allowed: true, record: vi.fn() }));
vi.mock("@/lib/admin/flag", () => ({ isAdminCenterEnabled: () => h.flag }));
vi.mock("@/services/platform-admin", () => ({
  requireAdminPermission: vi.fn(async (perm: string) => {
    if (!h.allowed || perm !== "tax.optimization.approve") throw new Error("NEXT_NOT_FOUND");
    return { userId: "11111111-1111-4111-8111-111111111111", role: "SUPER_ADMIN", permissions: new Set([perm]) };
  }),
}));
vi.mock("@/services/tax-optimization-approvals", () => ({ createDecisionStore: () => ({ record: h.record }) }));

import { NextRequest } from "next/server";
import * as route from "@/app/admin/finance/tax/optimization/decision/route";

const URL_ = "https://linoe.test/admin/finance/tax/optimization/decision";
const req = (body: unknown, origin: string | null = "https://linoe.test", raw?: string) =>
  new NextRequest(URL_, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: raw ?? JSON.stringify(body) });
const good = { recommendationType: "SCHEME_SELECTION", decision: "APPROVED", items: ["PASAL_31E"], reason: "Sudah ditinjau akuntan.", requestId: "22222222-2222-4222-8222-222222222222", viewedCalcHash: "a".repeat(64), viewedRulesVersion: "x", expectedSeq: 0 };

beforeEach(() => { h.flag = true; h.allowed = true; h.record.mockReset(); });

describe("decision route", () => {
  it("exports POST only", () => {
    expect(Object.keys(route).filter((k) => ["GET", "PUT", "PATCH", "DELETE", "POST"].includes(k))).toEqual(["POST"]);
  });
  it("404 when the flag is off, origin is missing or foreign, or the caller lacks tax.optimization.approve", async () => {
    h.flag = false;
    expect((await route.POST(req(good))).status).toBe(404);
    h.flag = true;
    expect((await route.POST(req(good, null))).status).toBe(404);
    expect((await route.POST(req(good, "https://evil.test"))).status).toBe(404);
    h.allowed = false;
    expect((await route.POST(req(good))).status).toBe(404);
    expect(h.record).not.toHaveBeenCalled();
  });
  it("400 for malformed bodies and unknown decision types", async () => {
    expect((await route.POST(req(null, "https://linoe.test", "not json"))).status).toBe(400);
    expect((await route.POST(req([1]))).status).toBe(400);
    expect((await route.POST(req({ ...good, decision: "FORCE" }))).status).toBe(400);
    expect((await route.POST(req({ ...good, recommendationType: "X" }))).status).toBe(400);
  });
  it("DEMO data is never stored, and a body cannot name the approver", async () => {
    const res = await route.POST(req({ ...good, actor: "99999999-9999-4999-8999-999999999999", p_actor: "x" }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("DEMO");
    expect(h.record).not.toHaveBeenCalled();
  });
});

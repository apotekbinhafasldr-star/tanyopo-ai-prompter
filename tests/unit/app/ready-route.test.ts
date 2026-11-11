import { afterEach, describe, expect, it, vi } from "vitest";

const checkReadiness = vi.fn();
vi.mock("@/lib/health/readiness", () => ({ checkReadiness: (...a: unknown[]) => checkReadiness(...a) }));

import { GET } from "@/app/api/ready/route";

afterEach(() => checkReadiness.mockReset());

describe("GET /api/ready", () => {
  it("returns 200 with exactly {status:'ok'} and no-store when the database is reachable", async () => {
    checkReadiness.mockResolvedValue("ok");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns 503 with exactly {status:'degraded'} and no detail when it is not", async () => {
    checkReadiness.mockResolvedValue("degraded");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "degraded" });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { checkReadiness, type ReadinessProbe } from "@/lib/health/readiness";

afterEach(() => vi.useRealTimers());

describe("checkReadiness", () => {
  it("is ok when the query succeeds", async () => {
    const probe: ReadinessProbe = async () => ({ error: null });
    expect(await checkReadiness(probe)).toBe("ok");
  });

  it("is ok when Postgres answers with permission denied (database is up, RLS blocks anon)", async () => {
    const probe: ReadinessProbe = async () => ({ error: { code: "42501" } });
    expect(await checkReadiness(probe)).toBe("ok");
  });

  it("is degraded on any other database/API error, returning only the status string (no detail)", async () => {
    const probe: ReadinessProbe = async () => ({
      error: { code: "PGRST002", message: "secret-project-ref.supabase.co down" } as { code?: string },
    });
    const result = await checkReadiness(probe);
    expect(result).toBe("degraded");
    expect(JSON.stringify(result)).not.toContain("supabase");
  });

  it("is degraded when the probe throws", async () => {
    const probe: ReadinessProbe = async () => {
      throw new Error("ECONNREFUSED 10.0.0.1");
    };
    expect(await checkReadiness(probe)).toBe("degraded");
  });

  it("is degraded when the probe hangs past the timeout, and aborts it", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const probe: ReadinessProbe = (signal) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise(() => {});
    };
    const pending = checkReadiness(probe, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBe("degraded");
    expect(aborted).toBe(true);
  });

  it("is degraded when Supabase is not configured (no env), without throwing", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    try {
      expect(await checkReadiness()).toBe("degraded");
    } finally {
      if (url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      if (key !== undefined) process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
    }
  });
});

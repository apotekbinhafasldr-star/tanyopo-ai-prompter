import { describe, expect, it, vi, beforeEach } from "vitest";
import { __resetRateLimitStateForTests } from "@/lib/rate-limit";

const rpcMock = vi.fn();
const createAdminClientMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createAdminClientMock(),
}));

import { checkAndConsumeDemoAiUsage, DEMO_AI_HARD_CAP } from "@/lib/demo/ai-usage";

describe("checkAndConsumeDemoAiUsage — Founder hard-cap/rate-limit/fail-closed requirement", () => {
  beforeEach(() => {
    __resetRateLimitStateForTests();
    rpcMock.mockReset();
    createAdminClientMock.mockReset();
    createAdminClientMock.mockReturnValue({ rpc: rpcMock });
  });

  it("fails closed when the admin client is not configured (no SUPABASE_SECRET_KEY)", async () => {
    createAdminClientMock.mockReturnValue(null);
    const result = await checkAndConsumeDemoAiUsage("session-a");
    expect(result).toEqual({ allowed: false, reason: "NOT_CONFIGURED" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed on a database error rather than allowing an unmetered call", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("db down") });
    const result = await checkAndConsumeDemoAiUsage("session-b");
    expect(result).toEqual({ allowed: false, reason: "DB_ERROR" });
  });

  it("allows the call when the RPC reports the session is under the hard cap", async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: true, used_count: 1 }], error: null });
    const result = await checkAndConsumeDemoAiUsage("session-c");
    expect(result).toEqual({ allowed: true });
    expect(rpcMock).toHaveBeenCalledWith("fn_consume_demo_ai_usage", {
      p_session_id: "session-c",
      p_hard_cap: DEMO_AI_HARD_CAP,
    });
  });

  it("denies the call once the RPC reports the hard cap is reached", async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: false, used_count: DEMO_AI_HARD_CAP + 1 }], error: null });
    const result = await checkAndConsumeDemoAiUsage("session-d");
    expect(result).toEqual({ allowed: false, reason: "HARD_CAP_REACHED" });
  });

  it("denies a burst of calls from the same session within the short window before ever reaching the database", async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: true, used_count: 1 }], error: null });

    const first = await checkAndConsumeDemoAiUsage("session-e");
    const second = await checkAndConsumeDemoAiUsage("session-e");
    const third = await checkAndConsumeDemoAiUsage("session-e");

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third).toEqual({ allowed: false, reason: "BURST_LIMIT" });
    // The third call never reached the DB-backed check at all.
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("scopes the burst limiter per session — a different session is never blocked by another session's burst", async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: true, used_count: 1 }], error: null });

    await checkAndConsumeDemoAiUsage("session-f");
    await checkAndConsumeDemoAiUsage("session-f");
    await checkAndConsumeDemoAiUsage("session-f"); // burst-limited

    const otherSession = await checkAndConsumeDemoAiUsage("session-g");
    expect(otherSession.allowed).toBe(true);
  });
});

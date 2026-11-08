import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { routeMock, adminMock, costMock } = vi.hoisted(() => ({
  routeMock: vi.fn(),
  adminMock: vi.fn(),
  costMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminMock }));
vi.mock("@/lib/ai/pricing", () => ({ estimateCostUsd: costMock }));
vi.mock("@/lib/ai/router", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/router")>("@/lib/ai/router");
  return { ...actual, routeStructuredGeneration: routeMock, isAiRoutingConfigured: () => true };
});
vi.mock("@/services/billing", () => ({ getOrCreateSubscription: vi.fn(async () => ({})) }));

import { runAiJob } from "@/services/ai-jobs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function userClient() {
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq }));
  const rpc = vi.fn(async () => ({
    data: [{ job_id: "job-1", allowed: true, reason: null, used_count: 1, allowance: 30 }],
    error: null,
  }));
  return { rpc, from: vi.fn(() => ({ update })), update } as unknown as SupabaseClient<Database> & {
    update: typeof update;
  };
}

/** admin.from().update().eq().eq().eq() chain; records every call. */
function adminClient(result: { error: unknown } | Error = { error: null }) {
  const eqCalls: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    if (eqCalls.length < 3) return chain;
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  const update = vi.fn(() => chain);
  const from = vi.fn(() => ({ update }));
  return { client: { from }, from, update, eqCalls };
}

const params = (supabase: SupabaseClient<Database>) => ({
  supabase,
  tenantId: "t1",
  jobType: "CONTENT_GENERATION" as const,
  schema: z.object({ ok: z.boolean() }),
  system: "s",
  prompt: "p",
  inputReference: {},
});

beforeEach(() => {
  routeMock.mockReset();
  adminMock.mockReset();
  costMock.mockReset();
  routeMock.mockResolvedValue({
    data: { ok: true },
    provider: "anthropic",
    model: "m",
    tokensInput: 1000,
    tokensOutput: 500,
    fallbackUsed: false,
  });
});

describe("runAiJob — estimated_cost bookkeeping", () => {
  it("writes estimated_cost ONLY through the admin client, scoped to tenant + id + COMPLETED, and never via the user's client", async () => {
    costMock.mockReturnValue(0.0123);
    const admin = adminClient();
    adminMock.mockReturnValue(admin.client);
    const supabase = userClient();

    const result = await runAiJob(params(supabase));

    expect(result.ok).toBe(true);
    expect(costMock).toHaveBeenCalledWith("anthropic", "m", 1000, 500);
    expect(admin.from).toHaveBeenCalledWith("prompter_ai_jobs");
    expect(admin.update).toHaveBeenCalledWith({ estimated_cost: 0.0123 });
    expect(admin.eqCalls).toEqual([
      ["id", "job-1"],
      ["tenant_id", "t1"],
      ["status", "COMPLETED"],
    ]);
    for (const [cols] of (supabase.update as ReturnType<typeof vi.fn>).mock.calls) {
      expect(Object.keys(cols as object)).not.toContain("estimated_cost");
    }
  });

  it("skips the write entirely when the model price is unknown (null)", async () => {
    costMock.mockReturnValue(null);
    const admin = adminClient();
    adminMock.mockReturnValue(admin.client);

    const result = await runAiJob(params(userClient()));

    expect(result.ok).toBe(true);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("a missing admin client does not affect the job result", async () => {
    costMock.mockReturnValue(0.5);
    adminMock.mockReturnValue(null);
    const result = await runAiJob(params(userClient()));
    expect(result.ok).toBe(true);
  });

  it("a failing or throwing cost write is swallowed: the job stays COMPLETED/ok and is not re-marked FAILED", async () => {
    costMock.mockReturnValue(0.5);
    for (const failure of [{ error: { message: "denied" } }, new Error("network")]) {
      adminMock.mockReturnValue(adminClient(failure).client);
      const supabase = userClient();
      const result = await runAiJob(params(supabase));
      expect(result.ok).toBe(true);
      const statuses = (supabase.update as ReturnType<typeof vi.fn>).mock.calls.map(([c]) => (c as { status: string }).status);
      expect(statuses).toEqual(["COMPLETED"]);
    }
  });

  it("an estimator that throws cannot fail the job", async () => {
    costMock.mockImplementation(() => {
      throw new Error("bug in pricing");
    });
    adminMock.mockReturnValue(adminClient().client);
    const result = await runAiJob(params(userClient()));
    expect(result.ok).toBe(true);
  });

  it("a failed generation never attempts a cost write", async () => {
    routeMock.mockRejectedValue(new Error("provider down"));
    const admin = adminClient();
    adminMock.mockReturnValue(admin.client);
    const result = await runAiJob(params(userClient()));
    expect(result.ok).toBe(false);
    expect(costMock).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });
});

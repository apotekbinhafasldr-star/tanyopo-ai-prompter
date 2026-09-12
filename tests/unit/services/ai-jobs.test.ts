import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";

const { routeStructuredGenerationMock } = vi.hoisted(() => ({
  routeStructuredGenerationMock: vi.fn(),
}));

vi.mock("@/lib/ai/router", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/router")>("@/lib/ai/router");
  return {
    ...actual,
    routeStructuredGeneration: routeStructuredGenerationMock,
  };
});

vi.mock("@/services/billing", () => ({
  getOrCreateSubscription: vi.fn(async () => ({ tenant_id: "t1", plan: "FREE", status: "TRIALING" })),
}));

import { runAiJob } from "@/services/ai-jobs";
import { AIRoutingNotConfiguredError } from "@/lib/ai/router";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const schema = z.object({ ok: z.boolean() });

/** Mocks the Supabase client surface runAiJob() touches: the atomic
 * fn_create_ai_job_if_entitled RPC, plus the plain `.update()`/`.delete()`
 * calls it makes afterward on prompter_ai_jobs. */
function mockSupabase(rpcResult: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async () => rpcResult);
  const eq = vi.fn(() => ({}));
  const update = vi.fn(() => ({ eq }));
  const del = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update, delete: del }));
  return { rpc, from, update, delete: del, eq } as unknown as SupabaseClient<Database> & {
    rpc: typeof rpc;
    from: typeof from;
    update: typeof update;
    delete: typeof del;
    eq: typeof eq;
  };
}

function baseParams(supabase: SupabaseClient<Database>) {
  return {
    supabase,
    tenantId: "t1",
    actorUserId: "u1",
    jobType: "CONTENT_GENERATION" as const,
    schema,
    system: "system prompt",
    prompt: "user prompt",
    inputReference: { foo: "bar" },
  };
}

beforeEach(() => {
  routeStructuredGenerationMock.mockReset();
});

describe("runAiJob — Batch B9 atomic entitlement gate", () => {
  it("creates the job via fn_create_ai_job_if_entitled and never sends a client-supplied tenant_id to the RPC (tenant isolation by construction)", async () => {
    const supabase = mockSupabase({
      data: [{ job_id: "job-1", allowed: true, reason: null, used_count: 1, allowance: 30 }],
      error: null,
    });
    routeStructuredGenerationMock.mockResolvedValue({
      data: { ok: true },
      provider: "openai",
      model: "gpt",
      tokensInput: 10,
      tokensOutput: 5,
      fallbackUsed: false,
    });

    const result = await runAiJob(baseParams(supabase));

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = (supabase.rpc as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fnName).toBe("fn_create_ai_job_if_entitled");
    expect(args).not.toHaveProperty("tenant_id");
    expect(args).not.toHaveProperty("p_tenant_id");
  });

  it("the 30th trial AI usage succeeds (RPC reports used_count 30 <= allowance 30)", async () => {
    const supabase = mockSupabase({
      data: [{ job_id: "job-30", allowed: true, reason: null, used_count: 30, allowance: 30 }],
      error: null,
    });
    routeStructuredGenerationMock.mockResolvedValue({
      data: { ok: true },
      provider: "openai",
      model: "gpt",
      tokensInput: 1,
      tokensOutput: 1,
      fallbackUsed: false,
    });

    const result = await runAiJob(baseParams(supabase));
    expect(result.ok).toBe(true);
  });

  it("the 31st trial AI usage is rejected (RPC reports AI_USAGE_LIMIT_REACHED) and no AI call is made", async () => {
    const supabase = mockSupabase({
      data: [{ job_id: null, allowed: false, reason: "AI_USAGE_LIMIT_REACHED", used_count: 30, allowance: 30 }],
      error: null,
    });

    const result = await runAiJob(baseParams(supabase));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/30/);
      expect(result.jobId).toBeNull();
    }
    expect(routeStructuredGenerationMock).not.toHaveBeenCalled();
  });

  it("a paid plan's last allowed AI usage succeeds and the next one is rejected — same RPC contract as the trial", async () => {
    const allowed = mockSupabase({
      data: [{ job_id: "job-150", allowed: true, reason: null, used_count: 150, allowance: 150 }],
      error: null,
    });
    routeStructuredGenerationMock.mockResolvedValue({
      data: { ok: true },
      provider: "openai",
      model: "gpt",
      tokensInput: 1,
      tokensOutput: 1,
      fallbackUsed: false,
    });
    expect((await runAiJob(baseParams(allowed))).ok).toBe(true);

    const rejected = mockSupabase({
      data: [{ job_id: null, allowed: false, reason: "AI_USAGE_LIMIT_REACHED", used_count: 150, allowance: 150 }],
      error: null,
    });
    const result = await runAiJob(baseParams(rejected));
    expect(result.ok).toBe(false);
  });

  it("fails closed when the RPC call itself errors (network/DB failure) — never grants access or creates a job on an error", async () => {
    const supabase = mockSupabase({ data: null, error: { message: "connection reset" } });

    const result = await runAiJob(baseParams(supabase));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.jobId).toBeNull();
    }
    expect(routeStructuredGenerationMock).not.toHaveBeenCalled();
  });

  it("fails closed when the RPC returns no row at all", async () => {
    const supabase = mockSupabase({ data: [], error: null });
    const result = await runAiJob(baseParams(supabase));
    expect(result.ok).toBe(false);
  });

  it("deletes the job row (already counted by the atomic RPC) when nothing is configured, so it never counts toward future usage", async () => {
    const supabase = mockSupabase({
      data: [{ job_id: "job-x", allowed: true, reason: null, used_count: 1, allowance: 30 }],
      error: null,
    });
    routeStructuredGenerationMock.mockRejectedValue(new AIRoutingNotConfiguredError("not configured"));

    const result = await runAiJob(baseParams(supabase));

    expect(result.ok).toBe(false);
    expect(supabase.delete).toHaveBeenCalled();
    expect(supabase.eq).toHaveBeenCalledWith("id", "job-x");
  });

  it("simulates two concurrent requests at the last slot — only one may be granted, proving the JS layer correctly surfaces a serialized rejection", async () => {
    // Models the real Postgres advisory-lock serialization
    // (fn_create_ai_job_if_entitled) as an in-memory counter: exactly one
    // of two "simultaneous" calls can win the last slot. The real
    // atomicity guarantee lives in the DB function's
    // pg_advisory_xact_lock + `for update` (see the migration) — this
    // test only proves runAiJob() correctly relays whatever the RPC
    // decides, without any extra client-side race of its own.
    let remaining = 1;
    const rpc = vi.fn(async () => {
      if (remaining > 0) {
        remaining -= 1;
        return { data: [{ job_id: "job-last", allowed: true, reason: null, used_count: 30, allowance: 30 }], error: null };
      }
      return {
        data: [{ job_id: null, allowed: false, reason: "AI_USAGE_LIMIT_REACHED", used_count: 30, allowance: 30 }],
        error: null,
      };
    });
    const eq = vi.fn(() => ({}));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update, delete: vi.fn(() => ({ eq })) }));
    const supabase = { rpc, from } as unknown as SupabaseClient<Database>;

    routeStructuredGenerationMock.mockResolvedValue({
      data: { ok: true },
      provider: "openai",
      model: "gpt",
      tokensInput: 1,
      tokensOutput: 1,
      fallbackUsed: false,
    });

    const [first, second] = await Promise.all([runAiJob(baseParams(supabase)), runAiJob(baseParams(supabase))]);
    const outcomes = [first.ok, second.ok];

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(outcomes.filter((ok) => !ok)).toHaveLength(1);
  });
});

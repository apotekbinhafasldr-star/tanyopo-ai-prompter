import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Caller of getOrCreateSubscription in services/ai-jobs.ts (F1), CODE/UNIT level with mocks: when the subscription
 * cannot be read or stored, the AI job fails closed with an Indonesian message, creates no job and makes no AI call.
 */
const { routeMock, getSubscriptionMock } = vi.hoisted(() => ({
  routeMock: vi.fn(),
  getSubscriptionMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/ai/router", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/router")>("@/lib/ai/router");
  return { ...actual, routeStructuredGeneration: routeMock, isAiRoutingConfigured: () => true };
});
vi.mock("@/services/billing", () => ({ getOrCreateSubscription: getSubscriptionMock }));

import { runAiJob } from "@/services/ai-jobs";

function client() {
  const rpc = vi.fn(async () => ({
    data: [{ job_id: "job-1", allowed: true, reason: null, used_count: 1, allowance: 30 }],
    error: null,
  }));
  const from = vi.fn();
  return { supabase: { rpc, from } as unknown as SupabaseClient<Database>, rpc, from };
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
  getSubscriptionMock.mockReset();
});

describe("runAiJob when the subscription is unavailable (F1)", () => {
  it("fails closed: Indonesian message, no entitlement RPC, no job row, no AI call", async () => {
    getSubscriptionMock.mockRejectedValue(new Error("Subscription unavailable"));
    const { supabase, rpc, from } = client();

    const result = await runAiJob(params(supabase));

    expect(result).toEqual({ ok: false, error: "Gagal memeriksa paket Anda. Silakan coba lagi.", jobId: null });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(routeMock).not.toHaveBeenCalled();
  });

  it("does not leak the underlying error text", async () => {
    getSubscriptionMock.mockRejectedValue(new Error("42501 new row violates row-level security policy"));
    const { supabase } = client();

    const result = await runAiJob(params(supabase));

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/42501|row-level|policy/);
  });
});

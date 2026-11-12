import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Provider and database are fakes: no SDK, no network, no real Supabase.
const { routeMock, adminMock } = vi.hoisted(() => ({ routeMock: vi.fn(), adminMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminMock }));
vi.mock("@/lib/ai/pricing", () => ({ estimateCostUsd: () => null }));
vi.mock("@/lib/ai/router", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/router")>("@/lib/ai/router");
  return { ...actual, routeStructuredGeneration: routeMock, isAiRoutingConfigured: () => true };
});
vi.mock("@/services/billing", () => ({ getOrCreateSubscription: vi.fn(async () => ({})) }));

import { runAiJob } from "@/services/ai-jobs";
import { AIProviderError } from "@/lib/ai/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type EqResult = () => Promise<unknown>;

/** User-JWT client: RPC grants job-1; every `.update().eq()` answers with `eqResult`. */
function userClient(eqResult: EqResult = async () => ({ error: null })) {
  const eq = vi.fn(eqResult);
  const update = vi.fn(() => ({ eq }));
  const rpc = vi.fn(async () => ({
    data: [{ job_id: "job-1", allowed: true, reason: null, used_count: 1, allowance: 30 }],
    error: null,
  }));
  return { rpc, from: vi.fn(() => ({ update })), update, eq } as unknown as SupabaseClient<Database> & {
    update: typeof update;
  };
}

/** admin.from().update().eq().eq().eq(): records the filters, resolves on the third. */
function adminClient(result: { error: unknown } | Error = { error: null }) {
  const eqCalls: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    if (eqCalls.length < 3) return chain;
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  const update = vi.fn(() => chain);
  return { client: { from: vi.fn(() => ({ update })) }, update, eqCalls };
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

const GOOD = {
  data: { ok: true },
  provider: "anthropic",
  model: "m",
  tokensInput: 10,
  tokensOutput: 5,
  fallbackUsed: false,
};

beforeEach(() => {
  routeMock.mockReset();
  adminMock.mockReset();
  adminMock.mockReturnValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runAiJob — failure text never leaks internals", () => {
  it("a non-provider error (e.g. a Zod/JSON parse error echoing model output) is replaced by a generic message, in the result AND in the stored row", async () => {
    const leaky = new Error('Invalid input at "$.caption": got "sk-live-SECRET-123 …model output…"');
    routeMock.mockRejectedValue(leaky);
    const supabase = userClient();

    const result = await runAiJob(params(supabase));

    expect(result).toEqual({ ok: false, error: "AI gagal memproses permintaan. Silakan coba lagi.", jobId: "job-1" });
    const patch = (supabase.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(patch).toMatchObject({ status: "FAILED", error_category: "UNKNOWN" });
    expect(JSON.stringify(patch)).not.toContain("SECRET");
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("AUTH and CONFIG failures do not tell tenants about env variables, but keep their category for operators", async () => {
    for (const category of ["AUTH", "CONFIG"] as const) {
      routeMock.mockRejectedValue(new AIProviderError("Anthropic menolak kredensial. Periksa ANTHROPIC_API_KEY.", category));
      const supabase = userClient();

      const result = await runAiJob(params(supabase));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).not.toMatch(/API_KEY|ANTHROPIC|OPENAI|kredensial/i);
      const patch = (supabase.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
      expect(patch).toMatchObject({ status: "FAILED", error_category: category });
      expect(String(patch.error)).not.toMatch(/API_KEY|ANTHROPIC|OPENAI/i);
    }
  });

  it("curated provider messages (rate limit, refusal) still reach the user unchanged", async () => {
    routeMock.mockRejectedValue(new AIProviderError("Anthropic sedang sibuk. Coba lagi sebentar lagi.", "RATE_LIMIT"));
    const result = await runAiJob(params(userClient()));
    expect(result).toEqual({ ok: false, error: "Anthropic sedang sibuk. Coba lagi sebentar lagi.", jobId: "job-1" });
  });
});

describe("runAiJob — a job is never left PROCESSING because one bookkeeping write failed", () => {
  it("COMPLETED write returns an error: it is retried once via the admin client scoped to tenant + id + PROCESSING, and the paid result is still returned", async () => {
    routeMock.mockResolvedValue(GOOD);
    const admin = adminClient();
    adminMock.mockReturnValue(admin.client);
    const supabase = userClient(async () => ({ error: { message: "db down" } }));

    const result = await runAiJob(params(supabase));

    expect(result).toMatchObject({ ok: true, jobId: "job-1", data: { ok: true } });
    expect(admin.update).toHaveBeenCalledTimes(1);
    expect(admin.update).toHaveBeenCalledWith(expect.objectContaining({ status: "COMPLETED", tokens_input: 10 }));
    expect(admin.eqCalls).toEqual([
      ["id", "job-1"],
      ["tenant_id", "t1"],
      ["status", "PROCESSING"],
    ]);
  });

  it("COMPLETED write throws: the successful generation is NOT reported as a failure and no FAILED row is written", async () => {
    routeMock.mockResolvedValue(GOOD);
    const admin = adminClient();
    adminMock.mockReturnValue(admin.client);
    const supabase = userClient(async () => {
      throw new Error("socket hang up");
    });

    const result = await runAiJob(params(supabase));

    expect(result).toMatchObject({ ok: true, data: { ok: true } });
    const written = [
      ...(supabase.update as ReturnType<typeof vi.fn>).mock.calls,
      ...(admin.update.mock.calls as unknown[][]),
    ].map(([patch]) => (patch as { status: string }).status);
    expect(written).not.toContain("FAILED");
  });

  it("FAILED write errors: the admin client closes the job as FAILED", async () => {
    routeMock.mockRejectedValue(new AIProviderError("x", "CONNECTION"));
    const admin = adminClient();
    adminMock.mockReturnValue(admin.client);
    const supabase = userClient(async () => ({ error: { message: "db down" } }));

    const result = await runAiJob(params(supabase));

    expect(result.ok).toBe(false);
    expect(admin.update).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED", error_category: "CONNECTION" }));
  });

  it("when both writes fail nothing throws and the caller still gets the result", async () => {
    routeMock.mockResolvedValue(GOOD);
    adminMock.mockReturnValue(adminClient(new Error("admin down")).client);
    const supabase = userClient(async () => ({ error: { message: "db down" } }));

    await expect(runAiJob(params(supabase))).resolves.toMatchObject({ ok: true });
  });

  it("a healthy user-client write never touches the admin client", async () => {
    routeMock.mockResolvedValue(GOOD);
    await runAiJob(params(userClient()));
    expect(adminMock).not.toHaveBeenCalled();
  });
});

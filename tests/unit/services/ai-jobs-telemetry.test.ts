import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Provider, database and telemetry are fakes: no SDK, no network, no real Supabase.
const { routeMock, adminMock, jobFinishedMock, appErrorMock } = vi.hoisted(() => ({
  routeMock: vi.fn(),
  adminMock: vi.fn(),
  jobFinishedMock: vi.fn(async () => {}),
  appErrorMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminMock }));
vi.mock("@/lib/ai/pricing", () => ({ estimateCostUsd: () => null }));
vi.mock("@/lib/ai/router", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/router")>("@/lib/ai/router");
  return { ...actual, routeStructuredGeneration: routeMock, isAiRoutingConfigured: () => true };
});
vi.mock("@/services/billing", () => ({ getOrCreateSubscription: vi.fn(async () => ({})) }));
vi.mock("@/lib/telemetry", () => ({ emitAiJobFinished: jobFinishedMock, emitAppError: appErrorMock }));

import { runAiJob } from "@/services/ai-jobs";
import { AIProviderError } from "@/lib/ai/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function userClient(eqResult: () => Promise<unknown> = async () => ({ error: null })) {
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

const params = (supabase: SupabaseClient<Database>) => ({
  supabase,
  tenantId: "t1",
  jobType: "CONTENT_GENERATION" as const,
  schema: z.object({ ok: z.boolean() }),
  system: "s",
  prompt: "p",
  inputReference: {},
});

const GOOD = { data: { ok: true }, provider: "anthropic", model: "m", tokensInput: 10, tokensOutput: 5, fallbackUsed: false };

beforeEach(() => {
  routeMock.mockReset();
  adminMock.mockReset();
  adminMock.mockReturnValue(null);
  jobFinishedMock.mockClear();
  appErrorMock.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runAiJob telemetry hook", () => {
  it("emits exactly one ai_job_finished (completed) after the row is closed; ledger write unchanged", async () => {
    routeMock.mockResolvedValue(GOOD);
    const supabase = userClient();
    const result = await runAiJob(params(supabase));
    expect(result.ok).toBe(true);
    expect(jobFinishedMock).toHaveBeenCalledTimes(1);
    expect(jobFinishedMock.mock.calls[0][0]).toMatchObject({ tenantId: "t1", jobId: "job-1", status: "completed", model: "m" });
    expect(appErrorMock).not.toHaveBeenCalled();
    expect(supabase.update).toHaveBeenCalledTimes(1);
    expect((supabase.update.mock.calls[0] as unknown[])[0]).toMatchObject({ status: "COMPLETED" });
  });

  it("emits ai_job_finished (failed) + app_error with category and class name only, never the message", async () => {
    routeMock.mockRejectedValue(new AIProviderError("pesan rahasia sk-live-SECRET", "RATE_LIMIT", 429));
    const result = await runAiJob(params(userClient()));
    expect(result.ok).toBe(false);
    expect(jobFinishedMock).toHaveBeenCalledTimes(1);
    expect(jobFinishedMock.mock.calls[0][0]).toMatchObject({ status: "failed", errorCategory: "RATE_LIMIT" });
    expect(appErrorMock).toHaveBeenCalledTimes(1);
    expect(appErrorMock.mock.calls[0][0]).toMatchObject({ errorName: "AIProviderError", errorCategory: "RATE_LIMIT", httpStatus: 429, routeGroup: "ai_jobs" });
    expect(JSON.stringify([jobFinishedMock.mock.calls, appErrorMock.mock.calls])).not.toContain("SECRET");
  });

  it("emits nothing when the job row could not be closed", async () => {
    routeMock.mockResolvedValue(GOOD);
    const supabase = userClient(async () => ({ error: { message: "db down" } }));
    await runAiJob(params(supabase));
    expect(jobFinishedMock).not.toHaveBeenCalled();
  });

  it("emits nothing for entitlement blocks (no job was run)", async () => {
    const supabase = userClient();
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ job_id: null, allowed: false, reason: "TRIAL_EXPIRED", used_count: 30, allowance: 30 }],
      error: null,
    });
    const result = await runAiJob(params(supabase));
    expect(result.ok).toBe(false);
    expect(jobFinishedMock).not.toHaveBeenCalled();
    expect(routeMock).not.toHaveBeenCalled();
  });
});

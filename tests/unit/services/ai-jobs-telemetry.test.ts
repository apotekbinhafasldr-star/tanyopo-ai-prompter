import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Provider, database and telemetry are fakes: no SDK, no network, no real Supabase.
const { routeMock, adminMock, jobFinishedMock, appErrorMock, enabledMock } = vi.hoisted(() => ({
  enabledMock: vi.fn(() => true),
  routeMock: vi.fn(),
  adminMock: vi.fn(),
  jobFinishedMock: vi.fn(async (_input: unknown) => {}),
  appErrorMock: vi.fn(async (_input: unknown) => {}),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminMock }));
vi.mock("@/lib/ai/pricing", () => ({ estimateCostUsd: () => null }));
vi.mock("@/lib/ai/router", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/router")>("@/lib/ai/router");
  return { ...actual, routeStructuredGeneration: routeMock, isAiRoutingConfigured: () => true };
});
vi.mock("@/services/billing", () => ({ getOrCreateSubscription: vi.fn(async () => ({})) }));
vi.mock("@/lib/telemetry", () => ({
  emitAiJobFinished: jobFinishedMock,
  emitAppError: appErrorMock,
  isTelemetryEnabled: enabledMock,
}));

import { runAiJob } from "@/services/ai-jobs";
import { AIProviderError } from "@/lib/ai/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Fake client. `update().eq()` is the ledger write; `select().eq().eq().maybeSingle()`
 * is the read-only lookup. By default the lookup reflects what was written, like a
 * real row; `observe` overrides it to simulate zero-row updates or a hung read.
 */
function userClient(
  eqResult: () => Promise<unknown> = async () => ({ error: null }),
  observe?: (written: string | null) => Promise<unknown>,
) {
  let written: string | null = null;
  const eq = vi.fn(eqResult);
  const update = vi.fn((patch: { status?: string }) => {
    written = patch.status ?? null;
    return { eq };
  });
  const maybeSingle = vi.fn(() =>
    observe ? observe(written) : Promise.resolve({ data: written ? { status: written } : null, error: null }),
  );
  const select = vi.fn(() => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }));
  const rpc = vi.fn(async () => ({
    data: [{ job_id: "job-1", allowed: true, reason: null, used_count: 1, allowance: 30 }],
    error: null,
  }));
  return { rpc, from: vi.fn(() => ({ update, select })), update, eq, select } as unknown as SupabaseClient<Database> & {
    update: typeof update;
    select: typeof select;
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
  enabledMock.mockReset();
  enabledMock.mockReturnValue(true);
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

  it("emits nothing when the UPDATE reported no error but changed zero rows (job still PROCESSING)", async () => {
    routeMock.mockResolvedValue(GOOD);
    const supabase = userClient(undefined, async () => ({ data: { status: "PROCESSING" }, error: null }));
    const result = await runAiJob(params(supabase));
    expect(result.ok).toBe(true); // the user result is unaffected
    expect(jobFinishedMock).not.toHaveBeenCalled();
    expect(supabase.update).toHaveBeenCalledTimes(1); // ledger mechanism unchanged: no extra write
  });

  it("emits nothing when the verification read finds no row or errors", async () => {
    routeMock.mockResolvedValue(GOOD);
    await runAiJob(params(userClient(undefined, async () => ({ data: null, error: null }))));
    await runAiJob(params(userClient(undefined, async () => ({ data: null, error: { message: "x" } }))));
    await runAiJob(params(userClient(undefined, async () => { throw new Error("boom"); })));
    expect(jobFinishedMock).not.toHaveBeenCalled();
  });

  it("a hung verification read cannot hold the AI job beyond ~1s and emits nothing", async () => {
    vi.useFakeTimers();
    try {
      routeMock.mockResolvedValue(GOOD);
      const pending = runAiJob(params(userClient(undefined, () => new Promise(() => {}))));
      await vi.advanceTimersByTimeAsync(1100);
      const result = await pending;
      expect(result.ok).toBe(true);
      expect(jobFinishedMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("failed job: emits only if FAILED is observed; zero-row update emits nothing", async () => {
    routeMock.mockRejectedValue(new AIProviderError("x", "RATE_LIMIT", 429));
    await runAiJob(params(userClient(undefined, async () => ({ data: { status: "PROCESSING" }, error: null }))));
    expect(jobFinishedMock).not.toHaveBeenCalled();
    expect(appErrorMock).not.toHaveBeenCalled();
  });

  it("telemetry OFF: no verification read and no event, job result unchanged", async () => {
    enabledMock.mockReturnValue(false);
    routeMock.mockResolvedValue(GOOD);
    const supabase = userClient();
    const result = await runAiJob(params(supabase));
    expect(result.ok).toBe(true);
    expect(supabase.select).not.toHaveBeenCalled();
    expect(jobFinishedMock).not.toHaveBeenCalled();
  });
});

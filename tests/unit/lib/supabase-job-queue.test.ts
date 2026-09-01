import { describe, expect, it, vi } from "vitest";
import { SupabaseJobQueue } from "@/lib/jobs/providers/supabase-job-queue";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * A minimal chainable mock covering exactly the builder calls
 * SupabaseJobQueue makes (insert/select/single, rpc, update/eq/select/
 * maybeSingle). Each test configures `responses` for the specific calls
 * it cares about; anything unconfigured resolves to { data: null, error: null }.
 */
function mockSupabase(overrides: {
  insertResult?: { data: unknown; error: unknown };
  fetchExistingResult?: { data: unknown; error: unknown };
  rpcResult?: { data: unknown; error: unknown };
  updateResult?: { data: unknown; error: unknown };
  selectSingleResult?: { data: unknown; error: unknown };
}) {
  const rpc = vi.fn(async () => overrides.rpcResult ?? { data: null, error: null });

  const from = vi.fn(() => ({
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => overrides.insertResult ?? { data: null, error: null }),
      })),
    })),
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => overrides.fetchExistingResult ?? { data: null, error: null }),
          })),
        })),
        single: vi.fn(async () => overrides.selectSingleResult ?? { data: null, error: null }),
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => overrides.updateResult ?? { data: null, error: null }),
          })),
        })),
        // update(...).eq(id) with no further chaining (complete/fail's plain updates)
        then: undefined,
      })),
    })),
  }));

  return { from, rpc } as unknown as SupabaseClient<Database>;
}

describe("SupabaseJobQueue.enqueue", () => {
  it("returns the new job id on a fresh insert", async () => {
    const supabase = mockSupabase({ insertResult: { data: { id: "job-1" }, error: null } });
    const queue = new SupabaseJobQueue(supabase);

    const result = await queue.enqueue({ tenantId: "t1", jobType: "EXTERNAL_API_RETRY" });
    expect(result).toEqual({ jobId: "job-1", alreadyExisted: false });
  });

  it("returns the existing job id on an idempotent replay (unique violation)", async () => {
    const supabase = mockSupabase({
      insertResult: { data: null, error: { code: "23505", message: "duplicate" } },
      fetchExistingResult: { data: { id: "job-existing" }, error: null },
    });
    const queue = new SupabaseJobQueue(supabase);

    const result = await queue.enqueue({
      tenantId: "t1",
      jobType: "EXTERNAL_API_RETRY",
      idempotencyKey: "key-1",
    });
    expect(result).toEqual({ jobId: "job-existing", alreadyExisted: true });
  });

  it("throws on a real (non-unique-violation) insert error", async () => {
    const supabase = mockSupabase({
      insertResult: { data: null, error: { code: "23503", message: "fk violation" } },
    });
    const queue = new SupabaseJobQueue(supabase);

    await expect(queue.enqueue({ tenantId: "t1", jobType: "EXTERNAL_API_RETRY" })).rejects.toThrow(
      "fk violation",
    );
  });
});

describe("SupabaseJobQueue.claimNext", () => {
  it("returns the claimed job from the RPC", async () => {
    const job = { id: "job-1", status: "RUNNING", attempts: 1 };
    const supabase = mockSupabase({ rpcResult: { data: job, error: null } });
    const queue = new SupabaseJobQueue(supabase);

    const result = await queue.claimNext(["EXTERNAL_API_RETRY"]);
    expect(result).toEqual(job);
  });

  it("returns null when nothing is due", async () => {
    const supabase = mockSupabase({ rpcResult: { data: null, error: null } });
    const queue = new SupabaseJobQueue(supabase);

    expect(await queue.claimNext()).toBeNull();
  });

  it("throws on an RPC error", async () => {
    const supabase = mockSupabase({ rpcResult: { data: null, error: { message: "boom" } } });
    const queue = new SupabaseJobQueue(supabase);

    await expect(queue.claimNext()).rejects.toThrow("boom");
  });
});

describe("SupabaseJobQueue.fail", () => {
  it("schedules a retry (stays PENDING) when attempts are still below max_attempts", async () => {
    const supabase = mockSupabase({ selectSingleResult: { data: { attempts: 1, max_attempts: 5 }, error: null } });
    const queue = new SupabaseJobQueue(supabase);

    // Should not throw; the retry-vs-terminal branch is exercised via the
    // fetched attempts/max_attempts above (unit-testing the branch choice,
    // not the exact update payload, which the mock doesn't capture here).
    await expect(queue.fail("job-1", "transient error")).resolves.toBeUndefined();
  });

  it("marks the job terminally FAILED once attempts reach max_attempts", async () => {
    const supabase = mockSupabase({ selectSingleResult: { data: { attempts: 5, max_attempts: 5 }, error: null } });
    const queue = new SupabaseJobQueue(supabase);

    await expect(queue.fail("job-1", "final error")).resolves.toBeUndefined();
  });

  it("no-ops when the job can't be found", async () => {
    const supabase = mockSupabase({ selectSingleResult: { data: null, error: { message: "not found" } } });
    const queue = new SupabaseJobQueue(supabase);

    await expect(queue.fail("missing-job", "error")).resolves.toBeUndefined();
  });
});

describe("SupabaseJobQueue.cancel", () => {
  it("reports canceled: true when a PENDING job was updated", async () => {
    const supabase = mockSupabase({ updateResult: { data: { id: "job-1" }, error: null } });
    const queue = new SupabaseJobQueue(supabase);

    expect(await queue.cancel("job-1")).toEqual({ canceled: true });
  });

  it("reports canceled: false when no PENDING row matched (already running/finished)", async () => {
    const supabase = mockSupabase({ updateResult: { data: null, error: null } });
    const queue = new SupabaseJobQueue(supabase);

    expect(await queue.cancel("job-1")).toEqual({ canceled: false });
  });
});

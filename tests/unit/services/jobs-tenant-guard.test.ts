import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SupabaseJobQueue } from "@/lib/jobs/providers/supabase-job-queue";
import { cancelJob, claimNextJob, completeJob, failJob } from "@/services/jobs";
import { fakeJobsAdmin, makeJob } from "../helpers/fake-jobs-admin";

/**
 * PR-C — complete/fail/cancel run through the service-role client (RLS bypassed), so the QUERY must carry the
 * tenant (and the state-machine guard). The fake applies the filters it receives to real rows: a query that
 * forgets tenant_id or status changes the other tenant's row and these tests fail.
 * Rows hold inert placeholders only; no environment value is read.
 */
const A = "tenant-a";
const B = "tenant-b";

describe("queue.complete — tenant + RUNNING guard", () => {
  it("completes the tenant's own RUNNING job and stores the result", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A })]);

    const out = await new SupabaseJobQueue(f.admin).complete({ id: "j1", tenantId: A }, { ok: true });

    expect(out).toEqual({ applied: true });
    expect(f.rows[0]).toMatchObject({ status: "SUCCEEDED", result: { ok: true }, error: null });
    expect(f.rows[0].finished_at).toBeTruthy();
  });

  it("rejects the right job id under the WRONG tenant and leaves the row untouched", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A })]);

    const out = await new SupabaseJobQueue(f.admin).complete({ id: "j1", tenantId: B }, { stolen: true });

    expect(out).toEqual({ applied: false });
    expect(f.rows[0]).toMatchObject({ status: "RUNNING", result: null });
  });

  it("completing tenant A's job never touches tenant B's RUNNING job", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A }), makeJob({ id: "j2", tenant_id: B })]);

    await new SupabaseJobQueue(f.admin).complete({ id: "j1", tenantId: A });

    expect(f.rows.map((r) => r.status)).toEqual(["SUCCEEDED", "RUNNING"]);
  });

  it.each(["PENDING", "SUCCEEDED", "FAILED", "CANCELED"] as const)("does not complete a %s job (only RUNNING may complete)", async (status) => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A, status })]);

    const out = await new SupabaseJobQueue(f.admin).complete({ id: "j1", tenantId: A }, { late: true });

    expect(out).toEqual({ applied: false });
    expect(f.rows[0].status).toBe(status);
    expect(f.rows[0].result).toBe(null);
  });

  it.each([
    { id: "", tenantId: A },
    { id: "j1", tenantId: "" },
  ])("fails closed on an invalid reference without touching the database %#", async (ref) => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A })]);

    expect(await new SupabaseJobQueue(f.admin).complete(ref)).toEqual({ applied: false });
    expect(f.queries).toEqual([]);
    expect(f.rows[0].status).toBe("RUNNING");
  });

  it("the update carries id + tenant_id + status=RUNNING filters", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A })]);

    await new SupabaseJobQueue(f.admin).complete({ id: "j1", tenantId: A });

    expect(f.queries).toEqual([{ op: "update", filters: { id: "j1", tenant_id: A, status: "RUNNING" } }]);
  });
});

describe("queue.fail — retry, terminal, tenant + RUNNING guard", () => {
  it("wrong tenant: nothing is read as that job's attempts and nothing is written", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A, attempts: 5, max_attempts: 5 })]);

    const out = await new SupabaseJobQueue(f.admin).fail({ id: "j1", tenantId: B }, "x");

    expect(out).toEqual({ applied: false, terminal: false });
    expect(f.rows[0]).toMatchObject({ status: "RUNNING", error: null });
  });

  it.each(["PENDING", "SUCCEEDED", "FAILED", "CANCELED"] as const)("a %s job is never moved by fail()", async (status) => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A, status, attempts: 5, max_attempts: 5 })]);

    const out = await new SupabaseJobQueue(f.admin).fail({ id: "j1", tenantId: A }, "late failure");

    expect(out).toEqual({ applied: false, terminal: false });
    expect(f.rows[0].status).toBe(status);
    expect(f.rows[0].error).toBe(null);
  });

  it("both the read and the write carry id + tenant_id + status=RUNNING", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A })]);

    await new SupabaseJobQueue(f.admin).fail({ id: "j1", tenantId: A }, "x");

    expect(f.queries).toEqual([
      { op: "select", filters: { id: "j1", tenant_id: A, status: "RUNNING" } },
      { op: "update", filters: { id: "j1", tenant_id: A, status: "RUNNING" } },
    ]);
  });

  it("invalid reference: no query at all", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A })]);

    expect(await new SupabaseJobQueue(f.admin).fail({ id: "j1", tenantId: "" }, "x")).toEqual({ applied: false, terminal: false });
    expect(f.queries).toEqual([]);
  });
});

describe("queue.cancel — tenant + PENDING guard", () => {
  it("cancels the tenant's own PENDING job", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A, status: "PENDING", attempts: 0 })]);

    expect(await new SupabaseJobQueue(f.admin).cancel({ id: "j1", tenantId: A })).toEqual({ canceled: true });
    expect(f.rows[0].status).toBe("CANCELED");
  });

  it("cannot cancel ANOTHER tenant's PENDING job by id", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A, status: "PENDING", attempts: 0 })]);

    expect(await new SupabaseJobQueue(f.admin).cancel({ id: "j1", tenantId: B })).toEqual({ canceled: false });
    expect(f.rows[0].status).toBe("PENDING");
  });

  it("never cancels a RUNNING job (its in-flight call is not interrupted)", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A, status: "RUNNING" })]);

    expect(await new SupabaseJobQueue(f.admin).cancel({ id: "j1", tenantId: A })).toEqual({ canceled: false });
    expect(f.rows[0].status).toBe("RUNNING");
  });

  it("empty tenant fails closed without a query", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A, status: "PENDING" })]);

    expect(await new SupabaseJobQueue(f.admin).cancel({ id: "j1", tenantId: "" })).toEqual({ canceled: false });
    expect(f.queries).toEqual([]);
  });
});

describe("services/jobs — trusted tenant from the claimed job, audit only what was written", () => {
  it("completeJob uses the claimed job's own tenant", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A })]);
    const job = makeJob({ id: "j1", tenant_id: B }); // a forged/mismatched reference

    expect(await completeJob(f.admin, job as never, { x: 1 })).toEqual({ applied: false });
    expect(f.rows[0].status).toBe("RUNNING");
    expect(await completeJob(f.admin, { id: "j1", tenant_id: A }, { x: 1 })).toEqual({ applied: true });
  });

  it("failJob audits a terminal failure once, under the job's tenant", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A, attempts: 5, max_attempts: 5 })]);

    await failJob(f.admin, f.rows[0] as never, "boom");

    expect(f.rows[0].status).toBe("FAILED");
    expect(f.audit).toHaveLength(1);
    expect(f.audit[0]).toMatchObject({ tenant_id: A, action: "job.failed_permanently", resource_id: "j1" });
  });

  it("failJob on a retryable failure writes no audit row", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A, attempts: 1, max_attempts: 5 })]);

    await failJob(f.admin, f.rows[0] as never, "transient");

    expect(f.rows[0].status).toBe("PENDING");
    expect(f.audit).toEqual([]);
  });

  it("failJob with a mismatched tenant changes nothing and writes no audit row", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A, attempts: 5, max_attempts: 5 })]);

    await failJob(f.admin, { id: "j1", tenant_id: B, job_type: "EXTERNAL_API_RETRY", attempts: 5, max_attempts: 5 } as never, "boom");

    expect(f.rows[0]).toMatchObject({ status: "RUNNING", error: null });
    expect(f.audit).toEqual([]);
  });

  it("cancelJob: another tenant cannot cancel by id and no audit row is written; the owner can", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "j1", tenant_id: A, status: "PENDING", attempts: 0 })]);

    expect(await cancelJob(f.admin, B, "j1")).toEqual({ canceled: false });
    expect(f.rows[0].status).toBe("PENDING");
    expect(f.audit).toEqual([]);

    expect(await cancelJob(f.admin, A, "j1")).toEqual({ canceled: true });
    expect(f.audit).toHaveLength(1);
    expect(f.audit[0]).toMatchObject({ tenant_id: A, action: "job.canceled", resource_id: "j1" });
  });
});

describe("worker keeps working across tenants (legitimate cross-tenant claim)", () => {
  it("claims jobs of different tenants in order and completes/fails each under its own tenant", async () => {
    const t = Date.now();
    const f = fakeJobsAdmin([
      makeJob({ id: "ja", tenant_id: A, status: "PENDING", attempts: 0, run_at: new Date(t - 3000).toISOString() }),
      makeJob({ id: "jb", tenant_id: B, status: "PENDING", attempts: 0, run_at: new Date(t - 2000).toISOString() }),
      makeJob({ id: "jc", tenant_id: A, status: "PENDING", attempts: 0, max_attempts: 1, run_at: new Date(t - 1000).toISOString() }),
    ]);

    const first = await claimNextJob(f.admin);
    const second = await claimNextJob(f.admin);
    const third = await claimNextJob(f.admin);
    expect([first?.id, second?.id, third?.id]).toEqual(["ja", "jb", "jc"]);
    expect(await claimNextJob(f.admin)).toBeNull();

    await completeJob(f.admin, first!, { done: "a" });
    await completeJob(f.admin, second!);
    await failJob(f.admin, third!, "no handler");

    expect(f.rows.map((r) => [r.id, r.status])).toEqual([["ja", "SUCCEEDED"], ["jb", "SUCCEEDED"], ["jc", "FAILED"]]);
    expect(f.audit.map((a) => [a.tenant_id, a.action])).toEqual([[A, "job.failed_permanently"]]);
  });

  it("retry: a failed attempt goes back to PENDING and is not re-claimed before its backoff elapses", async () => {
    const f = fakeJobsAdmin([makeJob({ id: "ja", tenant_id: A, status: "PENDING", attempts: 0 })]);

    const claimed = await claimNextJob(f.admin);
    await failJob(f.admin, claimed!, "transient");
    expect(f.rows[0].status).toBe("PENDING");
    expect(await claimNextJob(f.admin)).toBeNull(); // run_at is in the future

    f.rows[0].run_at = new Date(Date.now() - 1000).toISOString(); // backoff elapsed
    const again = await claimNextJob(f.admin);
    expect(again?.id).toBe("ja");
    expect(again?.attempts).toBe(2);
    await completeJob(f.admin, again!);
    expect(f.rows[0].status).toBe("SUCCEEDED");
  });
});

describe("processor route is unchanged in contract", () => {
  const route = readFileSync(path.resolve(__dirname, "../../../app/api/internal/jobs/process/route.ts"), "utf-8");

  it("JOB_HANDLERS is still empty (nothing was activated)", () => {
    expect(route).toMatch(/const JOB_HANDLERS: Partial<Record<JobType, JobHandler>> = \{\};/);
  });

  it("passes the CLAIMED job (database-sourced id + tenant) to complete/fail and reads no request input for ids", () => {
    expect(route).toMatch(/completeJob\(admin, job, /);
    expect(route).toMatch(/failJob\(admin, job, /);
    expect(route).not.toMatch(/request\.(json|formData|text)\(|searchParams|nextUrl/);
  });
});

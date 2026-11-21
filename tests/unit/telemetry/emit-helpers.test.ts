import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitAiJobFinished, emitAppError, resetTelemetryForTests } from "@/lib/telemetry";
import type { TelemetryTransport } from "@/lib/telemetry/send";

const KEY = "phc_" + "a".repeat(30);
const SALT = "s".repeat(40);

function enable() {
  vi.stubEnv("POSTHOG_TELEMETRY_ENABLED", "true");
  vi.stubEnv("POSTHOG_API_KEY", KEY);
  vi.stubEnv("POSTHOG_ID_SALT", SALT);
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetTelemetryForTests();
});

describe("emit helpers", () => {
  it("OFF by default: the SDK loader is never called", async () => {
    const loader = vi.fn();
    resetTelemetryForTests(loader);
    await emitAiJobFinished({ tenantId: "t1", jobId: "j1", jobType: "CONTENT_GENERATION", status: "completed", model: "m", durationMs: 5 });
    await emitAppError({ tenantId: "t1", occurrenceId: "j1", surface: "ai_job", errorName: "Error", errorCategory: "UNKNOWN", routeGroup: "ai_jobs" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("ON: sends hashed tenant only, never the raw tenant id", async () => {
    enable();
    const send = vi.fn(async () => {});
    const transport: TelemetryTransport = { send };
    resetTelemetryForTests(async () => transport);
    await emitAiJobFinished({ tenantId: "tenant-raw-id-1", jobId: "j1", jobType: "CONTENT_GENERATION", status: "completed", model: "m", durationMs: 5 });
    const msg = send.mock.calls[0][0] as { distinctId: string; properties: Record<string, unknown> };
    expect(JSON.stringify(msg)).not.toContain("tenant-raw-id-1");
    expect(msg.distinctId).toMatch(/^[0-9a-f]{32}$/);
    expect(msg.properties.tenant_hash).toBe(msg.distinctId);
  });

  it("two tenants get different hashes", async () => {
    enable();
    const send = vi.fn(async () => {});
    resetTelemetryForTests(async () => ({ send }));
    for (const [i, tenant] of ["tenant-a", "tenant-b"].entries()) {
      await emitAiJobFinished({ tenantId: tenant, jobId: `j${i}`, jobType: "CONTENT_GENERATION", status: "completed", model: "m", durationMs: 5 });
    }
    const [a, b] = send.mock.calls.map((c) => (c[0] as { distinctId: string }).distinctId);
    expect(a).not.toBe(b);
  });

  it("an error name that is not a safe identifier is replaced, never sent", async () => {
    enable();
    const send = vi.fn(async () => {});
    resetTelemetryForTests(async () => ({ send }));
    await emitAppError({ tenantId: "t1", occurrenceId: "j9", surface: "ai_job", errorName: "bad: sk-live-SECRET", errorCategory: "API", httpStatus: 500, routeGroup: "ai_jobs" });
    const msg = send.mock.calls[0][0] as { properties: Record<string, unknown> };
    expect(msg.properties.error_name).toBe("Error");
    expect(JSON.stringify(msg)).not.toContain("SECRET");
  });

  it("never throws when the SDK cannot be loaded", async () => {
    enable();
    resetTelemetryForTests(async () => {
      throw new Error("Cannot find module 'posthog-node'");
    });
    await expect(
      emitAiJobFinished({ tenantId: "t1", jobId: "j1", jobType: "CONTENT_GENERATION", status: "failed", errorCategory: "API", model: null, durationMs: 5 }),
    ).resolves.toBeUndefined();
  });

  it("a failed SDK load is not cached: a later emit can recover", async () => {
    enable();
    const send = vi.fn(async () => {});
    let calls = 0;
    resetTelemetryForTests(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return { send };
    });
    const input = { tenantId: "t1", jobType: "CONTENT_GENERATION" as const, status: "completed" as const, model: "m", durationMs: 5 };
    await emitAiJobFinished({ ...input, jobId: "r1" });
    await emitAiJobFinished({ ...input, jobId: "r2" });
    expect(calls).toBe(2);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

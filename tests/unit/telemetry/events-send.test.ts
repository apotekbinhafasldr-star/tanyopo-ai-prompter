import { describe, expect, it, vi } from "vitest";
import { durationBucket, validateEvent } from "@/lib/telemetry/events";
import { createTelemetry, uuidV5, type TelemetryTransport } from "@/lib/telemetry/send";
import type { TelemetryConfig } from "@/lib/telemetry/config";

const HASH = "a".repeat(32);
const GOOD_JOB = {
  env: "preview",
  app_version: "abc1234",
  tenant_hash: HASH,
  job_type: "CONTENT_GENERATION",
  status: "completed",
  model: "claude-sonnet-5",
  duration_bucket: "1_5s",
};
const GOOD_ERR = {
  env: "preview",
  app_version: "abc1234",
  tenant_hash: HASH,
  surface: "ai_job",
  error_name: "AIProviderError",
  error_category: "RATE_LIMIT",
  http_status: 429,
  route_group: "ai_jobs",
};
const ON: TelemetryConfig = {
  enabled: true,
  apiKey: "phc_" + "a".repeat(30),
  host: "https://us.i.posthog.com",
  salt: "s".repeat(40),
  env: "preview",
  appVersion: "abc1234",
};

describe("event allowlist (strictObject rejects, never strips)", () => {
  it("accepts the two Phase 1 events", () => {
    expect(validateEvent("ai_job_finished", GOOD_JOB).ok).toBe(true);
    expect(validateEvent("app_error", GOOD_ERR).ok).toBe(true);
  });
  it("rejects the WHOLE event when any extra property is present", () => {
    for (const extra of ["email", "prompt", "error_message", "stack", "token", "ip", "url", "tenant_id"]) {
      const r = validateEvent("ai_job_finished", { ...GOOD_JOB, [extra]: "x" });
      expect(r.ok).toBe(false);
    }
  });
  it("rejects unknown event names, including native exceptions", () => {
    for (const name of ["$exception", "$pageview", "signup", "__proto__", "constructor", ""]) {
      expect(validateEvent(name, GOOD_JOB).ok).toBe(false);
    }
  });
  it("rejects bad values (raw tenant id, unknown category, bad status code)", () => {
    expect(validateEvent("ai_job_finished", { ...GOOD_JOB, tenant_hash: "11111111-2222-3333-4444-555555555555" }).ok).toBe(false);
    expect(validateEvent("app_error", { ...GOOD_ERR, error_category: "WHATEVER" }).ok).toBe(false);
    expect(validateEvent("app_error", { ...GOOD_ERR, http_status: 99 }).ok).toBe(false);
    expect(validateEvent("app_error", { ...GOOD_ERR, error_name: "bad name with spaces: secret" }).ok).toBe(false);
  });
  it("failure output contains issue codes and paths only, never values", () => {
    const r = validateEvent("ai_job_finished", { ...GOOD_JOB, model: "SECRET-VALUE sk-live-123 !!!" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.issues)).not.toContain("SECRET");
  });
  it("buckets durations", () => {
    expect([durationBucket(10), durationBucket(2000), durationBucket(10000), durationBucket(60000), durationBucket(NaN)]).toEqual([
      "lt_1s",
      "1_5s",
      "5_30s",
      "gt_30s",
      "lt_1s",
    ]);
  });
});

function mockTransport(impl?: () => Promise<void>) {
  const send = vi.fn(impl ?? (async () => {}));
  const transport: TelemetryTransport = { send };
  return { transport, send };
}

describe("telemetry sender", () => {
  it("OFF: no transport is ever requested and nothing is sent", async () => {
    const getTransport = vi.fn();
    const t = createTelemetry({ config: { enabled: false }, getTransport });
    expect(await t.emit("ai_job_finished", GOOD_JOB, HASH, "job-1")).toBe("skipped");
    expect(getTransport).not.toHaveBeenCalled();
  });

  it("sends an allowlisted event with no person profile, GeoIP off and a deterministic id", async () => {
    const { transport, send } = mockTransport();
    const t = createTelemetry({ config: ON, getTransport: async () => transport });
    expect(await t.emit("ai_job_finished", GOOD_JOB, HASH, "job-1")).toBe("sent");
    const msg = send.mock.calls[0][0];
    expect(msg.distinctId).toBe(HASH);
    expect(msg.disableGeoip).toBe(true);
    expect(msg.properties.$process_person_profile).toBe(false);
    expect(msg.uuid).toBe(uuidV5("ai_job_finished:job-1"));
    expect(msg.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("canary data never reaches the transport or the logs", async () => {
    const { transport, send } = mockTransport();
    const logs: string[] = [];
    const t = createTelemetry({ config: ON, getTransport: async () => transport, log: (l) => logs.push(l) });
    const canary = { ...GOOD_JOB, email: "ani@example.com", prompt: "SECRET PROMPT", token: "sk-live-XYZ" };
    expect(await t.emit("ai_job_finished", canary, HASH, "job-2")).toBe("rejected");
    expect(send).not.toHaveBeenCalled();
    expect(logs.join("\n")).not.toMatch(/ani@example|SECRET|sk-live/);
  });

  it("sends at most once per job even if emitted repeatedly", async () => {
    const { transport, send } = mockTransport();
    const t = createTelemetry({ config: ON, getTransport: async () => transport });
    expect(await t.emit("ai_job_finished", GOOD_JOB, HASH, "job-3")).toBe("sent");
    expect(await t.emit("ai_job_finished", GOOD_JOB, HASH, "job-3")).toBe("skipped");
    expect(await t.emit("ai_job_finished", GOOD_JOB, HASH, "job-3")).toBe("skipped");
    expect(send).toHaveBeenCalledTimes(1);
    // A different event for the same job id is a different dedupe key.
    expect(await t.emit("app_error", GOOD_ERR, HASH, "job-3")).toBe("sent");
  });

  it("a failing transport never throws; the failure is swallowed", async () => {
    const { transport } = mockTransport(async () => {
      throw new Error("boom: secret-in-message");
    });
    const logs: string[] = [];
    const t = createTelemetry({ config: ON, getTransport: async () => transport, log: (l) => logs.push(l) });
    expect(await t.emit("ai_job_finished", GOOD_JOB, HASH, "job-4")).toBe("failed");
    expect(logs.join("\n")).not.toContain("secret-in-message");
  });

  it("a hanging transport is cut off by the timeout", async () => {
    const { transport } = mockTransport(() => new Promise<void>(() => {}));
    const t = createTelemetry({ config: ON, getTransport: async () => transport, timeoutMs: 30 });
    expect(await t.emit("ai_job_finished", GOOD_JOB, HASH, "job-5")).toBe("failed");
  });

  it("a failing getTransport (e.g. SDK missing) is fail-open", async () => {
    const t = createTelemetry({
      config: ON,
      getTransport: async () => {
        throw new Error("Cannot find module");
      },
      log: () => {},
    });
    expect(await t.emit("ai_job_finished", GOOD_JOB, HASH, "job-6")).toBe("failed");
  });

  it("circuit breaker opens after consecutive failures and skips, then recovers after the cooldown", async () => {
    let clock = 1_000;
    const { transport, send } = mockTransport(async () => {
      throw new Error("down");
    });
    const t = createTelemetry({
      config: ON,
      getTransport: async () => transport,
      now: () => clock,
      breakerThreshold: 3,
      breakerCooldownMs: 60_000,
      log: () => {},
    });
    for (const id of ["a", "b", "c"]) expect(await t.emit("ai_job_finished", GOOD_JOB, HASH, id)).toBe("failed");
    expect(await t.emit("ai_job_finished", GOOD_JOB, HASH, "d")).toBe("skipped");
    expect(send).toHaveBeenCalledTimes(3);
    clock += 61_000;
    expect(await t.emit("ai_job_finished", GOOD_JOB, HASH, "e")).toBe("failed");
    expect(send).toHaveBeenCalledTimes(4);
  });
});

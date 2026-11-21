import { describe, expect, it } from "vitest";
import { readTelemetryConfig } from "@/lib/telemetry/config";
import { SYSTEM_TENANT_HASH, tenantHash } from "@/lib/telemetry/identity";

const KEY = "phc_" + "a".repeat(30);
const SALT = "s".repeat(40);
const ON = { POSTHOG_TELEMETRY_ENABLED: "true", POSTHOG_API_KEY: KEY, POSTHOG_ID_SALT: SALT };

describe("telemetry config: default OFF", () => {
  it("is OFF with an empty environment", () => {
    expect(readTelemetryConfig({})).toEqual({ enabled: false });
  });
  it("is OFF unless the kill switch is exactly 'true'", () => {
    for (const v of ["1", "TRUE", "yes", "false", ""]) {
      expect(readTelemetryConfig({ ...ON, POSTHOG_TELEMETRY_ENABLED: v }).enabled).toBe(false);
    }
  });
  it("is OFF when the key, salt or host is missing or invalid", () => {
    expect(readTelemetryConfig({ ...ON, POSTHOG_API_KEY: undefined }).enabled).toBe(false);
    expect(readTelemetryConfig({ ...ON, POSTHOG_API_KEY: "not-a-key" }).enabled).toBe(false);
    expect(readTelemetryConfig({ ...ON, POSTHOG_ID_SALT: undefined }).enabled).toBe(false);
    expect(readTelemetryConfig({ ...ON, POSTHOG_ID_SALT: "short" }).enabled).toBe(false);
    expect(readTelemetryConfig({ ...ON, POSTHOG_HOST: "https://evil.example.com" }).enabled).toBe(false);
    expect(readTelemetryConfig({ ...ON, POSTHOG_HOST: "http://us.i.posthog.com" }).enabled).toBe(false);
  });
  it("is ON only with the full configuration and defaults to the US host", () => {
    const c = readTelemetryConfig(ON);
    expect(c.enabled).toBe(true);
    if (c.enabled) expect(c.host).toBe("https://us.i.posthog.com");
  });
  it("treats an unknown deploy context as preview, never production", () => {
    const unknown = readTelemetryConfig(ON);
    const prod = readTelemetryConfig({ ...ON, CONTEXT: "production" });
    const deployPreview = readTelemetryConfig({ ...ON, CONTEXT: "deploy-preview" });
    if (unknown.enabled && prod.enabled && deployPreview.enabled) {
      expect(unknown.env).toBe("preview");
      expect(prod.env).toBe("production");
      expect(deployPreview.env).toBe("preview");
    } else {
      throw new Error("expected enabled");
    }
  });
});

describe("tenant hash", () => {
  it("is deterministic, 32 hex chars, and never contains the raw tenant id", () => {
    const a = tenantHash("tenant-uuid-1", SALT);
    expect(a).toBe(tenantHash("tenant-uuid-1", SALT));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain("tenant-uuid-1");
  });
  it("differs between tenants and between salts (isolation)", () => {
    expect(tenantHash("t1", SALT)).not.toBe(tenantHash("t2", SALT));
    expect(tenantHash("t1", SALT)).not.toBe(tenantHash("t1", "x".repeat(40)));
  });
  it("uses the constant 'system' when there is no tenant", () => {
    expect(tenantHash(null, SALT)).toBe(SYSTEM_TENANT_HASH);
    expect(tenantHash("", SALT)).toBe(SYSTEM_TENANT_HASH);
  });
});

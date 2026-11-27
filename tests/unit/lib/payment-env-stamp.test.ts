// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyWebhookError, envMismatchMarker } from "@/lib/billing/webhook-markers";
import { checkStamp, readEnvStamp, withEnvStamp, ENV_MISMATCH_REASONS } from "@/lib/billing/payment-env-stamp";

const SANDBOX = "abcdefghij0123456789";
const OTHER = "zyxwvutsrq9876543210";

describe("D3 stamp — build / read", () => {
  it("merges the stamp into existing metadata without dropping anything", () => {
    const merged = withEnvStamp({ checkout_url: "https://pay.example/x", review: { a: 1 } }, { env: "sandbox", dbRef: SANDBOX });
    expect(merged).toEqual({ checkout_url: "https://pay.example/x", review: { a: 1 }, pg_env: "sandbox", pg_db_ref: SANDBOX });
  });

  it("starts from an empty object when metadata is null, an array or a scalar", () => {
    for (const bad of [null, undefined, [], "x", 5]) {
      expect(withEnvStamp(bad, { env: "live", dbRef: SANDBOX })).toEqual({ pg_env: "live", pg_db_ref: SANDBOX });
    }
  });

  it("reads a valid stamp and refuses anything malformed (never guesses)", () => {
    expect(readEnvStamp({ pg_env: "sandbox", pg_db_ref: SANDBOX })).toEqual({ env: "sandbox", dbRef: SANDBOX });
    expect(readEnvStamp({ pg_env: "live", pg_db_ref: SANDBOX })).toEqual({ env: "live", dbRef: SANDBOX });
    for (const bad of [null, undefined, {}, [], { pg_env: "sandbox" }, { pg_db_ref: SANDBOX }, { pg_env: "production", pg_db_ref: SANDBOX }, { pg_env: "sandbox", pg_db_ref: "short" }, { pg_env: "sandbox", pg_db_ref: 5 }]) {
      expect(readEnvStamp(bad)).toBeNull();
    }
  });
});

describe("D3 stamp — check against the runtime", () => {
  const sandbox = { env: "sandbox" as const, dbRef: SANDBOX };
  const live = { env: "live" as const, dbRef: SANDBOX };

  it("matching stamp passes", () => {
    expect(checkStamp(sandbox, sandbox)).toEqual({ ok: true });
    expect(checkStamp(live, live)).toEqual({ ok: true });
  });

  it("D4/D5: an environment change is refused in both directions", () => {
    expect(checkStamp(sandbox, live)).toEqual({ ok: false, reason: "SANDBOX_TXN_IN_LIVE" });
    expect(checkStamp(live, sandbox)).toEqual({ ok: false, reason: "LIVE_TXN_IN_SANDBOX" });
  });

  it("D6: another database project is refused", () => {
    expect(checkStamp(sandbox, { env: "sandbox", dbRef: OTHER })).toEqual({ ok: false, reason: "DB_REF_CHANGED" });
  });

  it("D7: a missing stamp and an unprovable runtime are refused", () => {
    expect(checkStamp(null, sandbox)).toEqual({ ok: false, reason: "STAMP_MISSING" });
    expect(checkStamp(sandbox, null)).toEqual({ ok: false, reason: "RUNTIME_UNPROVABLE" });
    expect(checkStamp(null, null)).toEqual({ ok: false, reason: "RUNTIME_UNPROVABLE" });
  });

  it("every refusal reason belongs to the closed set", () => {
    const reasons = [checkStamp(sandbox, live), checkStamp(live, sandbox), checkStamp(null, sandbox), checkStamp(sandbox, null), checkStamp(sandbox, { env: "sandbox", dbRef: OTHER })];
    for (const r of reasons) expect(r.ok === false && ENV_MISMATCH_REASONS.includes(r.reason)).toBe(true);
  });
});

describe("D3 — webhook marker", () => {
  it("builds ENV_MISMATCH:<reason> from the closed reason set only and the health card counts it as a verification failure", () => {
    for (const reason of ENV_MISMATCH_REASONS) {
      expect(envMismatchMarker(reason)).toBe(`ENV_MISMATCH:${reason}`);
      expect(classifyWebhookError(envMismatchMarker(reason))).toBe("VERIFICATION_FAILED");
    }
    expect(envMismatchMarker("a@b.c; drop")).toBe("ENV_MISMATCH:?");
    expect(envMismatchMarker("")).toBe("ENV_MISMATCH:?");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readTrialAbuseConfig } from "@/lib/trial-abuse/config";
import {
  blockedMessage,
  finalizeTrialAttempt,
  isValidDeviceCookie,
  newDeviceCookieValue,
  runTrialGate,
} from "@/lib/trial-abuse/gate";

const SECRET = Buffer.alloc(32, 9).toString("base64");
const cfg = (env: Record<string, string>) => readTrialAbuseConfig(env);
const baseInput = {
  email: "Budi.Santoso+x@gmail.com",
  clientIp: "203.0.113.77",
  userAgent: "Mozilla/5.0 (Linux; Android 14)",
  rawSignals: JSON.stringify({ tz: "Asia/Jakarta", lang: "id", sw: 412, sh: 915, dpr: 2.6, hc: 8 }),
  cookieValue: newDeviceCookieValue(),
};

type Row = { decision: string; attempt_id: string | null; risk_score: number; reasons: string[]; retry_after_seconds: number };
function fakeAdmin(result: { data?: Row[] | null; error?: { code?: string } | null } | Error) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (result instanceof Error) throw result;
      return { data: result.data ?? null, error: result.error ?? null };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, calls };
}
const row = (decision: string, extra: Partial<Row> = {}): Row => ({
  decision, attempt_id: "11111111-1111-1111-1111-111111111111", risk_score: 0, reasons: [], retry_after_seconds: 0, ...extra,
});

describe("runTrialGate — mode off", () => {
  it("proceeds without touching the database or reading any secret", async () => {
    const { admin, calls } = fakeAdmin(new Error("must not be called"));
    const r = await runTrialGate(baseInput, { config: cfg({}), admin });
    expect(r).toEqual({ action: "proceed", attemptId: null, review: false });
    expect(calls).toHaveLength(0);
  });
});

describe("runTrialGate — pseudonymous payload", () => {
  it("sends only 64-hex digests: no raw email, IP, cookie or signal ever leaves the server", async () => {
    const { admin, calls } = fakeAdmin({ data: [row("ALLOW")] });
    await runTrialGate(baseInput, { config: cfg({ TRIAL_ABUSE_MODE: "enforce", TRIAL_ABUSE_HMAC_SECRET: SECRET }), admin });
    expect(calls).toHaveLength(1);
    const a = calls[0].args as Record<string, string | number>;
    const serialized = JSON.stringify(a);
    for (const raw of ["budi", "gmail", "203.0.113", baseInput.cookieValue, "Asia/Jakarta", "Android"]) {
      expect(serialized).not.toContain(raw);
    }
    for (const k of ["p_email_hmac", "p_cookie_hmac", "p_device_hmac", "p_ip_hmac"]) expect(String(a[k])).toMatch(/^[0-9a-f]{64}$/);
    expect(a.p_mode).toBe("enforce");
  });

  it("aliases of one mailbox produce the same email digest", async () => {
    const one = fakeAdmin({ data: [row("ALLOW")] });
    const two = fakeAdmin({ data: [row("ALLOW")] });
    const config = cfg({ TRIAL_ABUSE_MODE: "enforce", TRIAL_ABUSE_HMAC_SECRET: SECRET });
    await runTrialGate({ ...baseInput, email: "budisantoso@gmail.com" }, { config, admin: one.admin });
    await runTrialGate({ ...baseInput, email: "B.U.D.I.santoso+promo2@googlemail.com" }, { config, admin: two.admin });
    expect(one.calls[0].args.p_email_hmac).toBe(two.calls[0].args.p_email_hmac);
  });

  it("missing/garbled cookie, signals and unknown IP are sent as null (not as junk)", async () => {
    const { admin, calls } = fakeAdmin({ data: [row("ALLOW")] });
    await runTrialGate(
      { ...baseInput, cookieValue: "short", rawSignals: "garbage", clientIp: "unknown" },
      { config: cfg({ TRIAL_ABUSE_MODE: "enforce", TRIAL_ABUSE_HMAC_SECRET: SECRET }), admin },
    );
    expect(calls[0].args.p_cookie_hmac).toBeNull();
    expect(calls[0].args.p_device_hmac).toBeNull();
    expect(calls[0].args.p_ip_hmac).toBeNull();
  });
});

describe("runTrialGate — enforce decisions", () => {
  const config = cfg({ TRIAL_ABUSE_MODE: "enforce", TRIAL_ABUSE_HMAC_SECRET: SECRET });

  it("ALLOW proceeds, REVIEW proceeds flagged for review", async () => {
    expect(await runTrialGate(baseInput, { config, admin: fakeAdmin({ data: [row("ALLOW")] }).admin })).toMatchObject({ action: "proceed", review: false });
    expect(await runTrialGate(baseInput, { config, admin: fakeAdmin({ data: [row("REVIEW")] }).admin })).toMatchObject({ action: "proceed", review: true });
  });

  it("DENY by repeat evidence blocks as REPEAT_TRIAL; DENY by rate limit blocks as RATE_LIMITED with retry", async () => {
    const repeat = await runTrialGate(baseInput, { config, admin: fakeAdmin({ data: [row("DENY", { reasons: ["COOKIE_REPEAT_2"] })] }).admin });
    expect(repeat).toEqual({ action: "block", reason: "REPEAT_TRIAL" });
    const rate = await runTrialGate(baseInput, { config, admin: fakeAdmin({ data: [row("DENY", { reasons: ["RATE_IP_HOUR"], retry_after_seconds: 1800 })] }).admin });
    expect(rate).toEqual({ action: "block", reason: "RATE_LIMITED", retryAfterSeconds: 1800 });
  });

  it("FAILS CLOSED on every failure path", async () => {
    const closed = { action: "block", reason: "UNAVAILABLE" };
    expect(await runTrialGate(baseInput, { config: cfg({ TRIAL_ABUSE_MODE: "enforce" }), admin: fakeAdmin({ data: [row("ALLOW")] }).admin })).toEqual(closed); // no secret
    expect(await runTrialGate(baseInput, { config, admin: null })).toEqual(closed); // no admin client
    expect(await runTrialGate(baseInput, { config, admin: fakeAdmin({ error: { code: "XX000" } }).admin })).toEqual(closed); // rpc error
    expect(await runTrialGate(baseInput, { config, admin: fakeAdmin(new Error("network")).admin })).toEqual(closed); // throw
    expect(await runTrialGate(baseInput, { config, admin: fakeAdmin({ data: [] }).admin })).toEqual(closed); // empty
    expect(await runTrialGate(baseInput, { config, admin: fakeAdmin({ data: [row("MAYBE")] }).admin })).toEqual(closed); // garbage decision
  });

  it("an invalid mode blocks signups instead of silently disabling the control", async () => {
    const r = await runTrialGate(baseInput, { config: cfg({ TRIAL_ABUSE_MODE: "enforec", TRIAL_ABUSE_HMAC_SECRET: SECRET }), admin: fakeAdmin({ data: [row("ALLOW")] }).admin });
    expect(r).toEqual({ action: "block", reason: "MISCONFIGURED" });
  });
});

describe("runTrialGate — shadow never blocks", () => {
  const config = cfg({ TRIAL_ABUSE_MODE: "shadow", TRIAL_ABUSE_HMAC_SECRET: SECRET });

  it("proceeds even when the gate says DENY, and never reports review", async () => {
    const r = await runTrialGate(baseInput, { config, admin: fakeAdmin({ data: [row("DENY", { reasons: ["COOKIE_REPEAT_2"] })] }).admin });
    expect(r).toMatchObject({ action: "proceed", review: false });
  });

  it("proceeds (fail-open) on every failure, so measurement can never lock out real users", async () => {
    const open = { action: "proceed", attemptId: null, review: false };
    expect(await runTrialGate(baseInput, { config: cfg({ TRIAL_ABUSE_MODE: "shadow" }), admin: fakeAdmin({ data: [row("ALLOW")] }).admin })).toEqual(open);
    expect(await runTrialGate(baseInput, { config, admin: null })).toEqual(open);
    expect(await runTrialGate(baseInput, { config, admin: fakeAdmin({ error: { code: "XX000" } }).admin })).toEqual(open);
    expect(await runTrialGate(baseInput, { config, admin: fakeAdmin(new Error("boom")).admin })).toEqual(open);
  });
});

describe("finalizeTrialAttempt", () => {
  it("does nothing without an attempt id", async () => {
    const { admin, calls } = fakeAdmin({ data: null });
    expect(await finalizeTrialAttempt(null, "u", true, { admin })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("links the user on success and sends no user id when aborting", async () => {
    const ok = fakeAdmin({ data: true as unknown as Row[] });
    expect(await finalizeTrialAttempt("a", "user-1", true, { admin: ok.admin })).toBe(true);
    expect(ok.calls[0].args).toEqual({ p_attempt_id: "a", p_user_id: "user-1", p_signed_up: true });
    const ab = fakeAdmin({ data: true as unknown as Row[] });
    await finalizeTrialAttempt("a", "user-1", false, { admin: ab.admin });
    expect(ab.calls[0].args).toEqual({ p_attempt_id: "a", p_user_id: null, p_signed_up: false });
  });

  it("retries once and never throws", async () => {
    const f = fakeAdmin(new Error("down"));
    expect(await finalizeTrialAttempt("a", "u", true, { admin: f.admin })).toBe(false);
    expect(f.calls).toHaveLength(2);
  });
});

describe("device cookie + messages", () => {
  it("generated cookie values are valid and unique", () => {
    const a = newDeviceCookieValue();
    expect(isValidDeviceCookie(a)).toBe(true);
    expect(a).not.toBe(newDeviceCookieValue());
    expect(isValidDeviceCookie("nope")).toBe(false);
    expect(isValidDeviceCookie(undefined)).toBe(false);
  });

  it("blocked messages never reveal which signal triggered, and point to a human recovery path", () => {
    const m = blockedMessage({ action: "block", reason: "REPEAT_TRIAL" });
    expect(m).toMatch(/hubungi/i);
    expect(m).not.toMatch(/cookie|fingerprint|sidik jari|\bIP\b/i);
    expect(blockedMessage({ action: "block", reason: "RATE_LIMITED", retryAfterSeconds: 1800 })).toMatch(/30 menit/);
  });
});

describe("registerAction wiring (static)", () => {
  const src = readFileSync(path.resolve(__dirname, "../../../features/auth/actions.ts"), "utf-8");
  const reg = src.slice(src.indexOf("export async function registerAction"), src.indexOf("export async function logoutAction"));

  it("runs the existing in-memory limiter first, then the gate, then signUp", () => {
    const iLimit = reg.indexOf("checkRateLimit(");
    const iGate = reg.indexOf("runTrialGate(");
    const iSignUp = reg.indexOf("supabase.auth.signUp(");
    expect(iLimit).toBe(reg.indexOf("checkRateLimit("));
    expect(iLimit < iGate).toBe(true);
    expect(iGate < iSignUp).toBe(true);
  });

  it("a blocked gate result returns before signUp is ever called", () => {
    const iBlock = reg.indexOf('gate.action === "block"');
    expect(iBlock > 0 && iBlock < reg.indexOf("supabase.auth.signUp(")).toBe(true);
  });

  it("every post-signUp exit finalizes the attempt (existing account, error, success)", () => {
    expect((reg.match(/finalizeTrialAttempt\(/g) ?? []).length).toBe(3);
  });

  it("device cookie is only created while collection is enabled", () => {
    expect(reg).toMatch(/if \(isCollectionEnabled\(abuseConfig\)\) \{[\s\S]*cookieStore\.set\(DEVICE_COOKIE/);
    expect(reg).toMatch(/httpOnly: true/);
    expect(reg).toMatch(/sameSite: "lax"/);
  });
});

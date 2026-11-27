// @vitest-environment node
/**
 * QA/Security (2026-11-11) — abuse controls on the unauthenticated auth actions.
 *
 * Both items below are VERIFIED GAPS whose fix is an auth change (features/auth/*), i.e. "butuh persetujuan Founder".
 * They are pinned as the CURRENT state: green while the gap exists, red the day it is closed (then invert the
 * assertion so it guards the fix).
 *
 *  SEC-01  registerAction / verifyEmailOtpAction / resendSignupOtpAction key their limiters on lib/rate-limit.ts
 *          getClientIp(), which falls back to the client-controlled first hop of x-forwarded-for. If the Netlify
 *          header is absent (or, UNVERIFIED, forwardable by a client), every request can claim a fresh "IP", so the
 *          per-IP brake on trial-farming and OTP guessing is bypassable. The per-email OTP limits still hold.
 *          Fix design: use getTrustedClientIp() + ipBucketKey() from lib/security/client-ip.ts, with a shared strict
 *          bucket when it returns null (exactly what app/api/demo/start/route.ts already does).
 *  SEC-02  loginAction has no application throttle (lib/security/login-throttle.ts exists, is tested, and is not
 *          wired). Only Supabase Auth's own per-IP limit applies.
 *          Fix design: call checkLoginThrottle(ip, email) after schema validation and before signInWithPassword,
 *          answering with LOGIN_THROTTLED_MESSAGE.
 *
 * Label: CODE + UNIT TEST. No network, no database.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getClientIp } from "@/lib/rate-limit";
import { getTrustedClientIp } from "@/lib/security/client-ip";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("security: SEC-01 client IP used by the signup / OTP limiters", () => {
  it("evidence: getClientIp() believes a client-supplied x-forwarded-for when the Netlify header is missing", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.77, 10.0.0.1" });
    expect(getClientIp(headers)).toBe("203.0.113.77");
    // ...whereas the helper written for the demo route refuses it.
    expect(getTrustedClientIp(headers)).toBeNull();
  });

  it("evidence: rotating x-forwarded-for yields a different limiter key every request", () => {
    const keys = new Set([1, 2, 3, 4].map((n) => getClientIp(new Headers({ "x-forwarded-for": `198.51.100.${n}` }))));
    expect(keys.size).toBe(4);
  });

  it("KNOWN GAP (pinned as-is): registerAction and the OTP actions still use getClientIp, not getTrustedClientIp", () => {
    for (const file of ["features/auth/actions.ts", "features/auth/otp-actions.ts"]) {
      const src = read(file);
      expect(src, file).not.toContain("getTrustedClientIp(");
      expect(src, file).toMatch(/\bgetClientIp\(/);
    }
  });

  it("control that already holds: the OTP verify limiter is also keyed per email, which XFF rotation cannot dodge", () => {
    expect(read("features/auth/otp-actions.ts")).toMatch(/otp-verify-email:\$\{email\.toLowerCase\(\)\}/);
  });
});

describe("security: SEC-02 login throttle", () => {
  it("KNOWN GAP (pinned as-is): loginAction does not call checkLoginThrottle", () => {
    const src = read("features/auth/actions.ts");
    const loginBody = src.slice(src.indexOf("export async function loginAction"), src.indexOf("export async function registerAction"));
    expect(loginBody).toContain("signInWithPassword(");
    expect(loginBody).not.toContain("checkLoginThrottle(");
    expect(src).not.toContain("login-throttle");
  });

  it("control that already holds: login answers one generic message for wrong email and wrong password (no account enumeration)", () => {
    const src = read("features/auth/actions.ts");
    const loginBody = src.slice(src.indexOf("export async function loginAction"), src.indexOf("export async function registerAction"));
    expect(loginBody).toContain("Email atau kata sandi salah.");
    expect(loginBody).not.toMatch(/user not found|email not found|tidak terdaftar/i);
  });
});

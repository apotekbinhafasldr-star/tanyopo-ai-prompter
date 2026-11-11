import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Pure login throttle (docs/SOFT_LAUNCH_10_TENANTS.md, P1-1). NOT WIRED YET.
 *
 * loginAction (features/auth/actions.ts) has no app-level limiter today; only Supabase Auth's own per-IP limits
 * apply (150 token requests / 5 min / IP per Supabase docs, accessed 2026-11-11). Wiring this in is an auth change and
 * needs explicit Founder approval, so this file only provides the tested building block: call
 * `checkLoginThrottle(ip, email)` after input validation and BEFORE `signInWithPassword`, and answer a blocked
 * attempt with LOGIN_THROTTLED_MESSAGE (same text for both reasons, so it is not an account-enumeration oracle).
 *
 * Same honest limit as lib/rate-limit.ts: in-memory, per server instance, resets on deploy. It is a brake against a
 * naive guessing loop, not a distributed guarantee. Successful logins are counted too (the window is generous enough
 * that a real user never notices).
 */
export const LOGIN_IP_LIMIT = 20;
export const LOGIN_EMAIL_LIMIT = 8;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const LOGIN_THROTTLED_MESSAGE = "Terlalu banyak percobaan masuk. Silakan coba lagi dalam beberapa menit.";

export type LoginThrottleResult = { allowed: true } | { allowed: false; reason: "IP" | "EMAIL"; retryAt: number };

export function checkLoginThrottle(ip: string, email: string, now: number = Date.now()): LoginThrottleResult {
  const byIp = checkRateLimit(`login-ip:${ip}`, LOGIN_IP_LIMIT, LOGIN_WINDOW_MS, now);
  if (!byIp.allowed) return { allowed: false, reason: "IP", retryAt: byIp.resetAt };

  const normalizedEmail = email.trim().toLowerCase();
  const byEmail = checkRateLimit(`login-email:${normalizedEmail}`, LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_MS, now);
  if (!byEmail.allowed) return { allowed: false, reason: "EMAIL", retryAt: byEmail.resetAt };

  return { allowed: true };
}

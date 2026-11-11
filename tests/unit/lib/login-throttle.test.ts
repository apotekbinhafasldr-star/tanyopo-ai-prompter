import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimitStateForTests } from "@/lib/rate-limit";
import {
  checkLoginThrottle,
  getAuthClientBucket,
  LOGIN_IP_LIMIT,
  LOGIN_PAIR_LIMIT,
  LOGIN_THROTTLED_MESSAGE,
  LOGIN_UNIDENTIFIED_LIMIT,
  LOGIN_WINDOW_MS,
  recordLoginFailure,
  resetLoginThrottle,
  type AuthClientBucket,
} from "@/lib/security/login-throttle";

const ip = (addr: string) => getAuthClientBucket(new Headers({ "x-nf-client-connection-ip": addr }));
const unidentified = (): AuthClientBucket => getAuthClientBucket(new Headers());

describe("login throttle (failures only, IP+email and IP, never email alone)", () => {
  beforeEach(() => __resetRateLimitStateForTests());

  it("allows when nothing has failed, and checking alone never counts", () => {
    for (let i = 0; i < 100; i += 1) expect(checkLoginThrottle(ip("1.1.1.1"), "a@example.com", 0)).toEqual({ allowed: true });
  });

  it("blocks one IP+email pair after LOGIN_PAIR_LIMIT failures", () => {
    for (let i = 0; i < LOGIN_PAIR_LIMIT; i += 1) {
      expect(checkLoginThrottle(ip("1.1.1.1"), "a@example.com", i).allowed).toBe(true);
      recordLoginFailure(ip("1.1.1.1"), "a@example.com", i);
    }
    expect(checkLoginThrottle(ip("1.1.1.1"), "a@example.com", 100)).toMatchObject({ allowed: false, reason: "PAIR" });
  });

  it("does NOT block the same email from a different IP (a victim cannot be locked out from elsewhere)", () => {
    for (let i = 0; i < LOGIN_PAIR_LIMIT * 3; i += 1) recordLoginFailure(ip("6.6.6.6"), "victim@example.com", i);
    expect(checkLoginThrottle(ip("7.7.7.7"), "victim@example.com", 100)).toEqual({ allowed: true });
  });

  it("treats email case and surrounding spaces as the same account", () => {
    for (let i = 0; i < LOGIN_PAIR_LIMIT; i += 1) recordLoginFailure(ip("1.1.1.1"), "Victim@Example.com ", i);
    expect(checkLoginThrottle(ip("1.1.1.1"), " victim@example.COM", 50)).toMatchObject({ allowed: false, reason: "PAIR" });
  });

  it("blocks one IP after LOGIN_IP_LIMIT failures across many emails", () => {
    for (let i = 0; i < LOGIN_IP_LIMIT; i += 1) recordLoginFailure(ip("2.2.2.2"), `user${i}@example.com`, i);
    expect(checkLoginThrottle(ip("2.2.2.2"), "fresh@example.com", 500)).toMatchObject({ allowed: false, reason: "IP" });
    expect(checkLoginThrottle(ip("2.2.2.3"), "fresh@example.com", 500)).toEqual({ allowed: true });
  });

  it("an IPv6 /64 is one client", () => {
    for (let i = 0; i < LOGIN_PAIR_LIMIT; i += 1) recordLoginFailure(ip(`2001:db8:1:2::${i + 1}`), "a@example.com", i);
    expect(checkLoginThrottle(ip("2001:db8:1:2:ffff::9"), "a@example.com", 50).allowed).toBe(false);
    expect(checkLoginThrottle(ip("2001:db8:1:3::1"), "a@example.com", 50).allowed).toBe(true);
  });

  it("without a trusted IP everyone shares one stricter-than-global bucket", () => {
    expect(unidentified()).toEqual({ key: "unidentified", identified: false });
    for (let i = 0; i < LOGIN_UNIDENTIFIED_LIMIT; i += 1) recordLoginFailure(unidentified(), `u${i}@example.com`, i);
    expect(checkLoginThrottle(unidentified(), "fresh@example.com", 500)).toMatchObject({ allowed: false, reason: "IP" });
    expect(checkLoginThrottle(ip("9.9.9.9"), "fresh@example.com", 500)).toEqual({ allowed: true });
  });

  it("a blocked check never extends the window: allowed again once LOGIN_WINDOW_MS passed since the first failure", () => {
    for (let i = 0; i < LOGIN_PAIR_LIMIT; i += 1) recordLoginFailure(ip("5.5.5.5"), "x@example.com", 0);
    const blocked = checkLoginThrottle(ip("5.5.5.5"), "x@example.com", LOGIN_WINDOW_MS - 1);
    expect(blocked).toEqual({ allowed: false, reason: "PAIR", retryAt: LOGIN_WINDOW_MS });
    expect(checkLoginThrottle(ip("5.5.5.5"), "x@example.com", LOGIN_WINDOW_MS + 1).allowed).toBe(true);
  });

  it("reset clears the IP+email bucket but not the IP-only bucket", () => {
    for (let i = 0; i < LOGIN_PAIR_LIMIT; i += 1) recordLoginFailure(ip("8.8.8.8"), "me@example.com", i);
    resetLoginThrottle(ip("8.8.8.8"), "me@example.com");
    expect(checkLoginThrottle(ip("8.8.8.8"), "me@example.com", 50)).toEqual({ allowed: true });

    for (let i = 0; i < LOGIN_IP_LIMIT; i += 1) recordLoginFailure(ip("8.8.4.4"), `u${i}@example.com`, i);
    resetLoginThrottle(ip("8.8.4.4"), "u0@example.com");
    expect(checkLoginThrottle(ip("8.8.4.4"), "other@example.com", 50).allowed).toBe(false);
  });

  it("uses one message that names neither the account nor the reason", () => {
    expect(LOGIN_THROTTLED_MESSAGE).not.toMatch(/email|akun|\bIP\b/i);
  });
});

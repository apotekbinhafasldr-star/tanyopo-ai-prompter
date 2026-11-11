import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimitStateForTests } from "@/lib/rate-limit";
import {
  checkLoginThrottle,
  LOGIN_EMAIL_LIMIT,
  LOGIN_IP_LIMIT,
  LOGIN_THROTTLED_MESSAGE,
  LOGIN_WINDOW_MS,
} from "@/lib/security/login-throttle";

describe("checkLoginThrottle", () => {
  beforeEach(() => __resetRateLimitStateForTests());

  it("allows attempts under both limits", () => {
    expect(checkLoginThrottle("1.1.1.1", "a@example.com", 0)).toEqual({ allowed: true });
  });

  it("blocks one email after LOGIN_EMAIL_LIMIT attempts, from any IP", () => {
    for (let i = 0; i < LOGIN_EMAIL_LIMIT; i += 1) {
      expect(checkLoginThrottle(`10.0.0.${i}`, "victim@example.com", i).allowed).toBe(true);
    }
    const blocked = checkLoginThrottle("10.0.1.1", "victim@example.com", 100);
    expect(blocked).toMatchObject({ allowed: false, reason: "EMAIL" });
  });

  it("treats email case and surrounding spaces as the same account", () => {
    for (let i = 0; i < LOGIN_EMAIL_LIMIT; i += 1) checkLoginThrottle(`10.0.0.${i}`, "Victim@Example.com ", i);
    expect(checkLoginThrottle("10.9.9.9", " victim@example.COM", 50)).toMatchObject({ allowed: false, reason: "EMAIL" });
  });

  it("blocks one IP after LOGIN_IP_LIMIT attempts across many emails", () => {
    for (let i = 0; i < LOGIN_IP_LIMIT; i += 1) {
      expect(checkLoginThrottle("2.2.2.2", `user${i}@example.com`, i).allowed).toBe(true);
    }
    expect(checkLoginThrottle("2.2.2.2", "fresh@example.com", 500)).toMatchObject({ allowed: false, reason: "IP" });
  });

  it("does not spend the email bucket when the IP is already blocked", () => {
    for (let i = 0; i < LOGIN_IP_LIMIT; i += 1) checkLoginThrottle("3.3.3.3", `u${i}@example.com`, i);
    checkLoginThrottle("3.3.3.3", "target@example.com", 100); // blocked by IP, must not count for the email
    for (let i = 0; i < LOGIN_EMAIL_LIMIT; i += 1) {
      expect(checkLoginThrottle(`4.4.4.${i}`, "target@example.com", 200 + i).allowed).toBe(true);
    }
  });

  it("reports when the window ends and allows again afterwards", () => {
    for (let i = 0; i < LOGIN_EMAIL_LIMIT; i += 1) checkLoginThrottle("5.5.5.5", "x@example.com", 0);
    const blocked = checkLoginThrottle("5.5.5.5", "x@example.com", 1_000);
    expect(blocked).toEqual({ allowed: false, reason: "EMAIL", retryAt: LOGIN_WINDOW_MS });
    expect(checkLoginThrottle("5.5.5.5", "x@example.com", LOGIN_WINDOW_MS + 1).allowed).toBe(true);
  });

  it("uses one message that names neither the account nor the reason", () => {
    expect(LOGIN_THROTTLED_MESSAGE).not.toMatch(/email|akun|IP/i);
  });
});

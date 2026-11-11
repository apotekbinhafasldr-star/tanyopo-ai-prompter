import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimitStateForTests } from "@/lib/rate-limit";
import {
  checkDemoStartLimit,
  DEMO_START_GLOBAL_LIMIT,
  DEMO_START_IP_LIMIT,
  DEMO_START_UNIDENTIFIED_LIMIT,
  DEMO_START_WINDOW_MS,
  isNonNavigationRequest,
} from "@/lib/demo/start-guard";

describe("checkDemoStartLimit", () => {
  beforeEach(() => __resetRateLimitStateForTests());

  it("allows the limit, blocks the next, reports retryAt, and resets after the window", () => {
    for (let i = 0; i < DEMO_START_IP_LIMIT; i += 1) expect(checkDemoStartLimit("1.1.1.1", 1_000).allowed).toBe(true);
    const blocked = checkDemoStartLimit("1.1.1.1", 2_000);
    expect(blocked).toEqual({ allowed: false, scope: "IP", retryAt: 1_000 + DEMO_START_WINDOW_MS });
    expect(checkDemoStartLimit("1.1.1.1", 1_000 + DEMO_START_WINDOW_MS).allowed).toBe(true);
  });

  it("uses the shared unidentified bucket when there is no trusted IP", () => {
    for (let i = 0; i < DEMO_START_UNIDENTIFIED_LIMIT; i += 1) expect(checkDemoStartLimit(null, 0).allowed).toBe(true);
    expect(checkDemoStartLimit(null, 1)).toMatchObject({ allowed: false, scope: "UNIDENTIFIED" });
  });

  it("enforces the global cap across IPs and does not charge the IP bucket for IPs that were blocked globally", () => {
    for (let i = 0; i < DEMO_START_GLOBAL_LIMIT; i += 1) checkDemoStartLimit(`10.0.${Math.floor(i / 250)}.${i % 250}`, 0);
    expect(checkDemoStartLimit("10.9.9.9", 1)).toMatchObject({ allowed: false, scope: "GLOBAL" });
  });

  it("treats two addresses in one IPv6 /64 as the same client", () => {
    for (let i = 0; i < DEMO_START_IP_LIMIT; i += 1) checkDemoStartLimit(`2001:db8:1:2::${i + 1}`, 0);
    expect(checkDemoStartLimit("2001:db8:1:2::ffff", 1)).toMatchObject({ allowed: false, scope: "IP" });
  });
});

describe("isNonNavigationRequest", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("lets real navigations and header-less clients through", () => {
    expect(isNonNavigationRequest(h({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "user-agent": "Mozilla/5.0 (Linux; Android 14; CUBOT_X30) Chrome/120" }))).toBe(false);
    expect(isNonNavigationRequest(h({}))).toBe(false);
  });
  it("flags prefetch, sub-resources, frames and crawlers", () => {
    expect(isNonNavigationRequest(h({ "next-router-prefetch": "1" }))).toBe(true);
    expect(isNonNavigationRequest(h({ "sec-fetch-mode": "cors" }))).toBe(true);
    expect(isNonNavigationRequest(h({ "sec-fetch-dest": "iframe" }))).toBe(true);
    expect(isNonNavigationRequest(h({ "user-agent": "facebookexternalhit/1.1" }))).toBe(true);
    expect(isNonNavigationRequest(h({ "user-agent": "WhatsApp/2.23" }))).toBe(true);
  });
});

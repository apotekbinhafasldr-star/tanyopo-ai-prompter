import { describe, expect, it } from "vitest";
import { getTrustedClientIp, ipBucketKey } from "@/lib/security/client-ip";

const h = (o: Record<string, string>) => new Headers(o);

describe("getTrustedClientIp", () => {
  it("returns the Netlify connection IP", () => {
    expect(getTrustedClientIp(h({ "x-nf-client-connection-ip": " 203.0.113.5 " }))).toBe("203.0.113.5");
  });
  it("never uses x-forwarded-for", () => {
    expect(getTrustedClientIp(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBeNull();
  });
  it("rejects non-IP values and oversize values", () => {
    expect(getTrustedClientIp(h({ "x-nf-client-connection-ip": "1.2.3.4, 5.6.7.8" }))).toBeNull();
    expect(getTrustedClientIp(h({ "x-nf-client-connection-ip": "<script>" }))).toBeNull();
    expect(getTrustedClientIp(h({ "x-nf-client-connection-ip": "a".repeat(100) }))).toBeNull();
    expect(getTrustedClientIp(h({}))).toBeNull();
  });
  it("accepts IPv6 and lowercases it", () => {
    expect(getTrustedClientIp(h({ "x-nf-client-connection-ip": "2001:DB8::1" }))).toBe("2001:db8::1");
  });
});

describe("ipBucketKey", () => {
  it("keeps IPv4 as is and unwraps IPv4-mapped IPv6", () => {
    expect(ipBucketKey("203.0.113.5")).toBe("203.0.113.5");
    expect(ipBucketKey("::ffff:203.0.113.5")).toBe("203.0.113.5");
  });
  it("groups an IPv6 /64 into one bucket and separates different /64s", () => {
    expect(ipBucketKey("2001:db8:1:2::1")).toBe(ipBucketKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd"));
    expect(ipBucketKey("2001:db8:1:2::1")).not.toBe(ipBucketKey("2001:db8:1:3::1"));
    expect(ipBucketKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });
});

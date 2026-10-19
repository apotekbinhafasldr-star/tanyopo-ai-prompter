import { describe, expect, it } from "vitest";
import { isCollectionEnabled, readTrialAbuseConfig } from "@/lib/trial-abuse/config";
import { coarseIp, normalizeEmail, pseudonym, subKey } from "@/lib/trial-abuse/pseudonym";
import { canonicalSignals, parseDeviceSignals, platformFamily } from "@/lib/trial-abuse/signals";

const SECRET_B64 = Buffer.alloc(32, 7).toString("base64");

describe("trial-abuse config", () => {
  it("defaults to OFF with nothing configured (feature inactive in production by default)", () => {
    const c = readTrialAbuseConfig({});
    expect(c.mode).toBe("off");
    expect(c.secret).toBeNull();
    expect(isCollectionEnabled(c)).toBe(false);
  });

  it("recognises shadow and enforce case-insensitively and enables collection", () => {
    expect(readTrialAbuseConfig({ TRIAL_ABUSE_MODE: " Shadow " }).mode).toBe("shadow");
    expect(readTrialAbuseConfig({ TRIAL_ABUSE_MODE: "ENFORCE" }).mode).toBe("enforce");
    expect(isCollectionEnabled(readTrialAbuseConfig({ TRIAL_ABUSE_MODE: "shadow" }))).toBe(true);
  });

  it("an unknown mode is 'invalid' (never silently 'off') and does not enable collection", () => {
    const c = readTrialAbuseConfig({ TRIAL_ABUSE_MODE: "enforced" });
    expect(c.mode).toBe("invalid");
    expect(isCollectionEnabled(c)).toBe(false);
  });

  it("rejects a secret shorter than 32 bytes and accepts a 32-byte one", () => {
    expect(readTrialAbuseConfig({ TRIAL_ABUSE_HMAC_SECRET: Buffer.alloc(16, 1).toString("base64") }).secret).toBeNull();
    expect(readTrialAbuseConfig({ TRIAL_ABUSE_HMAC_SECRET: SECRET_B64 }).secret).not.toBeNull();
  });

  it("key version defaults to 1 and ignores out-of-range values", () => {
    expect(readTrialAbuseConfig({}).keyVersion).toBe(1);
    expect(readTrialAbuseConfig({ TRIAL_ABUSE_KEY_VERSION: "3" }).keyVersion).toBe(3);
    expect(readTrialAbuseConfig({ TRIAL_ABUSE_KEY_VERSION: "0" }).keyVersion).toBe(1);
    expect(readTrialAbuseConfig({ TRIAL_ABUSE_KEY_VERSION: "999" }).keyVersion).toBe(1);
  });
});

describe("pseudonyms", () => {
  const secret = Buffer.alloc(32, 7);

  it("are 64-char lowercase hex, deterministic, and never contain the input", () => {
    const a = pseudonym(secret, "email", "someone@example.com");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(pseudonym(secret, "email", "someone@example.com"));
    expect(a).not.toContain("someone");
  });

  it("separate domains: the same value yields different digests per kind", () => {
    const digests = (["email", "cookie", "device", "ip"] as const).map((k) => pseudonym(secret, k, "same-value"));
    expect(new Set(digests).size).toBe(4);
    expect(subKey(secret, "email").equals(subKey(secret, "ip"))).toBe(false);
  });

  it("a different secret gives a different digest (rotation invalidates old digests)", () => {
    expect(pseudonym(secret, "ip", "10.0.0.0/24")).not.toBe(pseudonym(Buffer.alloc(32, 8), "ip", "10.0.0.0/24"));
  });
});

describe("normalizeEmail", () => {
  it("lowercases, trims, strips +tags", () => {
    expect(normalizeEmail("  Budi+promo@Example.COM ")).toBe("budi@example.com");
  });
  it("collapses Gmail dots and googlemail", () => {
    expect(normalizeEmail("b.u.d.i+x@gmail.com")).toBe("budi@gmail.com");
    expect(normalizeEmail("budi@googlemail.com")).toBe("budi@gmail.com");
  });
  it("keeps dots for other domains (they are significant there)", () => {
    expect(normalizeEmail("b.udi@usaha.co.id")).toBe("b.udi@usaha.co.id");
  });
});

describe("coarseIp", () => {
  it("reduces IPv4 to /24 so the full address is never hashed", () => {
    expect(coarseIp("203.0.113.77")).toBe("203.0.113.0/24");
  });
  it("reduces IPv6 to /48", () => {
    expect(coarseIp("2001:db8:abcd:12:ffff::1")).toBe("2001:0db8:abcd::/48");
  });
  it("maps IPv4-mapped IPv6 to the IPv4 /24", () => {
    expect(coarseIp("::ffff:198.51.100.9")).toBe("198.51.100.0/24");
  });
  it("returns null for 'unknown' and junk instead of hashing it", () => {
    expect(coarseIp("unknown")).toBeNull();
    expect(coarseIp("999.1.1.1")).toBeNull();
    expect(coarseIp("")).toBeNull();
    expect(coarseIp("1.2.3")).toBeNull();
  });
});

describe("device signals", () => {
  const ok = JSON.stringify({ tz: "Asia/Jakarta", lang: "id-ID", sw: 412, sh: 915, dpr: 2.625, hc: 8 });

  it("parses and COARSENS values (screen rounded to 100px, dpr to 0.1)", () => {
    const s = parseDeviceSignals(ok);
    expect(s).toEqual({ tz: "Asia/Jakarta", lang: "id-id", sw: 400, sh: 900, dpr: 2.6, hc: 8 });
  });

  it("rejects malformed, oversized and non-object payloads", () => {
    expect(parseDeviceSignals("not json")).toBeNull();
    expect(parseDeviceSignals("[]")).toBeNull();
    expect(parseDeviceSignals("x".repeat(600))).toBeNull();
    expect(parseDeviceSignals(null)).toBeNull();
    expect(parseDeviceSignals(JSON.stringify({ tz: "Asia/Jakarta" }))).toBeNull();
    expect(parseDeviceSignals(JSON.stringify({ tz: "<script>", lang: "id", sw: 1, sh: 1, dpr: 1, hc: 1 }))).toBeNull();
  });

  it("ignores extra, potentially invasive fields: they cannot reach the canonical string", () => {
    const s = parseDeviceSignals(JSON.stringify({ ...JSON.parse(ok), canvas: "abc123", fonts: ["x"], battery: 0.5 }));
    const canon = canonicalSignals(s!, "android");
    expect(canon).not.toContain("canvas");
    expect(canon).not.toContain("fonts");
    expect(canon).not.toContain("battery");
    expect(canon).toBe("tz=Asia/Jakarta|lang=id-id|sw=400|sh=900|dpr=2.6|hc=8|pf=android");
  });

  it("platformFamily returns only a coarse family, never the UA string", () => {
    expect(platformFamily("Mozilla/5.0 (Linux; Android 14; SM-A546E) Chrome/130")).toBe("android");
    expect(platformFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe("ios");
    expect(platformFamily(null)).toBe("other");
  });
});

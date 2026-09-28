import { describe, expect, it } from "vitest";
import { createDemoSessionToken, verifyDemoSessionToken, DEMO_SESSION_TTL_MS } from "@/lib/demo/session";

const SECRET = "test-demo-secret";

describe("demo session token — LINOE Demo Environment Phase 1", () => {
  it("round-trips a freshly issued token", () => {
    const now = Date.now();
    const token = createDemoSessionToken(SECRET, now);
    const result = verifyDemoSessionToken(token, SECRET, now);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.issuedAt).toBe(now);
      expect(result.session.expiresAt).toBe(now + DEMO_SESSION_TTL_MS);
      expect(result.session.sessionId).toBeTruthy();
    }
  });

  it("two tokens issued at the same instant never share a session id (no cross-session collision)", () => {
    const now = Date.now();
    const a = createDemoSessionToken(SECRET, now);
    const b = createDemoSessionToken(SECRET, now);
    expect(a).not.toBe(b);
  });

  it("rejects a token signed with a different secret", () => {
    const now = Date.now();
    const token = createDemoSessionToken("wrong-secret", now);
    const result = verifyDemoSessionToken(token, SECRET, now);
    expect(result).toEqual({ ok: false, reason: "INVALID_SIGNATURE" });
  });

  it("rejects a tampered session id even though the signature format still parses", () => {
    const now = Date.now();
    const token = createDemoSessionToken(SECRET, now);
    const [sessionId, issuedAt, expiresAt, signature] = token.split(".");
    const tampered = [`${sessionId}-tampered`, issuedAt, expiresAt, signature].join(".");
    const result = verifyDemoSessionToken(tampered, SECRET, now);
    expect(result.ok).toBe(false);
  });

  it("rejects an expired token", () => {
    const now = Date.now();
    const token = createDemoSessionToken(SECRET, now);
    const afterExpiry = now + DEMO_SESSION_TTL_MS + 1;
    const result = verifyDemoSessionToken(token, SECRET, afterExpiry);
    expect(result).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("rejects null, empty, and malformed tokens without throwing", () => {
    expect(verifyDemoSessionToken(null, SECRET)).toEqual({ ok: false, reason: "MALFORMED" });
    expect(verifyDemoSessionToken("", SECRET)).toEqual({ ok: false, reason: "MALFORMED" });
    expect(verifyDemoSessionToken("not-a-valid-token", SECRET)).toEqual({ ok: false, reason: "MALFORMED" });
    expect(() => verifyDemoSessionToken("a.b.c.not-hex!!", SECRET)).not.toThrow();
  });
});

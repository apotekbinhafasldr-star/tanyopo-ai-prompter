import { describe, expect, it } from "vitest";
import { signUmkmproPayload, verifyUmkmproSignature } from "@/lib/umkmpro/signature";

const SECRET = "test-shared-secret";
const NOW = 1_700_000_000; // fixed unix seconds

describe("umkmpro signature", () => {
  it("verifies a correctly signed, fresh request", () => {
    const rawBody = JSON.stringify({ hello: "world" });
    const timestamp = String(NOW);
    const signature = signUmkmproPayload(timestamp, rawBody, SECRET);

    const result = verifyUmkmproSignature({ timestamp, signature, rawBody, secret: SECRET, now: NOW });
    expect(result.ok).toBe(true);
  });

  it("rejects a missing signature header", () => {
    const result = verifyUmkmproSignature({
      timestamp: String(NOW),
      signature: null,
      rawBody: "{}",
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "MISSING_HEADERS" });
  });

  it("rejects a missing timestamp header", () => {
    const result = verifyUmkmproSignature({
      timestamp: null,
      signature: "deadbeef",
      rawBody: "{}",
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "MISSING_HEADERS" });
  });

  it("rejects a timestamp outside the freshness window", () => {
    const rawBody = "{}";
    const staleTimestamp = String(NOW - 10 * 60); // 10 minutes old
    const signature = signUmkmproPayload(staleTimestamp, rawBody, SECRET);

    const result = verifyUmkmproSignature({
      timestamp: staleTimestamp,
      signature,
      rawBody,
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
  });

  it("rejects a non-numeric timestamp", () => {
    const result = verifyUmkmproSignature({
      timestamp: "not-a-number",
      signature: "deadbeef",
      rawBody: "{}",
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
  });

  it("rejects a signature computed with the wrong secret", () => {
    const rawBody = "{}";
    const timestamp = String(NOW);
    const signature = signUmkmproPayload(timestamp, rawBody, "wrong-secret");

    const result = verifyUmkmproSignature({ timestamp, signature, rawBody, secret: SECRET, now: NOW });
    expect(result).toEqual({ ok: false, reason: "INVALID_SIGNATURE" });
  });

  it("rejects a tampered body even with a signature that was valid for the original body", () => {
    const timestamp = String(NOW);
    const signature = signUmkmproPayload(timestamp, JSON.stringify({ amount: 1000 }), SECRET);

    const result = verifyUmkmproSignature({
      timestamp,
      signature,
      rawBody: JSON.stringify({ amount: 9_000_000 }),
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_SIGNATURE" });
  });

  it("rejects a signature of the wrong length without throwing", () => {
    const result = verifyUmkmproSignature({
      timestamp: String(NOW),
      signature: "ab",
      rawBody: "{}",
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "INVALID_SIGNATURE" });
  });
});

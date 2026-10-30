// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readBodyWithLimit } from "@/lib/billing/read-body-limit";

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/webhooks/payment", { method: "POST", body, headers });
}

describe("readBodyWithLimit — Billing B3 request size ceiling", () => {
  it("returns the text of a small body", async () => {
    expect(await readBodyWithLimit(post('{"a":1}'), 1024)).toBe('{"a":1}');
  });
  it("returns an empty string for an empty body", async () => {
    expect(await readBodyWithLimit(post(null), 1024)).toBe("");
  });
  it("accepts a body exactly at the limit and rejects one byte over", async () => {
    expect(await readBodyWithLimit(post("a".repeat(100)), 100)).toBe("a".repeat(100));
    expect(await readBodyWithLimit(post("a".repeat(101)), 100)).toBeNull();
  });
  it("rejects early on a declared Content-Length above the limit, without reading the body", async () => {
    expect(await readBodyWithLimit(post("small", { "content-length": "999999" }), 1024)).toBeNull();
  });
  it("rejects a streamed body that exceeds the limit even with NO Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 50; i++) controller.enqueue(new TextEncoder().encode("x".repeat(100)));
        controller.close();
      },
    });
    const request = new Request("https://example.test/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readBodyWithLimit(request, 1000)).toBeNull();
  });
  it("decodes multi-byte characters across the whole body", async () => {
    expect(await readBodyWithLimit(post("Pembayaran — LINOE ✓"), 1024)).toBe("Pembayaran — LINOE ✓");
  });
});

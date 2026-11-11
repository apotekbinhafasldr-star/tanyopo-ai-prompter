// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyWebhookError, unknownStatusMarker } from "@/lib/billing/webhook-markers";

describe("P0-A webhook markers", () => {
  it("builds UNKNOWN_STATUS:<code> from gateway words only, sanitised and bounded", () => {
    expect(unknownStatusMarker("SOMETHING_NEW/-/-")).toBe("UNKNOWN_STATUS:SOMETHING_NEW/-/-");
    expect(unknownStatusMarker("CHARGE BACK<b>!")).toBe("UNKNOWN_STATUS:CHARGEBACKb");
    expect(unknownStatusMarker("a@b.c; drop table x")).toBe("UNKNOWN_STATUS:ab.cdroptablex");
    expect(unknownStatusMarker("x".repeat(500))).toHaveLength("UNKNOWN_STATUS:".length + 60);
    expect(unknownStatusMarker("")).toBe("UNKNOWN_STATUS:?");
    expect(unknownStatusMarker(undefined)).toBe("UNKNOWN_STATUS:?");
    expect(unknownStatusMarker("!!!")).toBe("UNKNOWN_STATUS:?");
  });
  it("classifies the markers the health card counts", () => {
    expect(classifyWebhookError("UNKNOWN_STATUS:FOO")).toBe("UNKNOWN");
    expect(classifyWebhookError("VERIFIED_STATUS_UNKNOWN")).toBe("UNKNOWN");
    expect(classifyWebhookError("GATEWAY_VERIFICATION_FAILED")).toBe("VERIFICATION_FAILED");
    expect(classifyWebhookError("GATEWAY_VERIFICATION_FAILED:CURRENCY_MISSING")).toBe("VERIFICATION_FAILED");
    expect(classifyWebhookError("VERIFIED_STATUS_NOT_PAID")).toBe("NOT_PAID");
    for (const other of ["NEEDS_REVIEW", "ALARM_REFUND", "GATEWAY_VERIFICATION_FAILEDX", "", null, undefined, 5]) expect(classifyWebhookError(other)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { isAuthorizedProcessorRequest } from "@/lib/jobs/authorize-processor";

describe("isAuthorizedProcessorRequest", () => {
  it("rejects when no secret is configured, regardless of the header", () => {
    expect(isAuthorizedProcessorRequest("Bearer anything", undefined)).toBe(false);
  });

  it("rejects a missing authorization header", () => {
    expect(isAuthorizedProcessorRequest(null, "the-secret")).toBe(false);
  });

  it("rejects a header without the Bearer prefix", () => {
    expect(isAuthorizedProcessorRequest("the-secret", "the-secret")).toBe(false);
  });

  it("rejects a mismatched token", () => {
    expect(isAuthorizedProcessorRequest("Bearer wrong-secret", "the-secret")).toBe(false);
  });

  it("rejects a token of a different length (no length-dependent crash)", () => {
    expect(isAuthorizedProcessorRequest("Bearer short", "a-much-longer-secret-value")).toBe(false);
  });

  it("accepts the correct bearer token", () => {
    expect(isAuthorizedProcessorRequest("Bearer the-secret", "the-secret")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { computeBackoffSeconds } from "@/lib/jobs/backoff";

describe("computeBackoffSeconds", () => {
  it("doubles the delay each attempt", () => {
    expect(computeBackoffSeconds(1, 30)).toBe(30);
    expect(computeBackoffSeconds(2, 30)).toBe(60);
    expect(computeBackoffSeconds(3, 30)).toBe(120);
    expect(computeBackoffSeconds(4, 30)).toBe(240);
  });

  it("caps at maxSeconds rather than growing unbounded", () => {
    expect(computeBackoffSeconds(10, 30, 3600)).toBe(3600);
  });

  it("treats attempt 0 or negative the same as attempt 1", () => {
    expect(computeBackoffSeconds(0, 30)).toBe(30);
    expect(computeBackoffSeconds(-5, 30)).toBe(30);
  });
});

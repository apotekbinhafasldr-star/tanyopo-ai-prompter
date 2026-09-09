import { describe, expect, it } from "vitest";
import { isOwnProductMediaPath } from "@/lib/media/product-media-path";

describe("isOwnProductMediaPath", () => {
  it("accepts a path under the claimed tenant and product", () => {
    expect(isOwnProductMediaPath("tenant-1/product-1/1234-photo.jpg", "tenant-1", "product-1")).toBe(true);
  });

  it("rejects a path belonging to a different tenant", () => {
    expect(isOwnProductMediaPath("tenant-2/product-1/1234-photo.jpg", "tenant-1", "product-1")).toBe(false);
  });

  it("rejects a path belonging to a different product in the same tenant", () => {
    expect(isOwnProductMediaPath("tenant-1/product-2/1234-photo.jpg", "tenant-1", "product-1")).toBe(false);
  });

  it("rejects a path that merely starts with the tenant id as a string prefix, not a real folder segment", () => {
    // "tenant-10" must not pass a check for tenant "tenant-1" just because
    // the raw string happens to start with "tenant-1".
    expect(isOwnProductMediaPath("tenant-10/product-1/1234-photo.jpg", "tenant-1", "product-1")).toBe(false);
  });
});

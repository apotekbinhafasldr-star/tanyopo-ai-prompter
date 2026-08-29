import { describe, expect, it } from "vitest";
import { productSchema } from "@/schemas/products";

describe("productSchema", () => {
  const valid = {
    name: "Kopi Robusta 200gr",
    description: "Kopi lokal single origin",
    productType: "PHYSICAL_PRODUCT",
    category: "Minuman",
    price: "35000",
    stock: "100",
    hpp: "18000",
    websiteUrl: "",
  };

  it("accepts a valid product", () => {
    expect(productSchema.safeParse(valid).success).toBe(true);
  });

  it("coerces numeric strings to numbers", () => {
    const result = productSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price).toBe(35000);
      expect(result.data.stock).toBe(100);
    }
  });

  it("rejects a negative price", () => {
    const result = productSchema.safeParse({ ...valid, price: "-100" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown product type", () => {
    const result = productSchema.safeParse({ ...valid, productType: "NOT_REAL" });
    expect(result.success).toBe(false);
  });

  it("rejects a name that is too short", () => {
    const result = productSchema.safeParse({ ...valid, name: "K" });
    expect(result.success).toBe(false);
  });
});

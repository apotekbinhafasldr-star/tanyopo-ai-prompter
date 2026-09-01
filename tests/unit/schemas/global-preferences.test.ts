import { describe, expect, it } from "vitest";
import { globalPreferencesSchema } from "@/schemas/global-preferences";

describe("globalPreferencesSchema", () => {
  it("accepts a valid Indonesia profile", () => {
    const result = globalPreferencesSchema.safeParse({
      countryCode: "ID",
      language: "id",
      timezone: "Asia/Jakarta",
      currency: "IDR",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid international profile", () => {
    const result = globalPreferencesSchema.safeParse({
      countryCode: "us",
      language: "en",
      timezone: "America/New_York",
      currency: "USD",
      targetMarketCountryCode: "SG",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.countryCode).toBe("US"); // uppercased
    }
  });

  it("rejects a malformed country code", () => {
    const result = globalPreferencesSchema.safeParse({
      countryCode: "USA",
      language: "en",
      timezone: "UTC",
      currency: "USD",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported currency", () => {
    const result = globalPreferencesSchema.safeParse({
      countryCode: "ID",
      language: "id",
      timezone: "Asia/Jakarta",
      currency: "JPY",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported language", () => {
    const result = globalPreferencesSchema.safeParse({
      countryCode: "ID",
      language: "fr",
      timezone: "Asia/Jakarta",
      currency: "IDR",
    });
    expect(result.success).toBe(false);
  });

  it("allows an empty target market country code (means 'same as home market')", () => {
    const result = globalPreferencesSchema.safeParse({
      countryCode: "ID",
      language: "id",
      timezone: "Asia/Jakarta",
      currency: "IDR",
      targetMarketCountryCode: "",
    });
    expect(result.success).toBe(true);
  });
});

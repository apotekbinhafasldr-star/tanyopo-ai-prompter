import { describe, expect, it } from "vitest";
import { EMAIL_FORMAT_MESSAGE, validateEmailFormat } from "@/schemas/auth";

describe("validateEmailFormat (client-side, no network)", () => {
  it.each(["nama@usaha.com", "a.b+tag@sub.domain.co.id", "  budi@example.com  ", "x@y.io"])(
    "accepts %j",
    (value) => {
      expect(validateEmailFormat(value)).toBeNull();
    },
  );

  it.each(["budi", "budi@", "@example.com", "budi@example", "budi example@x.com", "budi@@x.com", "budi@x..com"])(
    "rejects %j with the format message",
    (value) => {
      expect(validateEmailFormat(value)).toBe(EMAIL_FORMAT_MESSAGE);
    },
  );

  it("does not complain about an empty value (required is reported on submit, tabbing past is harmless)", () => {
    expect(validateEmailFormat("")).toBeNull();
    expect(validateEmailFormat("   ")).toBeNull();
  });

  it("states an example the person can copy", () => {
    expect(EMAIL_FORMAT_MESSAGE).toContain("nama@usaha.com");
  });
});

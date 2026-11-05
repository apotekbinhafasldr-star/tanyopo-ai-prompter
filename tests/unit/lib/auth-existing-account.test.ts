import { describe, expect, it } from "vitest";
import { isExistingAccountSignUp } from "@/lib/auth/existing-account";

describe("isExistingAccountSignUp", () => {
  it("is true when Supabase returns an explicit 422 user_already_exists error", () => {
    const result = isExistingAccountSignUp(
      { status: 422, code: "user_already_exists" },
      null,
    );
    expect(result).toBe(true);
  });

  it("is true when Supabase returns 'success' with no error but an empty identities array", () => {
    const result = isExistingAccountSignUp(null, { user: { identities: [] } });
    expect(result).toBe(true);
  });

  it("is false for a genuinely new signup (no error, at least one identity)", () => {
    const result = isExistingAccountSignUp(null, {
      user: { identities: [{ id: "identity-1" } as unknown] },
    });
    expect(result).toBe(false);
  });

  it("is false for an unrelated error (e.g. weak password, rate limit)", () => {
    const result = isExistingAccountSignUp({ status: 400, code: "weak_password" }, null);
    expect(result).toBe(false);
  });

  it("is false when identities is undefined (e.g. project not tracking identities) rather than an empty array", () => {
    const result = isExistingAccountSignUp(null, { user: { identities: undefined } });
    expect(result).toBe(false);
  });

  it("is false when user is null and there is no error", () => {
    const result = isExistingAccountSignUp(null, { user: null });
    expect(result).toBe(false);
  });

  it("is true for the email_exists code as well", () => {
    expect(isExistingAccountSignUp({ status: 422, code: "email_exists" }, null)).toBe(true);
    expect(isExistingAccountSignUp({ code: "email_exists" }, null)).toBe(true);
  });

  it.each([
    ["weak_password", "weak_password"],
    ["signup_disabled", "signup_disabled"],
    ["validation_failed", "validation_failed"],
    ["email_address_invalid", "email_address_invalid"],
    ["an unknown future code", "something_new"],
    ["no code at all", undefined],
  ])("is false for HTTP 422 with %s (a 422 alone never means 'already registered')", (_label, code) => {
    expect(isExistingAccountSignUp({ status: 422, code }, null)).toBe(false);
  });

  it("is false for an error whose code is already_exists-like only by status", () => {
    expect(isExistingAccountSignUp({ status: 422 }, null)).toBe(false);
  });

  it("keeps the identities signal untouched by any error rule (only evaluated when there is no error)", () => {
    expect(isExistingAccountSignUp(null, { user: { identities: [] } })).toBe(true);
    expect(isExistingAccountSignUp({ status: 500 }, { user: { identities: [] } })).toBe(false);
  });
});

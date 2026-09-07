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
});

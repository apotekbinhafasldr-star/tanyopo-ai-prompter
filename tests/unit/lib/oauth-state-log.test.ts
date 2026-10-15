import { afterEach, describe, expect, it, vi } from "vitest";
import { logOauthStateRejection } from "@/lib/connectors/safe-error-log";
import { STATE_REJECTION_REASONS, type StateRejectionReason } from "@/lib/connectors/oauth-state";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logOauthStateRejection", () => {
  it.each(STATE_REJECTION_REASONS)("logs the category and presence booleans only (%s)", (reason) => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    logOauthStateRejection("META", reason, { code: true, state: false, cookie: true });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual([
      "[oauth-callback] state rejected",
      { platform: "META", reason, has_code: true, has_state: false, has_cookie: true },
    ]);
  });

  it("replaces anything outside the allowlisted reasons and ignores non-boolean presence values", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    logOauthStateRejection(
      "META",
      "STATE-VALUE-456" as unknown as StateRejectionReason,
      { code: "AUTH-CODE-123", state: 1, cookie: "COOKIE-VALUE-789" } as never,
    );

    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("unknown");
    expect(logged).toContain('"has_code":false');
    expect(logged).toContain('"has_state":false');
    expect(logged).toContain('"has_cookie":false');
    for (const secret of ["STATE-VALUE-456", "AUTH-CODE-123", "COOKIE-VALUE-789"]) {
      expect(logged).not.toContain(secret);
    }
  });
});

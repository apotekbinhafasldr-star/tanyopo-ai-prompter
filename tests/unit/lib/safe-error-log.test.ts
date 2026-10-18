import { afterEach, describe, expect, it, vi } from "vitest";
import { describeSafeError, logOauthFailure } from "@/lib/connectors/safe-error-log";
import { ConnectorApiError, ConnectorConfigError } from "@/lib/connectors/types";

const SECRETS = ["SECRET-ACCESS-TOKEN", "AUTH-CODE-123", "STATE-VALUE-456", "COOKIE-VALUE-789", "APP-SECRET-000"];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("describeSafeError", () => {
  it("keeps only structured provider fields and never the provider message", () => {
    const err = new ConnectorApiError("META", `Invalid code ${SECRETS.join(" ")}`, {
      status: 400,
      code: 190,
      subcode: 463,
      type: "OAuthException",
    });

    const summary = describeSafeError(err);

    expect(summary).toEqual({
      errorName: "ConnectorApiError",
      httpStatus: 400,
      code: 190,
      subcode: 463,
      type: "OAuthException",
    });
    for (const secret of SECRETS) expect(JSON.stringify(summary)).not.toContain(secret);
  });

  it("keeps only the Postgres error code from a database error", () => {
    const dbError = {
      code: "23505",
      message: "duplicate key value violates unique constraint (tenant_id, platform)=(t1, META)",
      details: `Key (connected_account_id)=(acct) already exists ${SECRETS[0]}`,
      hint: SECRETS[1],
    };

    expect(describeSafeError(dbError)).toEqual({ errorName: "Error", code: "23505" });
  });

  it("describes a ConnectorConfigError by name only", () => {
    expect(describeSafeError(new ConnectorConfigError("META", `missing ${SECRETS[4]}`))).toEqual({
      errorName: "ConnectorConfigError",
    });
  });

  it("drops fields that do not match the strict patterns", () => {
    const hostile = {
      name: `Evil Name ${SECRETS[0]}`,
      status: 99999,
      code: `bad code with spaces & token=${SECRETS[0]}`,
      subcode: { nested: SECRETS[1] },
      type: `OAuth Exception; ${SECRETS[2]}`,
    };

    expect(describeSafeError(hostile)).toEqual({ errorName: "Error" });
  });

  it.each([[null], [undefined], ["a string containing SECRET-ACCESS-TOKEN"], [42]])(
    "returns a generic summary for a non-object (%s)",
    (value) => {
      expect(describeSafeError(value)).toEqual({ errorName: "UnknownError" });
    },
  );

  it("never reads message, stack, cause, details or hint", () => {
    const trap = (field: string) => () => {
      throw new Error(`read forbidden field: ${field}`);
    };
    const err = { name: "Error", code: "XX000" };
    for (const field of ["message", "stack", "cause", "details", "hint", "response", "config"]) {
      Object.defineProperty(err, field, { get: trap(field), enumerable: true });
    }

    expect(() => describeSafeError(err)).not.toThrow();
    expect(describeSafeError(err)).toEqual({ errorName: "Error", code: "XX000" });
  });
});

describe("logOauthFailure", () => {
  it("writes one structured line with stage, platform and the safe summary only", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error(`boom ${SECRETS.join(" ")}`), {
      status: 400,
      code: 190,
      type: "OAuthException",
      authorizationCode: SECRETS[1],
      cookie: SECRETS[3],
    });

    logOauthFailure("callback_exception", "META", err);

    expect(spy).toHaveBeenCalledTimes(1);
    const [label, payload] = spy.mock.calls[0];
    expect(label).toBe("[oauth-callback] failure");
    expect(payload).toEqual({
      stage: "callback_exception",
      platform: "META",
      errorName: "Error",
      httpStatus: 400,
      code: 190,
      type: "OAuthException",
    });
    for (const secret of SECRETS) expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
  });

  it("logs only stage and platform when there is no error object", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logOauthFailure("account_insert", "X");
    expect(spy.mock.calls[0][1]).toEqual({ stage: "account_insert", platform: "X" });
  });
});

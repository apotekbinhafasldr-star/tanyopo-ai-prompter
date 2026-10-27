import { describe, expect, it } from "vitest";
import {
  classifyGraphFailure,
  combineChecks,
  evaluateMetaReadiness,
  unavailableMetaReadiness,
  unavailableReasonMessage,
  type MetaAdAccountSnapshot,
  type ReadinessUnavailableReason,
} from "@/lib/connectors/meta-readiness";

const NOW = new Date("2026-10-27T10:00:00.000Z");

const READY_SNAPSHOT: MetaAdAccountSnapshot = {
  accountStatus: 1,
  currency: "IDR",
  isPrepayAccount: false,
  hasFundingSource: true,
  minDailyBudgetRaw: 25000,
};

function evaluate(overrides: Partial<MetaAdAccountSnapshot>) {
  return evaluateMetaReadiness({ ...READY_SNAPSHOT, ...overrides }, NOW);
}

describe("evaluateMetaReadiness — READY needs positive evidence for every check", () => {
  it("is READY only when status, currency, payment method and account type all check out", () => {
    const result = evaluate({});
    expect(result.state).toBe("READY");
    expect(result.checks.map((c) => c.status)).toEqual(["PASS", "PASS", "PASS", "PASS"]);
    expect(result.unavailableReason).toBeNull();
    expect(result.checkedAt).toBe(NOW.toISOString());
  });

  it.each([
    ["accountStatus", { accountStatus: null }],
    ["currency", { currency: null }],
    ["hasFundingSource", { hasFundingSource: null }],
    ["isPrepayAccount", { isPrepayAccount: null }],
  ] as const)("is UNKNOWN, never READY, when %s is missing", (_field, override) => {
    const result = evaluate(override);
    expect(result.state).toBe("UNKNOWN");
    expect(result.state).not.toBe("READY");
  });

  it("treats an account with no readable payment method as UNKNOWN (absence proves nothing)", () => {
    const result = evaluate({ hasFundingSource: null });
    expect(result.state).toBe("UNKNOWN");
    const payment = result.checks.find((c) => c.id === "PAYMENT_METHOD");
    expect(payment?.status).toBe("UNKNOWN");
  });

  it("is UNKNOWN for a prepaid account because LINOE does not read the balance", () => {
    const result = evaluate({ isPrepayAccount: true });
    expect(result.state).toBe("UNKNOWN");
    const prepaid = result.checks.find((c) => c.id === "PREPAID");
    expect(prepaid?.status).toBe("UNKNOWN");
    expect(prepaid?.detail).toContain("tidak membaca saldo");
  });

  it("is UNKNOWN for an account status code LINOE has not verified", () => {
    expect(evaluate({ accountStatus: 999 }).state).toBe("UNKNOWN");
    expect(evaluate({ accountStatus: 1.5 }).state).toBe("UNKNOWN");
  });

  it("is UNKNOWN for a currency that is not a plain ISO code", () => {
    expect(evaluate({ currency: "idr" }).state).toBe("UNKNOWN");
    expect(evaluate({ currency: "IDRX" }).state).toBe("UNKNOWN");
    expect(evaluate({ currency: "" }).state).toBe("UNKNOWN");
  });
});

describe("evaluateMetaReadiness — definite problems are NOT_READY", () => {
  it.each([2, 3, 7, 8, 9])("account_status %i is NOT_READY", (code) => {
    const result = evaluate({ accountStatus: code });
    expect(result.state).toBe("NOT_READY");
    expect(result.checks.find((c) => c.id === "ACCOUNT_STATUS")?.status).toBe("FAIL");
  });

  it("a non-IDR account is NOT_READY and names the currency", () => {
    const result = evaluate({ currency: "USD" });
    expect(result.state).toBe("NOT_READY");
    const currency = result.checks.find((c) => c.id === "CURRENCY");
    expect(currency?.status).toBe("FAIL");
    expect(currency?.detail).toContain("USD");
  });

  it("a definite FAIL outweighs an UNKNOWN elsewhere", () => {
    const result = evaluate({ accountStatus: 2, hasFundingSource: null });
    expect(result.state).toBe("NOT_READY");
  });
});

describe("evaluateMetaReadiness — min_daily_budget is informational only", () => {
  it("never changes the state", () => {
    expect(evaluate({ minDailyBudgetRaw: null }).state).toBe("READY");
    expect(evaluate({ minDailyBudgetRaw: 1 }).state).toBe("READY");
  });

  it("passes a sane value through and drops an invalid one", () => {
    expect(evaluate({ minDailyBudgetRaw: 25000 }).minDailyBudgetRaw).toBe(25000);
    expect(evaluate({ minDailyBudgetRaw: -5 }).minDailyBudgetRaw).toBeNull();
    expect(evaluate({ minDailyBudgetRaw: Number.NaN }).minDailyBudgetRaw).toBeNull();
    expect(evaluate({ minDailyBudgetRaw: 1.5 }).minDailyBudgetRaw).toBeNull();
  });
});

describe("combineChecks", () => {
  it("never reports READY for an empty list", () => {
    expect(combineChecks([])).toBe("UNKNOWN");
  });
});

const ALL_REASONS: ReadinessUnavailableReason[] = [
  "NOT_CONFIGURED",
  "NOT_CONNECTED",
  "TOKEN_EXPIRED",
  "PERMISSION_MISSING",
  "FIELD_UNAVAILABLE",
  "RATE_LIMITED",
  "PROVIDER_ERROR",
  "CREDENTIALS_UNAVAILABLE",
  "NO_AD_ACCOUNT",
  "MULTIPLE_AD_ACCOUNTS",
  "AD_ACCOUNT_MISMATCH",
];

describe("unavailableMetaReadiness", () => {
  it.each(ALL_REASONS)("%s is UNKNOWN with no checks and an Indonesian explanation", (reason) => {
    const result = unavailableMetaReadiness(reason, NOW);
    expect(result.state).toBe("UNKNOWN");
    expect(result.checks).toEqual([]);
    expect(result.unavailableReason).toBe(reason);
    expect(result.minDailyBudgetRaw).toBeNull();
    expect(unavailableReasonMessage(reason).length).toBeGreaterThan(20);
  });

  it("explains that multiple ad accounts are not auto-selected", () => {
    expect(unavailableReasonMessage("MULTIPLE_AD_ACCOUNTS")).toContain("tidak memilih salah satunya");
  });
});

describe("classifyGraphFailure — uses structured fields only", () => {
  it.each([
    [{ code: 190 }, "TOKEN_EXPIRED"],
    [{ code: 102 }, "TOKEN_EXPIRED"],
    [{ status: 401 }, "TOKEN_EXPIRED"],
    [{ code: 10 }, "PERMISSION_MISSING"],
    [{ code: 200 }, "PERMISSION_MISSING"],
    [{ code: 294 }, "PERMISSION_MISSING"],
    [{ status: 403 }, "PERMISSION_MISSING"],
    [{ code: 4 }, "RATE_LIMITED"],
    [{ code: 17 }, "RATE_LIMITED"],
    [{ status: 429 }, "RATE_LIMITED"],
    [{ code: 100 }, "FIELD_UNAVAILABLE"],
    [{ status: 500 }, "PROVIDER_ERROR"],
    [{}, "PROVIDER_ERROR"],
  ] as const)("%j -> %s", (error, expected) => {
    expect(classifyGraphFailure(error)).toBe(expected);
  });

  it("never reads the provider message text", () => {
    expect(classifyGraphFailure({ message: "Error validating access token (190)" })).toBe("PROVIDER_ERROR");
  });

  it("handles non-objects", () => {
    expect(classifyGraphFailure(null)).toBe("PROVIDER_ERROR");
    expect(classifyGraphFailure("boom")).toBe("PROVIDER_ERROR");
    expect(classifyGraphFailure(undefined)).toBe("PROVIDER_ERROR");
  });
});

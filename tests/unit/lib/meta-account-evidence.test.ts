import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  META_ACCOUNT_STATUS_ACTIVE,
  evaluateMetaAccountCurrencyEvidence,
  isWellFormedMetaAdAccountId,
} from "@/lib/connectors/meta-account-evidence";

const ID = "act_1234567890";
const good = { id: ID, currency: "IDR", account_status: 1 };

describe("Meta ad-account currency evidence — only a fully matching response is VERIFIED", () => {
  it("accepts the exact account, a 3-letter currency and ACTIVE status", () => {
    expect(evaluateMetaAccountCurrencyEvidence(good, ID)).toEqual({ kind: "VERIFIED", accountId: ID, currency: "IDR" });
    expect(evaluateMetaAccountCurrencyEvidence({ ...good, currency: "USD", extra: "ignored" }, ID)).toMatchObject({ kind: "VERIFIED", currency: "USD" });
    expect(META_ACCOUNT_STATUS_ACTIVE).toBe(1);
  });

  it.each([null, undefined, "x", 5, true, [], [good]])("a non-object response (%j) is RESPONSE_INVALID", (raw) => {
    expect(evaluateMetaAccountCurrencyEvidence(raw, ID)).toEqual({ kind: "UNVERIFIED", reason: "RESPONSE_INVALID" });
  });

  it.each([null, undefined, "", "1234567890", "act_", "act_12ab", "ACT_1", "act_1 ", "act_1/../x", 5, {}])(
    "a malformed expected id (%j) is ACCOUNT_ID_INVALID",
    (expected) => {
      expect(evaluateMetaAccountCurrencyEvidence(good, expected)).toEqual({ kind: "UNVERIFIED", reason: "ACCOUNT_ID_INVALID" });
    },
  );

  it.each([undefined, null, 1234567890, "act_999", "1234567890", "ACT_1234567890", " act_1234567890"])(
    "a response id that is not exactly the stored id (%j) is ACCOUNT_ID_MISMATCH",
    (id) => {
      expect(evaluateMetaAccountCurrencyEvidence({ ...good, id }, ID)).toEqual({ kind: "UNVERIFIED", reason: "ACCOUNT_ID_MISMATCH" });
    },
  );

  it.each([undefined, null, "", "idr", "IDRX", "ID", "I1R", 360, {}, " IDR"])("an invalid currency (%j) is CURRENCY_INVALID — never defaulted", (currency) => {
    expect(evaluateMetaAccountCurrencyEvidence({ ...good, currency }, ID)).toEqual({ kind: "UNVERIFIED", reason: "CURRENCY_INVALID" });
  });

  it.each([undefined, null, "1", 1.5, Number.NaN, {}])("an unreadable status (%j) is STATUS_UNKNOWN", (account_status) => {
    expect(evaluateMetaAccountCurrencyEvidence({ ...good, account_status }, ID)).toEqual({ kind: "UNVERIFIED", reason: "STATUS_UNKNOWN" });
  });

  it.each([2, 3, 7, 8, 9, 100, 101, 0, -1])("a status other than ACTIVE (%j) is STATUS_NOT_ACTIVE", (account_status) => {
    expect(evaluateMetaAccountCurrencyEvidence({ ...good, account_status }, ID)).toEqual({ kind: "UNVERIFIED", reason: "STATUS_NOT_ACTIVE" });
  });

  it("checks in a fixed order: id, then currency, then status", () => {
    expect(evaluateMetaAccountCurrencyEvidence({ id: "act_9", currency: "x", account_status: 2 }, ID)).toMatchObject({ reason: "ACCOUNT_ID_MISMATCH" });
    expect(evaluateMetaAccountCurrencyEvidence({ id: ID, currency: "x", account_status: 2 }, ID)).toMatchObject({ reason: "CURRENCY_INVALID" });
  });

  it("never carries a token, an id or provider text in its output beyond the verified ids", () => {
    const result = evaluateMetaAccountCurrencyEvidence({ ...good, id: "act_999", message: "token=SECRET" }, ID);
    expect(JSON.stringify(result)).not.toMatch(/SECRET|act_999|act_1234567890/);
  });

  it("isWellFormedMetaAdAccountId accepts only act_<digits>", () => {
    expect(isWellFormedMetaAdAccountId("act_1")).toBe(true);
    expect(isWellFormedMetaAdAccountId("act_" + "9".repeat(32))).toBe(true);
    expect(isWellFormedMetaAdAccountId("act_" + "9".repeat(33))).toBe(false);
    expect(isWellFormedMetaAdAccountId("1")).toBe(false);
  });

  it("the module is pure (no import, network, database or environment)", () => {
    const src = readFileSync("lib/connectors/meta-account-evidence.ts", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/^import /m);
    expect(code).not.toMatch(/fetch\(|process\.env|supabase|server-only|graph\.facebook/i);
  });
});

/**
 * Meta ad-account currency evidence (Phase 1C-B). PURE: no network, database or
 * environment access. It turns ONE raw Graph response (`GET /act_<id>?fields=
 * id,currency,account_status`) into either VERIFIED evidence or UNVERIFIED with
 * a reason. Anything unexpected is UNVERIFIED: there is no default currency,
 * no guess and no fallback.
 *
 * VERIFIED requires ALL of:
 *  - the account id we asked about is a well-formed `act_<digits>`,
 *  - the response is an object whose `id` is exactly that id,
 *  - `currency` is a three-capital-letter code,
 *  - `account_status` is the integer 1 (ACTIVE).
 */

export const META_ACCOUNT_STATUS_ACTIVE = 1;

const AD_ACCOUNT_ID_PATTERN = /^act_\d{1,32}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export type MetaCurrencyEvidenceReason =
  | "ACCOUNT_ID_INVALID"
  | "RESPONSE_INVALID"
  | "ACCOUNT_ID_MISMATCH"
  | "CURRENCY_INVALID"
  | "STATUS_UNKNOWN"
  | "STATUS_NOT_ACTIVE";

export type MetaCurrencyEvidence =
  | { kind: "VERIFIED"; accountId: string; currency: string }
  | { kind: "UNVERIFIED"; reason: MetaCurrencyEvidenceReason };

const unverified = (reason: MetaCurrencyEvidenceReason): MetaCurrencyEvidence => ({ kind: "UNVERIFIED", reason });

export function isWellFormedMetaAdAccountId(value: unknown): value is string {
  return typeof value === "string" && AD_ACCOUNT_ID_PATTERN.test(value);
}

export function evaluateMetaAccountCurrencyEvidence(raw: unknown, expectedAdAccountId: unknown): MetaCurrencyEvidence {
  if (!isWellFormedMetaAdAccountId(expectedAdAccountId)) return unverified("ACCOUNT_ID_INVALID");
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return unverified("RESPONSE_INVALID");

  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id !== expectedAdAccountId) return unverified("ACCOUNT_ID_MISMATCH");
  if (typeof row.currency !== "string" || !CURRENCY_PATTERN.test(row.currency)) return unverified("CURRENCY_INVALID");

  const status = row.account_status;
  if (typeof status !== "number" || !Number.isInteger(status)) return unverified("STATUS_UNKNOWN");
  if (status !== META_ACCOUNT_STATUS_ACTIVE) return unverified("STATUS_NOT_ACTIVE");

  return { kind: "VERIFIED", accountId: row.id, currency: row.currency };
}

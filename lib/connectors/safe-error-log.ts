/**
 * Safe failure logging for OAuth callbacks.
 *
 * Never log: access/refresh tokens, authorization codes, `state`, cookies,
 * app secrets, or any provider/database error MESSAGE (those can echo
 * request parameters, row values or key material). This module therefore
 * works from an allowlist: it reads a handful of structured fields off the
 * thrown value, validates each against a strict pattern, and drops anything
 * else. It never reads `message`, `stack`, `cause`, `details`, `hint` or
 * `response`.
 */

const NAME_PATTERN = /^[A-Za-z]{1,40}$/;
const TYPE_PATTERN = /^[A-Za-z_]{1,40}$/;
const CODE_PATTERN = /^[A-Za-z0-9_]{1,16}$/;

export interface SafeErrorSummary {
  errorName: string;
  httpStatus?: number;
  code?: number | string;
  subcode?: number | string;
  type?: string;
}

function safeCode(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && CODE_PATTERN.test(value)) return value;
  return undefined;
}

export function describeSafeError(err: unknown): SafeErrorSummary {
  if (typeof err !== "object" || err === null) {
    return { errorName: "UnknownError" };
  }

  const record = err as Record<string, unknown>;
  const summary: SafeErrorSummary = {
    errorName: typeof record.name === "string" && NAME_PATTERN.test(record.name) ? record.name : "Error",
  };

  if (typeof record.status === "number" && Number.isInteger(record.status) && record.status >= 100 && record.status <= 599) {
    summary.httpStatus = record.status;
  }
  const code = safeCode(record.code);
  if (code !== undefined) summary.code = code;
  const subcode = safeCode(record.subcode);
  if (subcode !== undefined) summary.subcode = subcode;
  if (typeof record.type === "string" && TYPE_PATTERN.test(record.type)) summary.type = record.type;

  return summary;
}

/** One structured line per failure: where it happened, which platform, and the safe summary. */
export function logOauthFailure(stage: string, platform: string, err?: unknown): void {
  console.error("[oauth-callback] failure", {
    stage,
    platform,
    ...(err === undefined ? {} : describeSafeError(err)),
  });
}

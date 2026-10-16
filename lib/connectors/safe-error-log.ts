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

import { STATE_REJECTION_REASONS, type StatePresence, type StateRejectionReason } from "@/lib/connectors/oauth-state";

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

/**
 * One short, allowlisted line for a user-visible note or an audit row:
 * error name, HTTP status and numeric code/subcode only. Never the error
 * MESSAGE (a provider message can echo request parameters or tokens).
 */
export function formatSafeErrorSummary(err: unknown): string {
  const summary = describeSafeError(err);
  const pieces = [summary.errorName];
  if (summary.httpStatus !== undefined) pieces.push(`HTTP ${summary.httpStatus}`);
  if (summary.code !== undefined) pieces.push(`kode ${summary.code}`);
  if (summary.subcode !== undefined) pieces.push(`subkode ${summary.subcode}`);
  return pieces.join(", ");
}

/**
 * One line per rejected callback state check: the platform, an allowlisted
 * reason, and which inputs were present (booleans). Never the values — a
 * `state`, cookie or code must not reach the logs, and neither does the query
 * string. This is what tells "cookie expired/missing" apart from "Meta sent
 * no code" without exposing anything sensitive.
 */
export function logOauthStateRejection(platform: string, reason: StateRejectionReason, present: StatePresence): void {
  console.warn("[oauth-callback] state rejected", {
    platform,
    reason: STATE_REJECTION_REASONS.includes(reason) ? reason : "unknown",
    has_code: present.code === true,
    has_state: present.state === true,
    has_cookie: present.cookie === true,
  });
}

/** One structured line per failure: where it happened, which platform, and the safe summary. */
export function logOauthFailure(stage: string, platform: string, err?: unknown): void {
  console.error("[oauth-callback] failure", {
    stage,
    platform,
    ...(err === undefined ? {} : describeSafeError(err)),
  });
}

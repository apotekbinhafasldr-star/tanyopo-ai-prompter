/**
 * D3 — payment environment stamp (pure, no I/O, no secrets, no logging).
 *
 * A checkout transaction is stamped with the environment it was created in (`pg_env`) and the database project it was
 * created against (`pg_db_ref`) BEFORE any gateway session exists. When the transaction is settled later, the stamp is
 * compared with the environment the server runs in NOW. A mismatch (sandbox money meeting a live runtime, live money
 * meeting a sandbox runtime, a different database project, or no stamp at all) means the transaction must not be
 * activated: nothing is asked of the gateway and nothing is written.
 *
 * Stored inside the existing `metadata` jsonb column: no migration. The project ref is not a secret (it is the first
 * label of the public Supabase URL).
 */

import type { Json } from "@/types/database";

export type PaymentEnv = "sandbox" | "live";

export interface PaymentEnvStamp {
  env: PaymentEnv;
  dbRef: string;
}

export const STAMP_ENV_KEY = "pg_env";
export const STAMP_DB_REF_KEY = "pg_db_ref";

/** Closed set of reasons; safe to persist and to print (no URL, no key, no gateway text). */
export const ENV_MISMATCH_REASONS = [
  "STAMP_MISSING",
  "SANDBOX_TXN_IN_LIVE",
  "LIVE_TXN_IN_SANDBOX",
  "DB_REF_CHANGED",
  "RUNTIME_UNPROVABLE",
] as const;
export type EnvMismatchReason = (typeof ENV_MISMATCH_REASONS)[number];

export type StampCheck = { ok: true } | { ok: false; reason: EnvMismatchReason };

const REF_PATTERN = /^[a-z0-9]{20}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns a copy of `metadata` (kept as-is when it is an object, otherwise discarded) with the stamp merged in. */
export function withEnvStamp(metadata: unknown, stamp: PaymentEnvStamp): Record<string, Json> {
  const base = isRecord(metadata) ? (metadata as Record<string, Json>) : {};
  return { ...base, [STAMP_ENV_KEY]: stamp.env, [STAMP_DB_REF_KEY]: stamp.dbRef };
}

/** The stamp stored in `metadata`, or null when it is absent or malformed (never guesses). */
export function readEnvStamp(metadata: unknown): PaymentEnvStamp | null {
  if (!isRecord(metadata)) return null;
  const env = metadata[STAMP_ENV_KEY];
  const dbRef = metadata[STAMP_DB_REF_KEY];
  if (env !== "sandbox" && env !== "live") return null;
  if (typeof dbRef !== "string" || !REF_PATTERN.test(dbRef)) return null;
  return { env, dbRef };
}

/** Compares a stored stamp with the runtime the server is in now. Fail-closed: anything unprovable is a mismatch. */
export function checkStamp(stamp: PaymentEnvStamp | null, runtime: PaymentEnvStamp | null): StampCheck {
  if (!runtime) return { ok: false, reason: "RUNTIME_UNPROVABLE" };
  if (!stamp) return { ok: false, reason: "STAMP_MISSING" };
  if (stamp.env !== runtime.env) {
    return { ok: false, reason: stamp.env === "sandbox" ? "SANDBOX_TXN_IN_LIVE" : "LIVE_TXN_IN_SANDBOX" };
  }
  if (stamp.dbRef !== runtime.dbRef) return { ok: false, reason: "DB_REF_CHANGED" };
  return { ok: true };
}

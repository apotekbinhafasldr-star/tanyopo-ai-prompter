/**
 * Idempotency primitives for finance ingestion.
 *
 * Every financial fact (a verified payment, a refund, a fee, a settlement, an
 * expense) is identified by a deterministic key. Ingesting the same fact twice
 * (a repeated webhook, a retried job, a re-imported CSV) must be a no-op;
 * ingesting a DIFFERENT fact under an already-used key is a conflict that must
 * stop and be investigated, never be summed.
 *
 * The same key strings are stored in `finance_ledger_entries.idempotency_key`
 * (UNIQUE) so the database enforces what this module enforces in memory.
 */

export class IdempotencyConflictError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`Idempotency conflict: key ${key} was already recorded with different content`);
    this.name = "IdempotencyConflictError";
    this.key = key;
  }
}

export type IdempotencyKind = "payment" | "refund" | "fee" | "settlement" | "expense";

function assertPart(part: string): string {
  if (typeof part !== "string" || part.length === 0) {
    throw new Error("Idempotency key parts must be non-empty strings");
  }
  if (part.includes("|")) {
    throw new Error("Idempotency key parts must not contain '|'");
  }
  return part;
}

export function idempotencyKey(kind: IdempotencyKind, ...parts: string[]): string {
  if (parts.length === 0) {
    throw new Error("An idempotency key needs at least one identifying part");
  }
  return [kind, ...parts.map(assertPart)].join("|");
}

/** Deterministic JSON with sorted keys; bigint values are rendered as strings. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner === "bigint") {
      return `${inner.toString()}n`;
    }
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const record = inner as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(record).sort()) {
        sorted[k] = record[k];
      }
      return sorted;
    }
    return inner;
  });
}

export type RegisterResult = "APPLIED" | "DUPLICATE";

/**
 * Records `value` under `key`. Returns "DUPLICATE" if an equivalent value is
 * already present (the FIRST one is kept), throws `IdempotencyConflictError` if
 * a different one is. "Equivalent" is decided by `fingerprint`, which defaults
 * to the whole canonical JSON; callers pass a narrower fingerprint when some
 * fields (for example the id of a re-delivered webhook) legitimately differ
 * between deliveries of the same fact.
 */
export function registerOnce<T>(
  store: Map<string, T>,
  key: string,
  value: T,
  fingerprint: (item: T) => string = canonicalJson,
): RegisterResult {
  const existing = store.get(key);
  if (existing === undefined) {
    store.set(key, value);
    return "APPLIED";
  }
  if (fingerprint(existing) === fingerprint(value)) {
    return "DUPLICATE";
  }
  throw new IdempotencyConflictError(key);
}

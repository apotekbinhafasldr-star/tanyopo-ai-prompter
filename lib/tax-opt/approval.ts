import { createHash } from "node:crypto";
import { LAW_VERIFIED_ON, LEGAL_SOURCES } from "./law";
import { PROVISION_CHECKS } from "./verification";

/**
 * Hashes that bind a Founder decision to exactly what was reviewed.
 * Server-only (node:crypto). Not re-exported from the package index on purpose.
 */
export const ENGINE_VERSION = "taxopt-e1";

/** Deterministic JSON: sorted keys, bigint as string, no undefined. Same value, same bytes. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (typeof v === "bigint") return `${v.toString()}n`;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = walk(o[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** Version of the engine AND of the legal registry it relies on. Any change to either changes this string. */
export function rulesVersion(): string {
  const digest = sha256Hex(canonicalJson({ sources: LEGAL_SOURCES, provisions: PROVISION_CHECKS, engine: ENGINE_VERSION })).slice(0, 16);
  return `${ENGINE_VERSION};law=${LAW_VERIFIED_ON};reg=${digest}`;
}

/** Hash of every input and output of one calculation. Only the hash is stored; the data never leaves. */
export function calculationHash(parts: { input: unknown; result: unknown }): string {
  return sha256Hex(canonicalJson(parts));
}

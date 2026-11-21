/**
 * Trusted "known facts" for the campaign quality gate.
 *
 * Pure. Built ONLY from data the tenant entered about the product (name, price, category, description) and,
 * optionally, other tenant-entered values (`extra`, e.g. an offer the owner typed). NEVER pass AI-generated text
 * (a proposal, a candidate, a rationale) here: the gate treats a term found in the facts as true, so model output
 * in the facts would excuse the model's own inventions.
 */

export interface KnownFactsProduct {
  readonly name?: string | null;
  readonly category?: string | null;
  readonly description?: string | null;
  /** Numeric price in `currency` units; a numeric string (PostgREST numeric) is accepted. */
  readonly price?: number | string | null;
  readonly currency?: string | null;
}

function toNumber(price: number | string | null | undefined): number | null {
  if (price === null || price === undefined || price === "") return null;
  const n = typeof price === "number" ? price : Number(price);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "18000" -> "18.000" (id-ID thousands separator, no Intl dependency). */
function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** The ways a price is written in Indonesian ad copy. Exported for tests. */
export function priceRenderings(price: number | string | null | undefined, currency: string | null | undefined = "IDR"): string[] {
  const n = toNumber(price);
  if (n === null) return [];
  const whole = Math.round(n);
  const out = [String(whole), thousands(whole)];
  if ((currency ?? "IDR").toUpperCase() === "IDR") {
    out.push(`Rp${whole}`, `Rp${thousands(whole)}`, `Rp ${thousands(whole)}`);
    if (whole >= 1000 && whole % 100 === 0) {
      const k = whole / 1000;
      for (const v of new Set([String(k), String(k).replace(".", ",")])) {
        out.push(`Rp${v}rb`, `Rp ${v}rb`, `Rp${v}k`, `Rp ${v}k`, `Rp${v} ribu`, `${v}rb`, `${v}k`);
      }
    }
  } else {
    out.push(`${currency} ${thousands(whole)}`);
  }
  return out;
}

export function buildKnownFacts(product: KnownFactsProduct | null | undefined, extra: readonly string[] = []): string {
  if (!product) return extra.filter(Boolean).join("\n");
  const parts = [
    product.name,
    product.category,
    product.description,
    ...priceRenderings(product.price, product.currency),
    ...extra,
  ];
  return parts
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .join("\n");
}

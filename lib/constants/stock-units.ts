/**
 * Suggested stock units ("Satuan") — a starting point, not a closed list.
 * The unit is stored as free text alongside `stock` (see schemas/products.ts),
 * so a user can always type a custom unit; nothing rejects an unlisted value.
 */
export const STOCK_UNIT_SUGGESTIONS = [
  "pcs",
  "box",
  "karton",
  "pack",
  "botol",
  "tube",
  "sachet",
  "strip",
  "blister",
  "lusin",
  "kg",
  "gram",
  "liter",
  "ml",
  "meter",
  "set",
  "unit",
] as const;

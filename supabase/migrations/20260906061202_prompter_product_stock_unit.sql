-- Additive only: adds an optional unit label ("pcs", "box", "kg", ...) next
-- to prompter_products.stock. Nullable, no default backfill needed — every
-- existing product simply has stock_unit = null, which the app already
-- renders as a bare number (see features/products), so this is a
-- zero-downtime, fully backward-compatible change. Not destructive: no
-- column is dropped, renamed, or narrowed, and no existing row is rewritten.
alter table public.prompter_products
  add column if not exists stock_unit text;

comment on column public.prompter_products.stock_unit is
  'Optional free-text unit label for `stock` (e.g. pcs, box, kg). Null on rows created before this column existed and on products with no stock unit set — the app falls back to showing the bare stock number.';

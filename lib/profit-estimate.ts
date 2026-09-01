/**
 * Profit-aware marketing estimate (product spec §49): revenue minus COGS
 * minus ad spend, for a single product's campaigns. Pure and
 * Supabase-free so it's directly unit tested — the product detail page
 * (services/products.ts-adjacent query logic) is what supplies real
 * numbers.
 *
 * This is an **estimated marketing contribution**, not net profit — it
 * only accounts for COGS and ad spend, never other operating expenses
 * (salaries, rent, platform fees, etc.), which this app has no data
 * source for. Every caller (UI labels, AI prompts feeding this into
 * OptimizationAgent reasoning) must say "kontribusi marketing" or
 * equivalent, never "laba bersih"/"net profit" — the field is still
 * named `netProfit` for historical reasons (renaming would ripple through
 * existing tests/call sites for no functional gain), but its meaning is
 * contribution margin, not a P&L bottom line.
 *
 * COGS can only be estimated when the product has an `hpp` (cost price)
 * set — without it there's no honest per-unit cost to multiply by units
 * sold, so `cogs`/`netProfit` come back `null` rather than silently
 * assuming zero cost (which would overstate the contribution). Callers
 * must render that `null` as "add HPP to estimate," never as `Rp 0`.
 */

export interface ProfitEstimateInput {
  revenue: number;
  adSpend: number;
  hpp: number | null;
  unitsSold: number;
}

export interface ProfitEstimateResult {
  revenue: number;
  adSpend: number;
  cogs: number | null;
  netProfit: number | null;
}

export function computeProfitEstimate(input: ProfitEstimateInput): ProfitEstimateResult {
  const cogs = input.hpp !== null ? input.hpp * input.unitsSold : null;
  const netProfit = cogs !== null ? input.revenue - cogs - input.adSpend : null;

  return { revenue: input.revenue, adSpend: input.adSpend, cogs, netProfit };
}

/**
 * Success-fee calculation (product spec: "success fee must ONLY be
 * calculated from VERIFIED ATTRIBUTED CONVERSIONS. Never charge a success
 * fee against total business revenue.").
 *
 * Pure function, no Supabase/env dependency — kept out of
 * services/billing.ts (which is `server-only`) so it's directly unit
 * testable, same split as lib/budget-guard.ts / services/budget-guard.ts.
 */

export interface SuccessFeeInput {
  /** success_fee_rate_bps from prompter_subscriptions — null means no
   * commercial rate has been configured yet. */
  rateBasisPoints: number | null;
  /** Sum of prompter_attributions.attributed_value where
   * attribution_model = 'UMKMPRO_VERIFIED' for the period — never manual
   * self-reported conversions, and never total business revenue. */
  verifiedAttributedValue: number;
}

export type SuccessFeeResult =
  | { status: "NOT_CONFIGURED"; amount: null }
  | { status: "CALCULATED"; amount: number };

export function calculateSuccessFee(input: SuccessFeeInput): SuccessFeeResult {
  if (input.rateBasisPoints == null) {
    return { status: "NOT_CONFIGURED", amount: null };
  }

  const amount = Math.round(((input.verifiedAttributedValue * input.rateBasisPoints) / 10_000) * 100) / 100;
  return { status: "CALCULATED", amount };
}

/**
 * What the Meta connector can actually do, as PURE data and functions (no
 * network, environment, database or "server-only" import), so a contract test
 * can compare it with the objective contracts and the MetaCampaignSpec.
 * `lib/connectors/meta-connector.ts` imports everything here; nothing is
 * duplicated.
 *
 * Phase 1B: ad-set age targeting and the CTA allowlist were added. Neither
 * changes what is sent unless a caller supplies the new optional input; the
 * existing launch path supplies neither, so existing campaigns are unaffected.
 */

/** optimization_goal -> billing_event pairs verified in Meta's docs. REACH only supports IMPRESSIONS. */
export const META_VERIFIED_BILLING_EVENTS: Readonly<Record<string, string>> = Object.freeze({ REACH: "IMPRESSIONS" });

/** Allowlisted `call_to_action.type` values. Anything else falls back to the pre-1B default. */
export const META_CTA_ALLOWLIST = ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "CONTACT_US", "ORDER_NOW"] as const;
export const META_DEFAULT_CTA = "LEARN_MORE";

const CTA_TYPES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(META_CTA_ALLOWLIST.map((cta) => [cta, cta])),
);

/**
 * Maps a CTA to a Meta `call_to_action.type`. Only an EXACT allowlisted value
 * is passed through; everything else (including the free-text CTA the AI
 * proposal stores today, e.g. "Pelajari") keeps the previous behaviour of
 * LEARN_MORE. The result is never built from input text.
 */
export function resolveMetaCtaType(cta: unknown): string {
  if (typeof cta === "string" && Object.prototype.hasOwnProperty.call(CTA_TYPES, cta)) return CTA_TYPES[cta];
  return META_DEFAULT_CTA;
}

export const META_TARGETING_MIN_AGE = 18;
export const META_TARGETING_MAX_AGE = 65;

export type MetaAgeTargeting = { age_min: number; age_max: number };
export type MetaAgeResolution = { ok: true; value: MetaAgeTargeting | null } | { ok: false };

/**
 * Strict age range for an ad set. Neither given -> `value: null` (nothing is
 * added to the payload, as before 1B). One given without the other, a
 * non-integer (including NaN, Infinity, strings), a value outside 18-65, or
 * min > max -> `ok: false` and the caller must refuse to create the ad set.
 */
export function resolveMetaAgeTargeting(ageMin: unknown, ageMax: unknown): MetaAgeResolution {
  if (ageMin === undefined && ageMax === undefined) return { ok: true, value: null };
  const valid = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= META_TARGETING_MIN_AGE && v <= META_TARGETING_MAX_AGE;
  if (!valid(ageMin) || !valid(ageMax) || ageMin > ageMax) return { ok: false };
  return { ok: true, value: { age_min: ageMin, age_max: ageMax } };
}

/**
 * Names of VERIFIED objective contracts whose optimization goal the connector
 * cannot create an ad set for. Must be empty: otherwise a launch would create
 * the campaign and then fail at the ad set, leaving an orphan object on Meta.
 */
export function findVerifiedContractsWithoutConnectorSupport(
  contracts: Readonly<Record<string, { readonly optimizationGoal: string; readonly verified: boolean }>>,
): string[] {
  return Object.entries(contracts)
    .filter(
      ([, contract]) =>
        contract.verified && !Object.prototype.hasOwnProperty.call(META_VERIFIED_BILLING_EVENTS, contract.optimizationGoal),
    )
    .map(([name]) => name);
}

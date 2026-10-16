/**
 * Meta launch objective contracts (PR #36).
 *
 * A LINOE objective (`PrimaryGoal`) is launchable on Meta ONLY when it has an
 * entry here with `verified: true`: a campaign objective, the ad-set
 * optimization goal that belongs to it, and documentation (or a controlled
 * test on a test ad account) that confirms the combination. Anything else
 * fails closed BEFORE the launch claim and before any Meta call, so no
 * orphan campaign can be created by an objective Meta would reject at the
 * ad-set step.
 *
 * Nothing here is guessed:
 * - `BRAND_AWARENESS` keeps the pair the launch code used before this PR
 *   (OUTCOME_AWARENESS + REACH). What is documented: REACH is an
 *   `optimization_goal` whose only valid `billing_event` is IMPRESSIONS, and
 *   REACH was the documented goal of the (legacy) Brand Awareness objective.
 *   NOT confirmed from current documentation: that OUTCOME_AWARENESS accepts
 *   REACH with the bid strategy the connector sends. So `verified` stays
 *   `false` until a controlled test on a Meta test ad account (separate
 *   Founder approval) confirms it. Flipping it is a one-line change.
 * - Objectives that need conversion tracking (Pixel / promoted object),
 *   a lead form, an app, or an engagement destination have no supported
 *   launch path yet and are listed with a user-facing reason.
 */

export interface MetaObjectiveContract {
  /** Meta campaign `objective`. */
  readonly campaignObjective: string;
  /** Meta ad-set `optimization_goal` that belongs to that objective. */
  readonly optimizationGoal: string;
  /** True only once the combination is confirmed (docs or controlled test). */
  readonly verified: boolean;
}

export const META_OBJECTIVE_CONTRACTS: Readonly<Record<string, MetaObjectiveContract>> = Object.freeze({
  BRAND_AWARENESS: Object.freeze({
    campaignObjective: "OUTCOME_AWARENESS",
    optimizationGoal: "REACH",
    verified: false,
  }),
});

/** Known LINOE objectives that have no Meta launch path yet, with the reason shown to the user. */
export const META_UNSUPPORTED_OBJECTIVES: Readonly<Record<string, string>> = Object.freeze({
  INCREASE_SALES:
    "Objective Penjualan (INCREASE_SALES) belum didukung untuk peluncuran Meta: dibutuhkan Pixel dan pelacakan konversi yang belum tersedia di LINOE. Campaign tidak dikirim ke Meta.",
  GET_LEADS:
    "Objective Leads (GET_LEADS) belum didukung untuk peluncuran Meta: dibutuhkan formulir leads yang belum tersedia di LINOE. Campaign tidak dikirim ke Meta.",
  INCREASE_FOLLOWERS:
    "Objective Pengikut/Engagement (INCREASE_FOLLOWERS) belum memiliki kontrak Meta yang terverifikasi. Campaign tidak dikirim ke Meta.",
  WEBSITE_TRAFFIC:
    "Objective Traffic Website (WEBSITE_TRAFFIC) belum memiliki kontrak Meta yang terverifikasi. Campaign tidak dikirim ke Meta.",
  PROMOTE_APP:
    "Objective Promosi Aplikasi (PROMOTE_APP) belum didukung untuk peluncuran Meta. Campaign tidak dikirim ke Meta.",
});

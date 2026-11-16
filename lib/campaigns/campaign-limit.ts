/**
 * Per-campaign spend cap (`prompter_budget_policies.campaign_limit`) for a
 * campaign that has NO total budget.
 *
 * Why this exists: `checkBudgetGuard` (lib/budget-guard.ts) compares the
 * campaign's `total_budget` with `campaign_limit`, but only when
 * `total_budget` is set. Quick Promote and the wizard both allow
 * `total_budget` to be empty, so a campaign with only a daily budget (and no
 * duration) was never compared with the cap at all: it would launch as an
 * open-ended daily spend. This module closes that gap, refusal-only:
 *
 *  - `campaign_limit` not set (null/undefined)  -> nothing to enforce (as before);
 *  - `campaign_limit` set but unreadable        -> refuse (fail closed);
 *  - `total_budget` set                         -> Budget Guard already compares it, nothing to add;
 *  - no `total_budget`, daily budget AND duration set
 *        -> projected spend = daily x duration must not exceed the cap;
 *  - no `total_budget` and no (usable) duration -> spend cannot be bounded, refuse.
 *
 * It NEVER lowers an existing check and never opens a gate: Budget Guard, the
 * approval, the External Budget Safety Gate (S1) and the budget validator all
 * still run. Pure: no network, database, environment or connector access.
 */

export type CampaignLimitResult = { ok: true } | { ok: false; code: CampaignLimitFailureCode; message: string };

export type CampaignLimitFailureCode = "LIMIT_UNREADABLE" | "SPEND_UNBOUNDED" | "PROJECTED_EXCEEDS_LIMIT";

const MESSAGES: Record<CampaignLimitFailureCode, string> = {
  LIMIT_UNREADABLE:
    "Batas budget per campaign pada kebijakan Budget Guard tidak terbaca. Campaign dibatalkan; periksa batas di Settings lalu coba lagi.",
  SPEND_UNBOUNDED:
    "Anda menetapkan batas budget per campaign, tetapi campaign ini tidak punya budget total maupun durasi sehingga pengeluarannya tidak terbatas. Isi budget total, atau budget harian dan durasi, lalu coba lagi.",
  PROJECTED_EXCEEDS_LIMIT:
    "Budget harian x durasi campaign melebihi batas budget per campaign pada kebijakan Budget Guard. Turunkan budget harian atau durasi, atau naikkan batas di Settings, lalu coba lagi.",
};

const isUnset = (value: unknown): boolean => value === null || value === undefined;
const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

function fail(code: CampaignLimitFailureCode): CampaignLimitResult {
  return { ok: false, code, message: MESSAGES[code] };
}

/** Never echoes an input value. First failing check wins. */
export function checkCampaignLimitCoverage(input: {
  campaignLimit: unknown;
  dailyBudget: unknown;
  totalBudget: unknown;
  durationDays: unknown;
}): CampaignLimitResult {
  const { campaignLimit, dailyBudget, totalBudget, durationDays } = input;
  if (isUnset(campaignLimit)) return { ok: true };
  if (typeof campaignLimit !== "number" || !Number.isFinite(campaignLimit) || campaignLimit < 0) {
    return fail("LIMIT_UNREADABLE");
  }

  // A total budget is compared with the limit by Budget Guard itself.
  if (!isUnset(totalBudget)) return { ok: true };

  if (!isPositiveSafeInteger(dailyBudget) || !isPositiveSafeInteger(durationDays)) return fail("SPEND_UNBOUNDED");
  const projected = dailyBudget * durationDays;
  if (!Number.isSafeInteger(projected)) return fail("SPEND_UNBOUNDED");
  return projected > campaignLimit ? fail("PROJECTED_EXCEEDS_LIMIT") : { ok: true };
}

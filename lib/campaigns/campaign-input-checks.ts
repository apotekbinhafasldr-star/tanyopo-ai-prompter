import { resolveMetaFlightEndTime } from "@/lib/campaigns/meta-flight";
import { resolveTargetCountry } from "@/lib/campaigns/meta-launch-preflight";

/**
 * Early (creation-time) checks of the country and the run length of a campaign (F-03), so a launch that Meta
 * would refuse is visible BEFORE the Owner's approval instead of after it. Pure: no network, database or env.
 *
 * Only rules that are VERIFIED in Meta's official documentation are enforced here:
 *  - `daily_budget` is "allowed only for ad sets with a duration (difference between end_time and start_time)
 *    longer than 24 hours" and `lifetime_budget` needs an `end_time`
 *    (developers.facebook.com, Marketing API reference "Ad Campaign" / ad set, read 2026-11-28). The code reuses
 *    `resolveMetaFlightEndTime`, the very function the launch uses, so creation and launch cannot disagree.
 *  - an ad set needs a target location; LINOE sends the country as an ISO 3166-1 alpha-2 code, resolved by
 *    `resolveTargetCountry` (the launch's own resolver).
 * NOT enforced because it could not be verified in the official docs: the 365-day upper bound (it is LINOE's own
 * existing limit; the Meta pages read on 2026-11-28 do not state a maximum, so it is UNVERIFIED), any minimum budget per currency, and any minimum lifetime-budget
 * duration beyond the "end_time required" rule.
 */

const META_CHANNELS: readonly string[] = ["FACEBOOK", "INSTAGRAM"];

export type CampaignInputCheck = { ok: true } | { ok: false; message: string };

/** True when Meta can be one of the campaign's channels: an explicit Meta channel, or no choice yet (AI picks). */
export function mayLaunchOnMeta(channels: readonly string[] | undefined | null): boolean {
  if (!channels || channels.length === 0) return true;
  return channels.some((c) => META_CHANNELS.includes(c));
}

export function checkCampaignCountry(input: {
  country: string | null | undefined;
  /** A daily or total budget was entered: the user intends a paid launch, so the country is required. */
  paidIntent: boolean;
}): CampaignInputCheck {
  const value = (input.country ?? "").trim();
  if (value.length === 0) {
    return input.paidIntent
      ? {
          ok: false,
          message:
            "Negara target wajib diisi untuk campaign berbayar (budget terisi). Isi Negara (contoh: Indonesia atau ID); di Quick Promote kolomnya ada di bagian Lanjutan. Belum ada yang dibuat.",
        }
      : { ok: true };
  }
  const resolved = resolveTargetCountry(value);
  return resolved.ok ? { ok: true } : { ok: false, message: resolved.message };
}

export function checkCampaignFlight(input: {
  channels: readonly string[] | undefined | null;
  durationDays: number | null | undefined;
  totalBudget: number | null | undefined;
  now?: Date;
}): CampaignInputCheck {
  if (!mayLaunchOnMeta(input.channels)) return { ok: true };
  const flight = resolveMetaFlightEndTime({
    durationDays: input.durationDays ?? null,
    totalBudget: input.totalBudget && input.totalBudget > 0 ? input.totalBudget : null,
    now: input.now ?? new Date(),
  });
  if (flight.ok) return { ok: true };
  const durationSet = input.durationDays !== null && input.durationDays !== undefined;
  return {
    ok: false,
    message: durationSet
      ? "Durasi campaign harus bilangan bulat 2 sampai 365 hari: Meta hanya menerima budget harian untuk durasi lebih dari 24 jam (1 hari tidak cukup). Ubah durasi. Belum ada yang dibuat."
      : "Budget total memerlukan durasi campaign agar pengeluaran harian bisa dibatasi (syarat peluncuran Meta). Isi durasi di wizard lengkap atau kosongkan budget total. Belum ada yang dibuat.",
  };
}

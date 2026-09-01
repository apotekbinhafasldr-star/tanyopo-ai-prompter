/**
 * Pure progress calculation for a follower growth goal — no Supabase, no
 * secrets, directly unit tested. `current: null` means "no snapshot logged
 * yet," which must render as an honest "belum ada data," never a
 * fabricated 0% (0% implies a known starting point of zero followers,
 * which usually isn't true).
 */
export interface GrowthProgressInput {
  current: number | null;
  target: number;
}

export interface GrowthProgressResult {
  percent: number | null;
  remaining: number | null;
  reached: boolean;
}

export function computeGrowthProgress({ current, target }: GrowthProgressInput): GrowthProgressResult {
  if (current === null) {
    return { percent: null, remaining: null, reached: false };
  }

  if (target <= 0) {
    return { percent: 100, remaining: 0, reached: true };
  }

  const percent = Math.max(0, Math.min(100, Math.round((current / target) * 100)));
  const remaining = Math.max(target - current, 0);

  return { percent, remaining, reached: current >= target };
}

import { allocateDailyBudget, type AllocationRowInput } from "@/lib/campaigns/budget-allocation";

/**
 * Pure helpers that keep the AI's budget split consistent with the channel rows the launch will read
 * (F-01). No `server-only`, no Supabase: directly unit-testable.
 *
 * The AI may omit channels or return percentages that do not add up to 100 (e.g. 33.3 + 33.3 + 33.3). The launch
 * (`allocateDailyBudget`) refuses any master whose channel rows are not valid and sum to exactly 100.00, and that
 * used to be discovered only AFTER the Owner approved. These helpers make the split consistent when it is written
 * and let the submit step refuse an inconsistent one up front, with a message the user can act on.
 */

const TOTAL_BASIS_POINTS = 10000;

/** A dummy daily budget large enough that the "below minimum" rule never fires: only the percentage rules are checked. */
const CHECK_DAILY_BUDGET = 1_000_000_000;

export interface AiAllocationEntry {
  channel: string;
  percentage: number;
}

/**
 * Percentage per SELECTED channel, scaled so the channels that received a positive AI share add up to exactly
 * 100.00 (largest-remainder on basis points). Channels the AI did not allocate, or gave an invalid or zero share
 * while others got a share, are `null`: no share is ever invented for them, the submit check reports them.
 * When no selected channel has a positive valid share every value is `null`.
 */
export function normalizeChannelPercentages(
  channels: readonly string[],
  allocation: readonly AiAllocationEntry[],
): Map<string, number | null> {
  const selected = [...new Set(channels)];
  const raw = new Map<string, number>();
  for (const entry of allocation) {
    if (!selected.includes(entry.channel)) continue;
    if (!Number.isFinite(entry.percentage) || entry.percentage < 0) continue;
    raw.set(entry.channel, (raw.get(entry.channel) ?? 0) + entry.percentage);
  }

  const result = new Map<string, number | null>(selected.map((c) => [c, null]));
  const positive = selected.filter((c) => (raw.get(c) ?? 0) > 0);
  const sum = positive.reduce((s, c) => s + (raw.get(c) as number), 0);
  if (positive.length === 0 || !(sum > 0)) return result;

  const parts = positive.map((channel) => {
    const exact = ((raw.get(channel) as number) / sum) * TOTAL_BASIS_POINTS;
    return { channel, bp: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let leftover = TOTAL_BASIS_POINTS - parts.reduce((s, p) => s + p.bp, 0);
  const order = [...parts].sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.channel < b.channel ? -1 : 1));
  for (const p of order) {
    if (leftover <= 0) break;
    p.bp += 1;
    leftover -= 1;
  }
  for (const p of parts) result.set(p.channel, p.bp / 100);
  return result;
}

export type ChannelAllocationCheck = { ok: true } | { ok: false; error: string };

/**
 * Fail-closed check of the stored channel rows, using the SAME rule set as the launch (`allocateDailyBudget`):
 * every row has a valid percentage, the rows add up to exactly 100.00 and every paid channel has a share above 0.
 * The message is Indonesian and names what to do.
 */
export function checkChannelAllocation(rows: readonly AllocationRowInput[]): ChannelAllocationCheck {
  const result = allocateDailyBudget(CHECK_DAILY_BUDGET, [...rows]);
  if (result.ok) return { ok: true };
  return {
    ok: false,
    error: `Alokasi budget channel belum konsisten: ${result.error} Buat ulang strategi AI agar alokasi dihitung ulang. Tidak ada pengajuan yang dibuat.`,
  };
}

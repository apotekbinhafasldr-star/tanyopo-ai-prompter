import { classifyChannelBudget } from "@/lib/connectors/channel-map";
import type { Channel } from "@/types/database";

/**
 * Pure, deterministic split of a master campaign's daily budget across its
 * PAID channel rows, used by the launch action before any external side
 * effect. No `server-only`, no Supabase: directly unit-testable.
 *
 * Rules (Founder-approved, P0 budget launch safety):
 * - the master `daily_budget` is the TOTAL daily budget across the campaign;
 *   it must be a safe integer > 0 (no fallback to total_budget, no rounding
 *   of fractions);
 * - every channel must be classified PAID or NON_PAID; UNCLASSIFIED blocks;
 * - every row needs a valid `budget_percentage` (0–100), and the percentages
 *   of ALL rows must sum to exactly 100.00;
 * - a PAID row with 0% is invalid and blocks the whole master;
 * - NON_PAID (SEO) rows take no money: paid percentages are renormalised
 *   over the paid rows only;
 * - largest-remainder integer allocation so Σ paid amounts === daily_budget
 *   exactly; ties break by larger weight, then channel name, then row id;
 * - any paid allocation < 1 blocks the whole master.
 * Any failure blocks the whole master — never a partial launch.
 */

export interface AllocationRowInput {
  id: string;
  channel: Channel;
  budgetPercentage: number | null;
}

export type BudgetAllocationErrorCode =
  | "DAILY_BUDGET_INVALID"
  | "NO_CHANNELS"
  | "CHANNEL_UNCLASSIFIED"
  | "PERCENTAGE_INVALID"
  | "PERCENTAGE_SUM_INVALID"
  | "PAID_PERCENTAGE_ZERO"
  | "NO_PAID_CHANNELS"
  | "ALLOCATION_BELOW_MINIMUM";

export type BudgetAllocationResult =
  | {
      ok: true;
      /** Allocated daily budget per paid row id. Σ values === dailyBudget. */
      allocations: Record<string, number>;
      /** Sum of the paid rows' original percentages (e.g. 80). */
      paidTotalPercentage: number;
    }
  | { ok: false; code: BudgetAllocationErrorCode; error: string };

function fail(code: BudgetAllocationErrorCode, error: string): BudgetAllocationResult {
  return { ok: false, code, error };
}

const TOTAL_BASIS_POINTS = 10000; // 100.00%

export function allocateDailyBudget(dailyBudget: number | null, rows: AllocationRowInput[]): BudgetAllocationResult {
  if (dailyBudget == null || !Number.isFinite(dailyBudget) || dailyBudget <= 0) {
    return fail("DAILY_BUDGET_INVALID", "Isi budget per hari terlebih dahulu sebelum meluncurkan campaign.");
  }
  if (!Number.isSafeInteger(dailyBudget)) {
    return fail(
      "DAILY_BUDGET_INVALID",
      "Budget per hari harus berupa bilangan bulat (tanpa desimal). Ubah budget lalu coba lagi.",
    );
  }
  if (rows.length === 0) {
    return fail("NO_CHANNELS", "Campaign belum memiliki channel untuk dialokasikan budget.");
  }

  let allBasisPoints = 0;
  const paid: { id: string; channel: Channel; bp: number; pct: number }[] = [];

  for (const row of rows) {
    const budgetClass = classifyChannelBudget(row.channel);
    if (budgetClass === "UNCLASSIFIED") {
      return fail("CHANNEL_UNCLASSIFIED", `Channel ${row.channel} belum diklasifikasikan sebagai berbayar/non-berbayar.`);
    }
    const pct = row.budgetPercentage;
    if (pct == null || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      return fail("PERCENTAGE_INVALID", `Persentase budget channel ${row.channel} tidak valid.`);
    }
    const bp = Math.round(pct * 100);
    allBasisPoints += bp;
    if (budgetClass === "PAID") {
      if (bp === 0) {
        return fail("PAID_PERCENTAGE_ZERO", `Channel berbayar ${row.channel} memiliki alokasi 0% — perbaiki alokasi budget.`);
      }
      paid.push({ id: row.id, channel: row.channel, bp, pct });
    }
  }

  if (allBasisPoints !== TOTAL_BASIS_POINTS) {
    return fail("PERCENTAGE_SUM_INVALID", "Total persentase alokasi budget semua channel harus tepat 100%.");
  }
  if (paid.length === 0) {
    return fail("NO_PAID_CHANNELS", "Campaign tidak memiliki channel berbayar untuk diluncurkan.");
  }

  const daily = BigInt(dailyBudget);
  const paidBasisPoints = BigInt(paid.reduce((sum, p) => sum + p.bp, 0));

  const parts = paid.map((p) => {
    const numerator = daily * BigInt(p.bp);
    return { ...p, base: numerator / paidBasisPoints, remainder: numerator % paidBasisPoints };
  });

  let leftover = daily - parts.reduce((sum, p) => sum + p.base, BigInt(0));
  const byRemainder = [...parts].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.bp !== b.bp) return b.bp - a.bp;
    if (a.channel !== b.channel) return a.channel < b.channel ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const extra = new Set<string>();
  for (const p of byRemainder) {
    if (leftover <= BigInt(0)) break;
    extra.add(p.id);
    leftover -= BigInt(1);
  }

  const allocations: Record<string, number> = {};
  let sum = 0;
  for (const p of parts) {
    const amount = Number(p.base + (extra.has(p.id) ? BigInt(1) : BigInt(0)));
    if (amount < 1) {
      return fail(
        "ALLOCATION_BELOW_MINIMUM",
        `Budget harian terlalu kecil: channel ${p.channel} hanya mendapat alokasi kurang dari 1. Naikkan budget per hari.`,
      );
    }
    allocations[p.id] = amount;
    sum += amount;
  }
  if (sum !== dailyBudget) {
    return fail("DAILY_BUDGET_INVALID", "Alokasi budget tidak konsisten dengan budget harian.");
  }

  return {
    ok: true,
    allocations,
    paidTotalPercentage: paid.reduce((s, p) => s + p.bp, 0) / 100,
  };
}

import type { Money } from "@/lib/finance/money";

/**
 * Every number the optimization module shows carries one of four states, so a reader can never
 * mistake a simulation for a verified figure or a gap for zero.
 *
 *  TERVERIFIKASI              inputs AND legal parameters were verified by a named person
 *  SIMULASI                   computed from official-source parameters / unverified inputs; not final
 *  BELUM_DAPAT_DIHITUNG       information is missing: no number is shown
 *  PERLU_VERIFIKASI_AKUNTAN   legal uncertainty: no number is computed automatically
 */
export type FigureState = "TERVERIFIKASI" | "SIMULASI" | "BELUM_DAPAT_DIHITUNG" | "PERLU_VERIFIKASI_AKUNTAN";

export const STATE_LABEL: Record<FigureState, string> = {
  TERVERIFIKASI: "TERVERIFIKASI",
  SIMULASI: "SIMULASI",
  BELUM_DAPAT_DIHITUNG: "BELUM DAPAT DIHITUNG",
  PERLU_VERIFIKASI_AKUNTAN: "PERLU VERIFIKASI AKUNTAN/KONSULTAN PAJAK",
};

export interface Figure {
  readonly state: FigureState;
  /** Present only for TERVERIFIKASI and SIMULASI. */
  readonly amount: Money | null;
  readonly reasons: readonly string[];
  readonly assumptions: readonly string[];
  readonly sourceIds: readonly string[];
}

export function computed(
  amount: Money,
  o: { legalVerified: boolean; inputsVerified: boolean; assumptions?: readonly string[]; sourceIds?: readonly string[]; reasons?: readonly string[] },
): Figure {
  return {
    state: o.legalVerified && o.inputsVerified ? "TERVERIFIKASI" : "SIMULASI",
    amount,
    reasons: o.reasons ?? [],
    assumptions: o.assumptions ?? [],
    sourceIds: o.sourceIds ?? [],
  };
}

export function blocked(reasons: readonly string[], sourceIds: readonly string[] = []): Figure {
  return { state: "BELUM_DAPAT_DIHITUNG", amount: null, reasons, assumptions: [], sourceIds };
}

export function uncertain(reasons: readonly string[], sourceIds: readonly string[] = []): Figure {
  return { state: "PERLU_VERIFIKASI_AKUNTAN", amount: null, reasons, assumptions: [], sourceIds };
}

const RANK: Record<FigureState, number> = { TERVERIFIKASI: 0, SIMULASI: 1, PERLU_VERIFIKASI_AKUNTAN: 2, BELUM_DAPAT_DIHITUNG: 3 };

/** The weakest state wins: a result is only as sure as its least sure ingredient. */
export function weakest(states: readonly FigureState[]): FigureState {
  return states.reduce<FigureState>((w, s) => (RANK[s] > RANK[w] ? s : w), "TERVERIFIKASI");
}

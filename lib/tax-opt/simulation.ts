import { compare, sub, zero, type Money } from "@/lib/finance/money";
import { blocked, computed, uncertain, weakest, type Figure, type FigureState } from "./figure";
import { legalParamsVerified, type LegalParameters } from "./law";
import { taxGeneral, type SchemeEvaluation } from "./schemes";
import type { CreditReview } from "./credits";

export type SimulationLineId = "BASE" | "AFTER_ADJUSTMENTS" | "AFTER_FACILITY" | "CREDITS" | "FINAL";

export interface SimulationLine {
  readonly id: SimulationLineId;
  readonly label: string;
  readonly figure: Figure;
}

export interface Simulation {
  readonly lines: readonly SimulationLine[];
  /** Legal saving candidates (never a promise). */
  readonly savings: readonly { readonly id: "FACILITY_31E"; readonly label: string; readonly figure: Figure }[];
  readonly savingsTotal: Figure;
  readonly disclaimer: string;
}

export interface SimulationInput {
  readonly currency: string;
  readonly legal: LegalParameters | null;
  /** Entity-level profit before this period's verified fiscal corrections and loss; null = unknown. */
  readonly profitBeforeAdjustments: Money | null;
  readonly inputsVerified: boolean;
  readonly schemes: SchemeEvaluation;
  readonly credits: CreditReview;
  readonly creditRecordCount: number;
}

const at = <T extends { id: string }>(xs: readonly T[], id: string): T => xs.find((x) => x.id === id) as T;

export function simulate(input: SimulationInput): Simulation {
  const cur = input.currency;
  const general = at(input.schemes.results, "PPH_BADAN_UMUM");
  const f31e = at(input.schemes.results, "PASAL_31E");
  const legalVerified = legalParamsVerified(input.legal);

  const base: Figure =
    !input.legal || input.profitBeforeAdjustments === null
      ? blocked(["Laba seluruh PT atau ketentuan tahun pajak belum tersedia."], ["L1"])
      : computed(taxGeneral(input.profitBeforeAdjustments, input.legal), {
          legalVerified,
          inputsVerified: input.inputsVerified,
          sourceIds: ["L1"],
          assumptions: ["Tarif umum atas laba sebelum koreksi fiskal dan kompensasi rugi (pembanding)."],
        });

  const afterAdj: Figure = general.tax;

  let afterFacility: Figure;
  if (f31e.eligibility === "MEMENUHI_SYARAT") afterFacility = f31e.tax;
  else if (f31e.eligibility === "TIDAK_MEMENUHI") {
    afterFacility = { ...afterAdj, reasons: [...afterAdj.reasons, `Tanpa fasilitas Pasal 31E: ${f31e.reasons.join(" ")}`] };
  } else if (f31e.eligibility === "PERLU_VERIFIKASI_AKUNTAN") afterFacility = uncertain(f31e.reasons, f31e.sourceIds);
  else afterFacility = blocked(f31e.reasons, f31e.sourceIds);

  const credits: Figure =
    input.creditRecordCount === 0
      ? blocked(["Belum ada catatan kredit pajak. Nol berarti tidak ada data, bukan tidak ada kredit."], ["L6"])
      : computed(input.credits.creditableVerified, {
          legalVerified: true,
          inputsVerified: input.credits.flagged === 0,
          sourceIds: ["L6"],
          assumptions: input.credits.flagged > 0 ? [`${input.credits.flagged} catatan ditandai dan tidak dihitung.`] : ["Hanya kredit bukti sah, terverifikasi, dan belum diklaim."],
        });

  let final: Figure;
  if (afterFacility.amount && credits.amount) {
    const state = weakest([afterFacility.state, credits.state]);
    final = {
      state,
      amount: sub(afterFacility.amount, credits.amount),
      reasons: [],
      assumptions: ["Positif = kurang bayar, negatif = lebih bayar. Estimasi, bukan hasil SPT.", ...afterFacility.assumptions],
      sourceIds: Array.from(new Set([...afterFacility.sourceIds, ...credits.sourceIds])),
    };
  } else if (!afterFacility.amount) {
    final = { ...afterFacility, reasons: afterFacility.reasons.length ? afterFacility.reasons : ["Pajak sebelum kredit belum dapat dihitung."] };
  } else {
    final = blocked(["Data kredit pajak belum ada, jadi kewajiban akhir belum dapat dihitung."], ["L6"]);
  }

  // Savings: only the facility's effect is a legal saving candidate. Final-vs-general is a choice
  // between regimes (a human decision), not a saving, and is never shown as one.
  let facilitySaving: Figure;
  if (afterAdj.amount && afterFacility.amount && f31e.eligibility === "MEMENUHI_SYARAT") {
    const diff = sub(afterAdj.amount, afterFacility.amount);
    const state: FigureState = weakest([afterAdj.state, afterFacility.state]);
    facilitySaving = {
      state,
      amount: compare(diff, zero(cur)) > 0 ? diff : zero(cur),
      reasons: [],
      assumptions: ["Estimasi pengurangan karena Pasal 31E melekat pada ketentuan, bukan pilihan; bukan jaminan hasil pemeriksaan.", ...afterFacility.assumptions],
      sourceIds: ["L2", "L1"],
    };
  } else if (f31e.eligibility === "PERLU_VERIFIKASI_AKUNTAN") facilitySaving = uncertain(f31e.reasons, ["L2"]);
  else if (f31e.eligibility === "TIDAK_MEMENUHI") facilitySaving = blocked(["Tidak memenuhi syarat Pasal 31E: tidak ada penghematan dari fasilitas ini."], ["L2"]);
  else facilitySaving = blocked(f31e.reasons.length ? f31e.reasons : ["Data belum cukup."], ["L2"]);

  return {
    lines: [
      { id: "BASE", label: "Pajak sebelum penyesuaian fiskal", figure: base },
      { id: "AFTER_ADJUSTMENTS", label: "Setelah penyesuaian fiskal terverifikasi dan kompensasi rugi", figure: afterAdj },
      { id: "AFTER_FACILITY", label: "Setelah fasilitas yang memenuhi syarat (Pasal 31E)", figure: afterFacility },
      { id: "CREDITS", label: "Kredit pajak terverifikasi (pengurang)", figure: credits },
      { id: "FINAL", label: "Estimasi kewajiban akhir (kurang atau lebih bayar)", figure: final },
    ],
    savings: [{ id: "FACILITY_31E", label: "Pengaruh fasilitas Pasal 31E", figure: facilitySaving }],
    savingsTotal: facilitySaving,
    disclaimer: "Semua angka adalah simulasi dari data yang ada. Bukan SPT, bukan jaminan, dan tidak mengubah pembukuan.",
  };
}

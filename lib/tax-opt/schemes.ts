import { compare, fromMinor, isPositive, mulBps, sub, zero, type Money } from "@/lib/finance/money";
import { blocked, computed, uncertain, type Figure } from "./figure";
import { legalParamsVerified, type LegalParameters } from "./law";

export type LegalForm = "PT" | "PT_PERORANGAN" | "CV" | "FIRMA" | "KOPERASI" | "LAINNYA";
export type SchemeId = "PPH_BADAN_UMUM" | "PASAL_31E" | "PPH_FINAL_UMKM";
export type Eligibility = "MEMENUHI_SYARAT" | "TIDAK_MEMENUHI" | "PERLU_VERIFIKASI_AKUNTAN" | "BELUM_DAPAT_DIHITUNG";

interface Verified {
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;
}
const isVer = (v: Verified | null | undefined): boolean => Boolean(v && v.verifiedBy?.trim() && v.verifiedAt?.trim());

/** Facts about the legal entity. All must be verified by a named person; null means "not known". */
export interface EntityProfile extends Verified {
  readonly legalForm: LegalForm | null;
  /** YYYY-MM-DD: when the entity was registered as a taxpayer. */
  readonly registeredOn: string | null;
  readonly isPublicListed: boolean | null;
  readonly hasOtherIncomeTaxFacility: boolean | null;
  readonly isPermanentEstablishment: boolean | null;
  readonly electedNormalRate: boolean | null;
  readonly providesFreeProfessionServices: boolean | null;
}

/** Gross turnover (peredaran bruto) of the WHOLE PT, final and nonfinal, before costs. */
export interface TurnoverInput extends Verified {
  readonly amount: Money | null;
  /** Every activity of the PT is included. LINOE alone is never enough. */
  readonly complete: boolean;
}

export interface SchemeInput {
  readonly taxYear: string;
  readonly profile: EntityProfile | null;
  readonly turnover: TurnoverInput | null;
  /** Entity-level taxable income (after verified adjustments and loss); null when unknown. */
  readonly taxableIncome: Money | null;
  /** True only when every figure feeding taxableIncome is verified (no pending adjustments, books approved). */
  readonly taxableIncomeVerified: boolean;
  readonly legal: LegalParameters | null;
}

export interface SchemeResult {
  readonly id: SchemeId;
  readonly name: string;
  readonly eligibility: Eligibility;
  readonly reasons: readonly string[];
  readonly tax: Figure;
  readonly sourceIds: readonly string[];
}

export interface SchemeEvaluation {
  readonly results: readonly SchemeResult[];
  /** Combinations the law does not allow together. */
  readonly conflicts: readonly string[];
  /** Always null: the engine never picks a scheme just because it is cheaper. A human decides. */
  readonly recommended: null;
  readonly note: string;
}

/** `floor(amount * numerator / denominator)` on minor units: exact, no floating point. */
export function proportion(amount: Money, numerator: Money, denominator: Money): Money {
  if (denominator.minor <= BigInt(0)) throw new Error("Denominator must be positive");
  return fromMinor((amount.minor * numerator.minor) / denominator.minor, amount.currency);
}

/** Pasal 31E tax on `pkp` for a taxpayer with turnover `omzet`. Pure and exact. */
export function tax31E(pkp: Money, omzet: Money, p: LegalParameters): Money {
  const cur = pkp.currency;
  if (!isPositive(pkp)) return zero(cur);
  const cap = p.facility31E.portionCap;
  const discounted = compare(omzet, cap) <= 0 ? pkp : proportion(pkp, cap, omzet);
  const rest = sub(pkp, discounted);
  const reducedBps = Math.floor((p.corporateRateBps * (100 - p.facility31E.reductionPercent)) / 100);
  const a = mulBps(discounted, reducedBps);
  const b = mulBps(rest, p.corporateRateBps);
  return fromMinor(a.minor + b.minor, cur);
}

export function taxGeneral(pkp: Money, p: LegalParameters): Money {
  return isPositive(pkp) ? mulBps(pkp, p.corporateRateBps) : zero(pkp.currency);
}

export function taxFinalUmkm(turnover: Money, p: LegalParameters): Money {
  return isPositive(turnover) ? mulBps(turnover, p.finalUmkm.rateBps) : zero(turnover.currency);
}

/**
 * Tax years the 0.5% final regime can still cover for an entity that was registered in
 * `registeredOn` (PP 55/2022 Pasal 59, kept as a transition by PP 20/2026). The counting rule is not
 * spelled out on the pages read, so the last year is given as a range: [inclusive, exclusive].
 */
export function finalWindow(form: LegalForm, registeredOn: string): { certainThrough: number; possiblyThrough: number } | null {
  const years = form === "PT" ? 3 : form === "CV" || form === "FIRMA" || form === "KOPERASI" ? 4 : null;
  if (years === null || !/^\d{4}-\d{2}-\d{2}$/.test(registeredOn)) return null;
  let reg = Number(registeredOn.slice(0, 4));
  // Entities registered before PP 23/2018 are counted from 2018 (DJP page, 3 Jan 2024).
  if (reg < 2018) reg = 2018;
  return { certainThrough: reg + years - 1, possiblyThrough: reg + years };
}

const LABEL: Record<SchemeId, string> = {
  PPH_BADAN_UMUM: "PPh Badan umum (Pasal 17)",
  PASAL_31E: "Fasilitas Pasal 31E",
  PPH_FINAL_UMKM: "PPh Final UMKM 0,5%",
};

function gate(input: SchemeInput): { reasons: string[] } {
  const reasons: string[] = [];
  if (!input.legal) reasons.push(`Ketentuan tahun pajak ${input.taxYear} belum diverifikasi.`);
  if (!input.profile) reasons.push("Profil badan hukum belum diisi.");
  else if (!isVer(input.profile)) reasons.push("Profil badan hukum belum diverifikasi.");
  if (!input.turnover || input.turnover.amount === null) reasons.push("Peredaran bruto seluruh PT belum tersedia.");
  else if (!input.turnover.complete) reasons.push("Omzet gabungan seluruh PT belum lengkap: data segmen LINOE saja tidak cukup.");
  else if (!isVer(input.turnover)) reasons.push("Peredaran bruto seluruh PT belum diverifikasi.");
  return { reasons };
}

function ctx(input: SchemeInput) {
  const legalVerified = legalParamsVerified(input.legal);
  const inputsVerified = isVer(input.profile) && isVer(input.turnover) && input.taxableIncomeVerified;
  return { legalVerified, inputsVerified };
}

function unknownResult(id: SchemeId, reasons: string[], sources: string[]): SchemeResult {
  return { id, name: LABEL[id], eligibility: "BELUM_DAPAT_DIHITUNG", reasons, tax: blocked(reasons, sources), sourceIds: sources };
}

function evalGeneral(input: SchemeInput): SchemeResult {
  const sources = ["L1"];
  const g = gate(input);
  const p = input.profile;
  if (!input.legal) return unknownResult("PPH_BADAN_UMUM", g.reasons, sources);
  if (p && isVer(p) && p.isPublicListed === true) {
    const r = ["Perseroan terbuka dapat memakai tarif lain (Pasal 17 ayat (2) huruf b) bila memenuhi syarat: tidak dihitung otomatis."];
    return { id: "PPH_BADAN_UMUM", name: LABEL.PPH_BADAN_UMUM, eligibility: "PERLU_VERIFIKASI_AKUNTAN", reasons: r, tax: uncertain(r, sources), sourceIds: sources };
  }
  if (!p || !isVer(p) || p.isPublicListed === null) return unknownResult("PPH_BADAN_UMUM", ["Status perseroan terbuka belum diverifikasi.", ...g.reasons], sources);
  if (input.taxableIncome === null) {
    const r = ["Penghasilan kena pajak seluruh PT belum tersedia."];
    return { id: "PPH_BADAN_UMUM", name: LABEL.PPH_BADAN_UMUM, eligibility: "MEMENUHI_SYARAT", reasons: r, tax: blocked(r, sources), sourceIds: sources };
  }
  const c = ctx(input);
  return {
    id: "PPH_BADAN_UMUM",
    name: LABEL.PPH_BADAN_UMUM,
    eligibility: "MEMENUHI_SYARAT",
    reasons: ["Tarif umum badan dalam negeri."],
    tax: computed(taxGeneral(input.taxableIncome, input.legal), {
      ...c,
      sourceIds: sources,
      assumptions: [`Tarif ${input.legal.corporateRateBps / 100}% atas penghasilan kena pajak seluruh PT.`, "Pembulatan PKP dan pajak ke rupiah sesuai SPT belum diterapkan."],
    }),
    sourceIds: sources,
  };
}

function eval31E(input: SchemeInput): SchemeResult {
  const sources = ["L2", "L1"];
  const g = gate(input);
  const legal = input.legal;
  if (g.reasons.length > 0 || !legal || !input.profile || !input.turnover?.amount) return unknownResult("PASAL_31E", g.reasons, sources);
  const p = input.profile;
  const omzet = input.turnover.amount;
  if (p.isPermanentEstablishment === null || p.hasOtherIncomeTaxFacility === null) {
    return unknownResult("PASAL_31E", ["Status bentuk usaha tetap dan fasilitas PPh lain belum diverifikasi."], sources);
  }
  if (p.isPermanentEstablishment) {
    const r = ["Bentuk usaha tetap tidak mendapat fasilitas Pasal 31E."];
    return { id: "PASAL_31E", name: LABEL.PASAL_31E, eligibility: "TIDAK_MEMENUHI", reasons: r, tax: blocked(r, sources), sourceIds: sources };
  }
  if (compare(omzet, legal.facility31E.turnoverCap) > 0) {
    const r = ["Peredaran bruto melebihi Rp50 miliar."];
    return { id: "PASAL_31E", name: LABEL.PASAL_31E, eligibility: "TIDAK_MEMENUHI", reasons: r, tax: blocked(r, sources), sourceIds: sources };
  }
  if (p.hasOtherIncomeTaxFacility) {
    const r = ["Ada fasilitas PPh lain: apakah dapat digabung dengan Pasal 31E harus diverifikasi. Tidak digabung otomatis."];
    return { id: "PASAL_31E", name: LABEL.PASAL_31E, eligibility: "PERLU_VERIFIKASI_AKUNTAN", reasons: r, tax: uncertain(r, sources), sourceIds: sources };
  }
  if (!isPositive(omzet)) return unknownResult("PASAL_31E", ["Peredaran bruto harus lebih dari nol untuk menghitung bagian PKP."], sources);
  if (input.taxableIncome === null) {
    const r = ["Penghasilan kena pajak seluruh PT belum tersedia."];
    return { id: "PASAL_31E", name: LABEL.PASAL_31E, eligibility: "MEMENUHI_SYARAT", reasons: r, tax: blocked(r, sources), sourceIds: sources };
  }
  const c = ctx(input);
  return {
    id: "PASAL_31E",
    name: LABEL.PASAL_31E,
    eligibility: "MEMENUHI_SYARAT",
    reasons: ["Badan dalam negeri dengan peredaran bruto sampai Rp50 miliar. Fasilitas ini melekat pada ketentuan, bukan pilihan."],
    tax: computed(tax31E(input.taxableIncome, omzet, legal), {
      ...c,
      sourceIds: sources,
      assumptions: [
        `Tarif ${Math.floor((legal.corporateRateBps * (100 - legal.facility31E.reductionPercent)) / 100) / 100}% atas bagian PKP = PKP x (Rp4,8 miliar / peredaran bruto), sisanya tarif umum.`,
        "Rumus porsi sesuai materi tutorial resmi DJP (contoh omzet Rp30 miliar menghasilkan Rp1.012.000.000); teks pasal dan penjelasan UU tidak terbaca: konfirmasi akuntan.",
        "Pembulatan ke rupiah sesuai SPT belum diterapkan.",
      ],
    }),
    sourceIds: sources,
  };
}

function evalFinal(input: SchemeInput): SchemeResult {
  const sources = ["L3", "L4"];
  const g = gate(input);
  const legal = input.legal;
  if (g.reasons.length > 0 || !legal || !input.profile || !input.turnover?.amount) return unknownResult("PPH_FINAL_UMKM", g.reasons, sources);
  const p = input.profile;
  const omzet = input.turnover.amount;
  const need: string[] = [];
  if (p.legalForm === null) need.push("Jenis badan hukum belum diverifikasi.");
  if (p.registeredOn === null) need.push("Tanggal terdaftar sebagai Wajib Pajak belum diverifikasi.");
  if (p.isPermanentEstablishment === null || p.hasOtherIncomeTaxFacility === null || p.electedNormalRate === null) {
    need.push("Status bentuk usaha tetap, fasilitas PPh lain, dan pilihan tarif umum belum diverifikasi.");
  }
  if (need.length > 0) return unknownResult("PPH_FINAL_UMKM", need, sources);

  const no = (r: string): SchemeResult => ({ id: "PPH_FINAL_UMKM", name: LABEL.PPH_FINAL_UMKM, eligibility: "TIDAK_MEMENUHI", reasons: [r], tax: blocked([r], sources), sourceIds: sources });
  if (p.isPermanentEstablishment) return no("Bentuk usaha tetap dikecualikan dari PPh final UMKM.");
  if (p.electedNormalRate) return no("Wajib Pajak memilih tarif umum Pasal 17: dikecualikan dari PPh final.");
  if (p.hasOtherIncomeTaxFacility) return no("Memperoleh fasilitas PPh tertentu: dikecualikan dari PPh final (fasilitas tidak digabung).");
  if (compare(omzet, legal.finalUmkm.turnoverCap) > 0) return no("Peredaran bruto melebihi Rp4,8 miliar.");
  const form = p.legalForm as LegalForm;
  if (form === "LAINNYA") return unknownResult("PPH_FINAL_UMKM", ["Jenis badan hukum lain belum dievaluasi."], sources);
  if (form === "PT_PERORANGAN" && p.providesFreeProfessionServices === null) {
    return unknownResult("PPH_FINAL_UMKM", ["Apakah perseroan perorangan memberi jasa sejenis pekerjaan bebas belum diverifikasi."], sources);
  }
  if (form === "PT_PERORANGAN" && p.providesFreeProfessionServices) return no("Perseroan perorangan pemberi jasa sejenis pekerjaan bebas dikecualikan.");

  const c = ctx(input);
  const amount = taxFinalUmkm(omzet, legal);
  const assumptions = [
    `Tarif ${legal.finalUmkm.rateBps / 100}% dari peredaran bruto (bukan dari laba); bersifat final dan tidak dapat dikreditkan.`,
    "Tetap terutang walau perusahaan rugi.",
  ];
  if (form === "PT_PERORANGAN") {
    return { id: "PPH_FINAL_UMKM", name: LABEL.PPH_FINAL_UMKM, eligibility: "MEMENUHI_SYARAT", reasons: ["Perseroan perorangan memenuhi Pasal 57 ayat (1) PP 20/2026 (batas waktu umum dihapus).", "Peredaran bruto harus gabungan pendiri orang pribadi dan seluruh perseroan perorangannya (Pasal 57 ayat (2) huruf e, Pasal 58): konfirmasi akuntan."], tax: computed(amount, { ...c, sourceIds: sources, assumptions }), sourceIds: sources };
  }
  if (form !== "KOPERASI" && (p.registeredOn as string) >= "2026-04-22") {
    return no("PT/CV/firma yang terdaftar sejak 22 April 2026 bukan lagi subjek PPh final UMKM (PP 20/2026): hanya peralihan bagi yang sudah berjalan.");
  }
  const w = finalWindow(form, p.registeredOn as string);
  if (!w) return unknownResult("PPH_FINAL_UMKM", ["Jangka waktu PPh final tidak dapat ditentukan dari data yang ada."], sources);
  const year = Number(input.taxYear);
  const base = form === "KOPERASI" ? "Pasal 57 ayat (2) huruf f PP 20/2026" : "peralihan Pasal II angka 1 huruf e PP 20/2026";
  if (year <= w.certainThrough) {
    return {
      id: "PPH_FINAL_UMKM",
      name: LABEL.PPH_FINAL_UMKM,
      eligibility: "MEMENUHI_SYARAT",
      reasons: [`Masih dalam jangka waktu final (${base}); tahun ${input.taxYear} <= ${w.certainThrough}.`],
      tax: computed(amount, { ...c, sourceIds: sources, assumptions: [...assumptions, `Jangka waktu dihitung sejak terdaftar (${p.registeredOn}); PT/CV/firma bukan lagi subjek baru sejak 22 April 2026.`] }),
      sourceIds: sources,
    };
  }
  if (year <= w.possiblyThrough) {
    const r = [`Tahun ${input.taxYear} berada di tahun batas (${w.certainThrough} atau ${w.possiblyThrough}, tergantung cara menghitung tahun pertama). Tidak dihitung otomatis.`];
    return { id: "PPH_FINAL_UMKM", name: LABEL.PPH_FINAL_UMKM, eligibility: "PERLU_VERIFIKASI_AKUNTAN", reasons: r, tax: uncertain(r, sources), sourceIds: sources };
  }
  return no(`Jangka waktu PPh final sejak terdaftar (${p.registeredOn}) sudah berakhir.`);
}

export function evaluateSchemes(input: SchemeInput): SchemeEvaluation {
  const results = [evalGeneral(input), eval31E(input), evalFinal(input)];
  const conflicts = [
    "PPh Final UMKM tidak digabung dengan fasilitas Pasal 31E atau tarif umum untuk penghasilan yang sama: pilih satu jalur.",
    "Fasilitas PPh lain yang diterima membuat PPh final tidak berlaku; penggabungan dengan Pasal 31E harus diverifikasi.",
  ];
  return {
    results,
    conflicts,
    recommended: null,
    note: "Mesin tidak memilih skema hanya karena pajaknya lebih kecil. Pilihan akhir ditetapkan Founder bersama akuntan. Memilih tarif umum (Pasal 17, dengan Pasal 31E) bagi yang semula PPh final wajib diberitahukan ke DJP (Pasal 57 ayat (3) PP 20/2026) dan tidak dapat kembali ke final bila dikecualikan menurut ayat (4).",
  };
}

/** Rejects choosing combinations the law does not allow together. */
export function validateSchemeSelection(selected: readonly SchemeId[]): { ok: true } | { ok: false; reason: string } {
  const s = new Set(selected);
  if (s.has("PPH_FINAL_UMKM") && (s.has("PASAL_31E") || s.has("PPH_BADAN_UMUM"))) {
    return { ok: false, reason: "PPh final UMKM tidak boleh digabung dengan Pasal 31E atau tarif umum." };
  }
  if (s.size === 0) return { ok: false, reason: "Pilih satu skema." };
  return { ok: true };
}

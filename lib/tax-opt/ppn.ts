import { add, sub, zero, type Money } from "@/lib/finance/money";
import { blocked, computed, uncertain, type Figure } from "./figure";

/**
 * PPN review. Active ONLY when PKP status is verified. The engine never creates, completes or
 * guesses a Faktur Pajak: it works only on records that already exist, each with a number and proof.
 * It does not recompute PPN from a rate (the amounts on the faktur are used as stated).
 */
export interface FakturRecord {
  readonly id: string;
  readonly direction: "KELUARAN" | "MASUKAN";
  /** Nomor Faktur Pajak. Required; a record without it is rejected, never completed. */
  readonly number: string | null;
  readonly counterparty: string | null;
  readonly date: string;
  readonly dpp: Money;
  readonly ppn: Money;
  readonly evidenceRef: string | null;
  /** Whether the purchase relates to taxable activities; null = not examined. */
  readonly relatedToTaxableActivity: boolean | null;
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;
}

export type FakturStatus = "DIHITUNG" | "DITOLAK_TANPA_NOMOR" | "DITOLAK_TANPA_BUKTI" | "NOMOR_GANDA" | "BELUM_DIVERIFIKASI" | "PENGKREDITAN_PERLU_VERIFIKASI";

export interface PpnFinding {
  readonly id: string;
  readonly direction: FakturRecord["direction"];
  readonly ppn: Money;
  readonly status: FakturStatus;
  readonly note: string;
}

export type PpnReview =
  | { readonly active: false; readonly reason: string }
  | {
      readonly active: true;
      readonly findings: readonly PpnFinding[];
      readonly outputTax: Money;
      readonly creditableInputTax: Money;
      readonly net: Figure;
    };

const filled = (s: string | null | undefined): boolean => Boolean(s && s.trim());
const NOTE: Record<FakturStatus, string> = {
  DIHITUNG: "Dihitung sesuai nilai pada faktur.",
  DITOLAK_TANPA_NOMOR: "Tanpa nomor Faktur Pajak: tidak dihitung dan tidak dilengkapi otomatis.",
  DITOLAK_TANPA_BUKTI: "Tanpa dokumen bukti: tidak dihitung.",
  NOMOR_GANDA: "Nomor faktur sama dengan catatan lain: tidak dihitung dua kali.",
  BELUM_DIVERIFIKASI: "Belum diverifikasi: tidak dihitung.",
  PENGKREDITAN_PERLU_VERIFIKASI: "Pengkreditan pajak masukan perlu dipastikan akuntan (kaitan dengan penyerahan kena pajak).",
};

export function reviewPpn(input: { pkpVerified: boolean; fakturs: readonly FakturRecord[]; currency: string }): PpnReview {
  if (!input.pkpVerified) {
    return { active: false, reason: "Status PKP belum diverifikasi: modul PPN tidak aktif dan tidak ada angka PPN dihitung." };
  }
  const cur = input.currency;
  const seen = new Set<string>();
  const ids = new Set<string>();
  const findings: PpnFinding[] = [];
  let out = zero(cur);
  let inn = zero(cur);
  let hold = false;
  for (const f of input.fakturs) {
    if (ids.has(f.id)) throw new Error(`Duplicate faktur record ${f.id}`);
    ids.add(f.id);
    const key = f.number?.trim().toLowerCase() ?? "";
    let status: FakturStatus;
    if (!key) status = "DITOLAK_TANPA_NOMOR";
    else if (!filled(f.evidenceRef)) status = "DITOLAK_TANPA_BUKTI";
    else if (seen.has(`${f.direction}|${key}`)) status = "NOMOR_GANDA";
    else if (!filled(f.verifiedBy) || !filled(f.verifiedAt)) status = "BELUM_DIVERIFIKASI";
    else if (f.direction === "MASUKAN" && f.relatedToTaxableActivity !== true) status = "PENGKREDITAN_PERLU_VERIFIKASI";
    else status = "DIHITUNG";
    if (key) seen.add(`${f.direction}|${key}`);
    if (status === "DIHITUNG") {
      if (f.direction === "KELUARAN") out = add(out, f.ppn);
      else inn = add(inn, f.ppn);
    }
    if (status === "PENGKREDITAN_PERLU_VERIFIKASI" || status === "BELUM_DIVERIFIKASI") hold = true;
    findings.push({ id: f.id, direction: f.direction, ppn: f.ppn, status, note: NOTE[status] });
  }
  let net: Figure;
  if (input.fakturs.length === 0) net = blocked(["Belum ada Faktur Pajak yang dicatat. Faktur tidak dibuat atau diperkirakan oleh sistem."], ["L9"]);
  else if (hold) net = uncertain(["Ada faktur yang belum diverifikasi atau pengkreditannya perlu dipastikan akuntan."], ["L9"]);
  else {
    net = computed(sub(out, inn), {
      legalVerified: false,
      inputsVerified: true,
      sourceIds: ["L9"],
      assumptions: ["Jumlah PPN mengikuti nilai pada Faktur Pajak; tarif tidak dihitung ulang.", "Pengkreditan pajak masukan harus dikonfirmasi akuntan."],
    });
  }
  return { active: true, findings, outputTax: out, creditableInputTax: inn, net };
}

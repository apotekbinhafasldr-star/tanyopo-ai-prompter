import { compare, isNegative, sub, zero, add, type Money } from "@/lib/finance/money";
import { blocked, computed, type Figure } from "./figure";

/**
 * Verification of tax notices (Surat Tagihan Pajak, Surat Ketetapan Pajak). The module compares and
 * lists the official paths; it NEVER concludes that DJP is right or wrong. Deadlines are computed only
 * from dates it was given, and only for rules read on an official page.
 */
export type NoticeType = "STP" | "SKPKB" | "SKPKBT" | "SKPLB" | "SKPN";

export interface NoticeEvidence {
  readonly ref: string;
  readonly kind: "BUKTI_BAYAR" | "BUKTI_POTONG" | "DOKUMEN_PENDUKUNG";
  readonly amount: Money | null;
}

export interface TaxNotice {
  readonly id: string;
  readonly type: NoticeType;
  readonly number: string;
  readonly taxType: string;
  readonly period: string;
  /** Tanggal surat (date printed). */
  readonly issuedOn: string;
  /** Tanggal surat dikirim (date sent): the keberatan clock starts here. */
  readonly sentOn: string | null;
  readonly assessed: Money;
  /** The taxpayer's own computed amount for the same thing, null if not computed yet. */
  readonly ourComputation: Money | null;
  readonly sanctionAmount: Money | null;
  /** Legal basis written on the notice. */
  readonly legalBasisOnNotice: string | null;
  readonly evidence: readonly NoticeEvidence[];
}

export type PathApplicability = "DAPAT_DIAJUKAN" | "PERLU_VERIFIKASI_AKUNTAN" | "TIDAK_BERLAKU";

export interface ResolutionPath {
  readonly id: "KEBERATAN" | "PENGURANGAN_SANKSI" | "PENGURANGAN_PEMBATALAN_KETETAPAN" | "BANDING" | "PEMBETULAN_STP";
  readonly name: string;
  readonly applicability: PathApplicability;
  /** YYYY-MM-DD, only when computable from a known date and a verified rule. */
  readonly deadline: string | null;
  readonly deadlineNote: string;
  readonly requirements: readonly string[];
  readonly sourceIds: readonly string[];
}

export interface NoticeCheck {
  readonly noticeId: string;
  readonly conclusion: "TIDAK_DISIMPULKAN";
  readonly difference: Figure;
  readonly paid: Money;
  readonly outstanding: Money;
  readonly missingDocuments: readonly string[];
  readonly paths: readonly ResolutionPath[];
  readonly warnings: readonly string[];
}

/** Adds calendar months; the day is clamped to the last day of the target month. */
export function addMonths(date: string, months: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const total = y * 12 + mo + months;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${String(ty).padStart(4, "0")}-${String(tm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function checkNotice(n: TaxNotice, currency: string): NoticeCheck {
  const warnings: string[] = ["Surat tidak disimpulkan benar atau salah. Pemeriksaan ini membandingkan angka dan menunjukkan jalur resmi."];
  const missing: string[] = [];
  if (!n.legalBasisOnNotice?.trim()) missing.push("Dasar hukum yang tertulis pada surat");
  if (n.ourComputation === null) missing.push("Perhitungan sendiri untuk jenis pajak dan masa yang sama");
  if (!n.evidence.some((e) => e.kind === "BUKTI_BAYAR")) missing.push("Bukti pembayaran (mis. NTPN)");
  if (!n.evidence.some((e) => e.kind === "DOKUMEN_PENDUKUNG" || e.kind === "BUKTI_POTONG")) missing.push("Dokumen pendukung perhitungan");
  if (n.sentOn === null) missing.push("Tanggal surat dikirim (menentukan tenggat keberatan)");

  let paid = zero(currency);
  for (const e of n.evidence) if (e.kind === "BUKTI_BAYAR" && e.amount && !isNegative(e.amount)) paid = add(paid, e.amount);
  const outstanding = compare(n.assessed, paid) > 0 ? sub(n.assessed, paid) : zero(currency);

  const difference: Figure =
    n.ourComputation === null
      ? blocked(["Perhitungan sendiri belum ada, jadi selisih belum dapat dihitung."])
      : computed(sub(n.assessed, n.ourComputation), {
          legalVerified: false,
          inputsVerified: false,
          assumptions: ["Selisih = angka pada surat dikurangi perhitungan sendiri. Selisih bukan bukti surat salah."],
        });

  const paths: ResolutionPath[] = [];
  const objectable = n.type === "SKPKB" || n.type === "SKPKBT" || n.type === "SKPN" || n.type === "SKPLB";
  const clock = n.sentOn ? addMonths(n.sentOn, 3) : null;
  paths.push({
    id: "KEBERATAN",
    name: "Keberatan",
    applicability: objectable ? (n.sentOn ? "DAPAT_DIAJUKAN" : "PERLU_VERIFIKASI_AKUNTAN") : "TIDAK_BERLAKU",
    deadline: objectable ? clock : null,
    deadlineNote: objectable
      ? n.sentOn
        ? "3 bulan sejak tanggal surat dikirim (Pasal 25 UU KUP). Hari terakhir dihitung otomatis; konfirmasikan tanggal kirim yang tercatat DJP."
        : "Tanggal surat dikirim belum diisi: tenggat belum dapat dihitung."
      : "Keberatan hanya untuk SKPKB, SKPKBT, SKPN, SKPLB, dan pemotongan/pemungutan; tidak untuk STP.",
    requirements: [
      "Surat tertulis berbahasa Indonesia berisi jumlah pajak menurut Wajib Pajak dan alasannya",
      "Satu surat keberatan untuk satu surat ketetapan",
      "Pajak yang masih harus dibayar dilunasi minimal sejumlah yang disetujui dalam Pembahasan Akhir sebelum surat keberatan disampaikan",
      "Tidak bersamaan dengan permohonan pengurangan/penghapusan sanksi atas surat yang sama",
    ],
    sourceIds: ["L7"],
  });
  paths.push({
    id: "PENGURANGAN_SANKSI",
    name: "Pengurangan atau penghapusan sanksi administrasi",
    applicability: n.sanctionAmount && compare(n.sanctionAmount, zero(currency)) > 0 ? "PERLU_VERIFIKASI_AKUNTAN" : "TIDAK_BERLAKU",
    deadline: null,
    deadlineNote: "Tenggat permohonan pertama tidak disebut di halaman yang dibaca. Permohonan kedua paling lambat 3 bulan sejak keputusan pertama dikirim.",
    requirements: [
      "Pajak yang kurang dibayar sudah dilunasi",
      "Alasan: sanksi timbul karena kekhilafan, bukan kesalahan Wajib Pajak, atau hal tertentu",
      "Satu permohonan untuk satu SKP atau STP; tidak bersamaan dengan keberatan",
    ],
    sourceIds: ["L8"],
  });
  paths.push({
    id: "PENGURANGAN_PEMBATALAN_KETETAPAN",
    name: "Pengurangan atau pembatalan ketetapan pajak yang tidak benar",
    applicability: "PERLU_VERIFIKASI_AKUNTAN",
    deadline: null,
    deadlineNote: "Dasar hukum dan tenggat tidak diuraikan di halaman yang dibaca (tata cara PMK 118/2024). Konsultasikan ke akuntan atau KPP.",
    requirements: ["Tidak bersamaan dengan keberatan atau pengurangan sanksi atas surat yang sama"],
    sourceIds: ["L7", "L8"],
  });
  paths.push({
    id: "BANDING",
    name: "Banding ke Pengadilan Pajak",
    applicability: objectable ? "PERLU_VERIFIKASI_AKUNTAN" : "TIDAK_BERLAKU",
    deadline: null,
    deadlineNote: "Hanya atas Surat Keputusan Keberatan (Pasal 27 UU KUP). Tenggat banding tidak disebut di halaman yang dibaca: tidak dihitung otomatis.",
    requirements: ["Didahului keberatan", "Denda 60% bila banding ditolak atau dikabulkan sebagian"],
    sourceIds: ["L7"],
  });
  if (n.type === "STP") {
    paths.push({
      id: "PEMBETULAN_STP",
      name: "Pembetulan atau penyelesaian STP",
      applicability: "PERLU_VERIFIKASI_AKUNTAN",
      deadline: null,
      deadlineNote: "Prosedur khusus STP tidak diuraikan di halaman yang dibaca. Pengurangan sanksi atas STP dimungkinkan (lihat jalur sanksi).",
      requirements: ["Periksa dasar penerbitan STP pada surat"],
      sourceIds: ["L8"],
    });
  }
  return { noticeId: n.id, conclusion: "TIDAK_DISIMPULKAN", difference, paid, outstanding, missingDocuments: missing, paths, warnings };
}

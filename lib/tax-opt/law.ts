import { money, type Money } from "@/lib/finance/money";

/**
 * Legal basis registry. Each entry says WHAT was read, WHERE, and WHEN, and how much weight it can
 * bear. Nothing here is a substitute for the regulation text or for an accountant: where only a DJP
 * article (not the regulation itself) was read, or the article says nothing about a point, the
 * entry says so and the engine treats that point as "perlu verifikasi".
 */
export type SourceKind = "PERATURAN_RESMI_SALINAN" | "HALAMAN_DJP" | "ARTIKEL_PEGAWAI_DJP";

export interface LegalSource {
  readonly id: string;
  readonly regulation: string;
  readonly articles: readonly string[];
  readonly subject: string;
  /** Masa berlaku as far as the source states it. */
  readonly effective: string;
  readonly requirements: readonly string[];
  readonly url: string;
  readonly kind: SourceKind;
  /** Date printed on the page; null when the page prints none. */
  readonly pageDate: string | null;
  readonly verifiedOn: string;
  readonly caveat: string | null;
}

export const LAW_VERIFIED_ON = "2026-10-27";

const V = LAW_VERIFIED_ON;

export const LEGAL_SOURCES: readonly LegalSource[] = [
  {
    id: "L1",
    regulation: "UU Nomor 7 Tahun 1983 tentang Pajak Penghasilan, terakhir diubah UU Nomor 7 Tahun 2021 (UU HPP)",
    articles: ["Pasal 17 ayat (1) huruf b"],
    subject: "Tarif PPh Badan umum 22%",
    effective: "Sejak tahun pajak 2022 (menurut halaman DJP)",
    requirements: ["Wajib Pajak badan dalam negeri", "Perseroan terbuka yang memenuhi syarat memakai tarif lain (Pasal 17 ayat (2) huruf b): tidak dihitung otomatis"],
    url: "https://www.pajak.go.id/en/node/94054",
    kind: "ARTIKEL_PEGAWAI_DJP",
    pageDate: "11 April 2023",
    verifiedOn: V,
    caveat: "Artikel pegawai DJP (pendapat penulis). Teks pasal tidak dibaca langsung.",
  },
  {
    id: "L2",
    regulation: "UU Nomor 7 Tahun 1983 tentang Pajak Penghasilan jo. UU Nomor 7 Tahun 2021",
    articles: ["Pasal 31E ayat (1)"],
    subject: "Pengurangan tarif 50% untuk peredaran bruto sampai Rp50 miliar, atas bagian PKP dari peredaran bruto sampai Rp4,8 miliar",
    effective: "Berlaku setelah UU HPP (usulan penghapusan dibatalkan); tahun pajak 2022 ke atas menurut halaman DJP",
    requirements: [
      "Wajib Pajak badan dalam negeri (bentuk usaha tetap tidak termasuk)",
      "Peredaran bruto sampai Rp50.000.000.000 (seluruh penghasilan: usaha dan di luar usaha, final dan nonfinal, sebelum biaya)",
      "Dilaksanakan sendiri (self assessment) pada SPT Tahunan; bukan pilihan",
      "Hanya atas PKP dari penghasilan yang tidak final",
    ],
    url: "https://www.pajak.go.id/en/node/72506",
    kind: "ARTIKEL_PEGAWAI_DJP",
    pageDate: "27 Oktober 2021",
    verifiedOn: V,
    caveat:
      "Rumus porsi PKP = (Rp4,8 miliar / peredaran bruto) x PKP tidak tertulis eksplisit di halaman DJP yang dibaca (diturunkan dari uraian). Konfirmasi ke teks pasal dan penjelasannya.",
  },
  {
    id: "L3",
    regulation: "PP Nomor 20 Tahun 2026 tentang Perubahan atas PP Nomor 55 Tahun 2022",
    articles: ["Pasal I angka 3-6 (Pasal 56, 57, 58; Pasal 59 dihapus)", "Pasal II angka 1 huruf e (peralihan)"],
    subject: "PPh final 0,5% UMKM: subjek, batas Rp4,8 miliar, pengecualian, peralihan",
    effective: "Ditetapkan dan diundangkan 22 April 2026; berlaku sejak diundangkan",
    requirements: [
      "Subjek: orang pribadi, perseroan perorangan (didirikan 1 orang), koperasi; peredaran bruto tidak melebihi Rp4.800.000.000 dalam satu tahun pajak",
      "PT selain perseroan perorangan, CV, firma, BUMDes: hanya peralihan, sampai jangka waktu final yang sudah berjalan berakhir",
      "Dikecualikan: memilih tarif Pasal 17, memperoleh fasilitas PPh tertentu, bentuk usaha tetap, melewati batas",
    ],
    url: "https://pajak.go.id/en/node/119935",
    kind: "HALAMAN_DJP",
    pageDate: "22 April 2026",
    verifiedOn: V,
    caveat: "Salinan PDF resmi berupa pindaian (OCR tidak sempurna). Periksa Lembaran Negara 2026 Nomor 43 untuk redaksi persis.",
  },
  {
    id: "L4",
    regulation: "PP Nomor 55 Tahun 2022 (sebelum diubah PP 20/2026)",
    articles: ["Pasal 59 (jangka waktu PPh final bagi badan; dihapus oleh PP 20/2026 untuk subjek baru)"],
    subject: "Jangka waktu PPh final 0,5%: PT 3 tahun pajak, CV/firma/koperasi 4 tahun pajak, sejak terdaftar",
    effective: "PP 55/2022; relevan hanya sebagai ukuran peralihan menurut PP 20/2026",
    requirements: ["Dihitung sejak Wajib Pajak terdaftar; yang terdaftar sebelum PP 23/2018 dihitung mulai 2018"],
    url: "https://pajak.go.id/en/node/103985",
    kind: "HALAMAN_DJP",
    pageDate: "3 Januari 2024",
    verifiedOn: V,
    caveat:
      "Apakah tahun pajak saat terdaftar dihitung sebagai tahun pertama tidak dijelaskan di halaman. Mesin menandai tahun batas sebagai PERLU VERIFIKASI.",
  },
  {
    id: "L5",
    regulation: "UU Pajak Penghasilan jo. UU 7/2021; PP 20/2026 Pasal I angka 2 (Pasal 20A)",
    articles: ["Pasal 6 ayat (1) UU PPh", "Pasal 9 ayat (1) UU PPh (teks tidak dibaca)", "Pasal 20A PP 55/2022 sebagaimana ditambah PP 20/2026"],
    subject: "Biaya untuk mendapatkan, menagih, dan memelihara penghasilan dapat dikurangkan; suap dan gratifikasi bukan biaya",
    effective: "Berlaku; Pasal 20A sejak 22 April 2026",
    requirements: ["Biaya berkaitan langsung atau tidak langsung dengan kegiatan usaha", "Perlu bukti dan pembukuan yang benar"],
    url: "https://pajak.go.id/en/node/34283",
    kind: "HALAMAN_DJP",
    pageDate: null,
    verifiedOn: V,
    caveat: "Halaman tanpa tanggal. Daftar biaya yang tidak boleh dikurangkan (Pasal 9) tidak dibaca: perlakuan nondeductible selalu perlu verifikasi akuntan.",
  },
  {
    id: "L6",
    regulation: "UU Pajak Penghasilan",
    articles: ["Pasal 28"],
    subject: "Kredit pajak (PPh 21, 22, 23, 24, 25); pajak final tidak dapat dikreditkan",
    effective: "Berlaku",
    requirements: ["Dibuktikan bukti potong/pungut atau bukti pembayaran yang sah", "PPh 24 dibatasi per negara: tidak dihitung otomatis"],
    url: "https://pajak.go.id/en/node/34286",
    kind: "HALAMAN_DJP",
    pageDate: null,
    verifiedOn: V,
    caveat: "Halaman tanpa tanggal. Rincian bukti PPh 22 dan 23 tidak dirinci di halaman.",
  },
  {
    id: "L7",
    regulation: "UU Nomor 6 Tahun 1983 (KUP) jo. UU 7/2021; PMK 118/2024 (tata cara)",
    articles: ["Pasal 25 (keberatan)", "Pasal 27 (banding)"],
    subject: "Keberatan atas SKPKB, SKPKBT, SKPN, SKPLB dan pemotongan/pemungutan; banding atas keputusan keberatan",
    effective: "Berlaku",
    requirements: [
      "Keberatan diajukan dalam 3 bulan sejak tanggal surat ketetapan dikirim",
      "Pajak yang masih harus dibayar dilunasi minimal sejumlah yang disetujui dalam Pembahasan Akhir sebelum surat keberatan disampaikan",
      "DJP memutus dalam 12 bulan; denda 30% jika keberatan ditolak/sebagian, 60% untuk banding ditolak/sebagian",
    ],
    url: "https://pajak.go.id/en/node/34971",
    kind: "HALAMAN_DJP",
    pageDate: null,
    verifiedOn: V,
    caveat: "Halaman keberatan tanpa tanggal; ringkasan upaya hukum bertanggal 27 Februari 2025 (https://www.pajak.go.id/en/node/114280). Tenggat banding tidak disebut di halaman yang dibaca.",
  },
  {
    id: "L8",
    regulation: "UU KUP jo. UU 7/2021",
    articles: ["Pasal 36 (dirujuk halaman keberatan; tidak disebut eksplisit di halaman ini)"],
    subject: "Pengurangan atau penghapusan sanksi administrasi (bunga, denda, kenaikan) pada SKP dan STP",
    effective: "Update halaman 16 Januari 2025",
    requirements: [
      "Pajak yang tidak atau kurang dibayar sudah dilunasi",
      "Permohonan tertulis, satu permohonan untuk satu SKP atau STP, ditandatangani WP/wakil/kuasa",
      "Tidak boleh ada upaya hukum lain atas surat yang sama (keberatan, pengurangan/pembatalan)",
      "Maksimal dua kali; permohonan kedua dalam 3 bulan sejak keputusan pertama dikirim; selesai paling lama 6 bulan",
    ],
    url: "https://www.pajak.go.id/en/node/34976",
    kind: "HALAMAN_DJP",
    pageDate: "16 Januari 2025",
    verifiedOn: V,
    caveat: "Alasan permohonan hanya disebut garis besar (kekhilafan, bukan kesalahan WP).",
  },
  {
    id: "L9",
    regulation: "UU Pajak Pertambahan Nilai; informasi DJP tentang PKP dan SPT Masa PPN",
    articles: ["Pengkreditan Pajak Masukan (Pasal 9 UU PPN): teks tidak dibaca"],
    subject: "PKP wajib lapor SPT Masa PPN tiap bulan termasuk nihil; SPT Masa PPN auto-created dari Faktur Pajak",
    effective: "Halaman 19 Januari 2026 dan update 06/10/2025",
    requirements: ["Hanya PKP yang sudah dikukuhkan", "Pajak masukan dikreditkan hanya dengan Faktur Pajak yang sah"],
    url: "https://www.pajak.go.id/en/node/119028",
    kind: "HALAMAN_DJP",
    pageDate: "19 Januari 2026",
    verifiedOn: V,
    caveat: "Syarat rinci pengkreditan pajak masukan tidak dibaca: pengkreditan selalu perlu verifikasi akuntan. Tarif PPN tidak dihitung ulang oleh mesin.",
  },
];

export const lawById = (id: string): LegalSource | undefined => LEGAL_SOURCES.find((s) => s.id === id);

/** Parameters for a tax year. Verified by a human or the result can never be TERVERIFIKASI. */
export interface LegalParameters {
  readonly taxYear: string;
  /** Pasal 17 ayat (1) huruf b, basis points. */
  readonly corporateRateBps: number;
  readonly facility31E: { readonly reductionPercent: number; readonly turnoverCap: Money; readonly portionCap: Money };
  readonly finalUmkm: { readonly rateBps: number; readonly turnoverCap: Money };
  readonly sourceIds: readonly string[];
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;
}

export const SUPPORTED_TAX_YEARS = ["2022", "2023", "2024", "2025", "2026"] as const;

/**
 * Official-source values for the tax years whose rules were read (2022-2026). Any other year is
 * null: the year's rules were not verified, so nothing is computed.
 */
export function legalParametersFor(
  taxYear: string,
  verification: { verifiedBy: string | null; verifiedAt: string | null } = { verifiedBy: null, verifiedAt: null },
): LegalParameters | null {
  if (!(SUPPORTED_TAX_YEARS as readonly string[]).includes(taxYear)) return null;
  return {
    taxYear,
    corporateRateBps: 2200,
    facility31E: { reductionPercent: 50, turnoverCap: money("50000000000", "IDR"), portionCap: money("4800000000", "IDR") },
    finalUmkm: { rateBps: 50, turnoverCap: money("4800000000", "IDR") },
    sourceIds: ["L1", "L2", "L3", "L4"],
    verifiedBy: verification.verifiedBy,
    verifiedAt: verification.verifiedAt,
  };
}

export const legalParamsVerified = (p: LegalParameters | null): boolean => Boolean(p && p.verifiedBy?.trim() && p.verifiedAt?.trim());

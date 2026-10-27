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
      "Rumus porsi dan contoh angka diverifikasi dari materi tutorial resmi DJP (lihat L10), bukan dari teks pasal atau penjelasan UU yang tidak terbaca (PDF UU terpotong): BLOCKED untuk teks primer.",
  },
  {
    id: "L3",
    regulation: "PP Nomor 20 Tahun 2026 tentang Perubahan atas PP Nomor 55 Tahun 2022 (LN 2026 No. 43, TLN 7173)",
    articles: [
      "Pasal I angka 3 (Pasal 56)",
      "Pasal I angka 4 (Pasal 57 ayat (1)-(5))",
      "Pasal I angka 5 (Pasal 58)",
      "Pasal I angka 6 (Pasal 59 dihapus)",
      "Pasal I angka 2 (Pasal 20A)",
      "Pasal II ayat (1) huruf a-g (peralihan)",
    ],
    subject: "PPh final 0,5% UMKM: subjek, batas Rp4,8 miliar, pengecualian, peralihan",
    effective: "Ditetapkan dan diundangkan 22 April 2026; berlaku sejak diundangkan (Pasal II)",
    requirements: [
      "Pasal 57(1): subjek orang pribadi, perseroan perorangan (1 pemilik), koperasi; peredaran bruto tidak melebihi Rp4.800.000.000 per tahun pajak",
      "Pasal 57(2): dikecualikan bila memilih tarif Pasal 17 (badan: dengan mempertimbangkan Pasal 31E), perseroan perorangan pemberi jasa sejenis pekerjaan bebas, fasilitas Pasal 31A/PP 94/2010/KEK, BUT, total peredaran bruto orang pribadi beserta seluruh perseroan perorangannya melebihi Rp4,8 miliar, koperasi lewat empat tahun pajak sejak terdaftar",
      "Pasal 57(3): yang memilih tarif umum wajib memberitahukan kepada DJP; Pasal 57(4): yang dikecualikan karena huruf e/f atau (3) tidak dapat kembali ke PPh final tahun pajak berikutnya",
      "Pasal 58: peredaran bruto dihitung dari tahun pajak terakhir sebelum tahun pajak berjalan; digabung antara suami-istri (dan anak belum dewasa) dan perseroan perorangan mereka",
      "Pasal II(1)e: CV, firma, PT selain perseroan perorangan 1 pemilik, BUMDes: PPh final boleh berlanjut hanya sampai jangka waktu menurut PP 55/2022 berakhir, selama kriteria terpenuhi",
      "Pasal II: tidak ada peralihan khusus untuk Wajib Pajak yang terdaftar setelah PP berlaku; berlaku Pasal 57 dan 58",
    ],
    url: "https://jdih.kemenkeu.go.id/api/download/d057ff82-50e7-4127-b66b-f704a36f071d/2026pp020.pdf",
    kind: "PERATURAN_RESMI_SALINAN",
    pageDate: "22 April 2026",
    verifiedOn: V,
    caveat:
      "Naskah resmi (JDIH Kemenkeu) dibaca lewat alat baca halaman yang meringkas; kutipan dibatasi, bukan salinan harfiah seluruhnya. Bandingkan dengan Lembaran Negara sebelum dipakai untuk keputusan.",
  },
  {
    id: "L4",
    regulation: "PP Nomor 23 Tahun 2018 (salinan resmi di pajak.go.id) dan PP Nomor 55 Tahun 2022",
    articles: ["Pasal 5 PP 23/2018 (jangka waktu)", "Pasal 59 PP 55/2022 (naskah tidak terbaca: BLOCKED)"],
    subject: "Jangka waktu PPh final 0,5% badan: PT 3 tahun pajak, CV/firma/koperasi 4 tahun pajak",
    effective: "PP 23/2018 sejak 2018; relevan sebagai ukuran peralihan menurut PP 20/2026 Pasal II(1)e",
    requirements: [
      "Dihitung mulai tahun pajak Wajib Pajak terdaftar (terdaftar setelah PP berlaku)",
      "Terdaftar sebelum PP berlaku: dihitung mulai tahun pajak 2018",
      "Pasal 59 PP 55/2022 (aturan jangka waktu yang berlaku sejak 2022) belum terbaca: kesamaan dengan PP 23/2018 tidak dipastikan",
    ],
    url: "https://www.pajak.go.id/sites/default/files/2019-05/PP%20Nomor%2023%20Tahun%202018.pdf",
    kind: "PERATURAN_RESMI_SALINAN",
    pageDate: null,
    verifiedOn: V,
    caveat:
      "Pasal 59 PP 55/2022 berupa berkas biner yang tidak terbaca. Tahun pertama dihitung sejak tahun terdaftar menurut PP 23/2018; tahun batas tetap ditandai PERLU VERIFIKASI karena PP 55/2022 belum terbaca.",
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
  {
    id: "L10",
    regulation: "Materi tutorial DJP: Tata Cara Pengisian SPT Tahunan 1771 Non Final di atas Rp4,8 M",
    articles: ["Rumus Pasal 31E ayat (1) untuk peredaran bruto di atas Rp4,8 miliar sampai Rp50 miliar"],
    subject: "PKP berfasilitas = (Rp4,8 miliar / peredaran bruto) x PKP, tarif 11%; sisa PKP tarif 22%. Contoh: omzet Rp30 miliar, PKP Rp5 miliar menghasilkan PPh Rp1.012.000.000",
    effective: "Materi DJP (berkas Maret 2024)",
    requirements: ["Peredaran bruto di atas Rp4,8 miliar sampai Rp50 miliar", "Dipakai sebagai vektor uji, bukan sebagai teks hukum"],
    url: "https://www.pajak.go.id/sites/default/files/2024-03/Tutorial%20SPT%201771%20Non%20Final%20diatas%204,8%20M_0.pdf",
    kind: "HALAMAN_DJP",
    pageDate: "Maret 2024 (menurut jalur berkas)",
    verifiedOn: V,
    caveat: "Materi tutorial, bukan peraturan. Cocok dengan rumus mesin dan dipakai sebagai tes.",
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

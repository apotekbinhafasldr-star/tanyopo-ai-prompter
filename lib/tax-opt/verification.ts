import { LAW_VERIFIED_ON } from "./law";

/**
 * Honest status of every legal provision the engine leans on. BLOCKED means the primary text
 * could not be read from this environment: nothing is concluded from it, and anything that
 * depends on it stays PERLU VERIFIKASI AKUNTAN/KONSULTAN PAJAK.
 */
export type ProvisionStatus =
  | "TERVERIFIKASI_PRIMER" // primary text read
  | "TERVERIFIKASI_SEBAGIAN" // primary text read in part
  | "SEKUNDER_DJP" // only DJP guidance read, not the text
  | "HISTORIS_DIHAPUS" // superseded: deleted by a later regulation; never used to compute
  | "BLOCKED"; // not retrievable

export interface ProvisionCheck {
  readonly id: string;
  readonly provision: string;
  readonly status: ProvisionStatus;
  readonly sourceIds: readonly string[];
  readonly note: string;
  /** For BLOCKED / DJP-only / historical items: the document that would settle it. */
  readonly needed?: string;
}

export const PROVISION_CHECKS: readonly ProvisionCheck[] = [
  { id: "P1", provision: "PP 20/2026 Pasal I angka 3-6 (mengubah Pasal 56, 57, 58 dan MENGHAPUS Pasal 59 PP 55/2022)", status: "TERVERIFIKASI_PRIMER", sourceIds: ["L3"], note: "Naskah resmi JDIH Kemenkeu dibaca; angka 6 berbunyi \"Pasal 59 dihapus.\" (tanpa pengganti). Ayat (1)-(5) Pasal 57, Pasal 58 dan contoh Penjelasan." },
  { id: "P2", provision: "PP 20/2026 Pasal II (peralihan) huruf a-g", status: "TERVERIFIKASI_PRIMER", sourceIds: ["L3"], note: "PT selain perseroan perorangan: hanya lanjutan sampai jangka waktu PP 55/2022 berakhir. Tidak ada peralihan bagi yang terdaftar setelah 22 April 2026." },
  { id: "P3", provision: "Pembedaan perseroan perorangan (1 pemilik) dan PT biasa", status: "TERVERIFIKASI_PRIMER", sourceIds: ["L3"], note: "Perseroan perorangan subjek tanpa batas waktu (kecuali dikecualikan Pasal 57(2)); PT biasa hanya peralihan." },
  { id: "P4", provision: "PP 23/2018 Pasal 5 (jangka waktu 3/4 tahun, hitung dari tahun terdaftar atau 2018)", status: "TERVERIFIKASI_PRIMER", sourceIds: ["L4"], note: "Salinan resmi di pajak.go.id." },
  { id: "P5", provision: "PP 55/2022 Pasal 59 (jangka waktu versi 2022)", status: "HISTORIS_DIHAPUS", sourceIds: ["L3", "L4"], note: "Dihapus oleh PP 20/2026 Pasal I angka 6 (berlaku sejak 22 April 2026). Ketentuan historis: tidak dipakai menghitung otomatis. Naskah aslinya (berkas biner JDIH) tetap tidak terbaca. Peralihan hanya lewat Pasal II ayat (1) huruf e dan contoh Penjelasannya.", needed: "Salinan teks PP 55/2022 Pasal 59 yang terbaca, atau pendapat tertulis konsultan pajak tentang lama jangka waktu PT biasa." },
  { id: "P6", provision: "UU PPh Pasal 6 ayat (1) (UU 7/2021 Pasal 3 angka 2)", status: "TERVERIFIKASI_PRIMER", sourceIds: ["L5"], note: "Biaya untuk mendapatkan, menagih, dan memelihara penghasilan; huruf a dan awal huruf b terbaca." },
  { id: "P7", provision: "UU PPh Pasal 9 ayat (1)", status: "TERVERIFIKASI_SEBAGIAN", sourceIds: ["L5"], note: "Huruf a-c terbaca (dividen, kepentingan pribadi pemegang saham, dana cadangan); sisa daftar terpotong. Perlakuan nondeductible lain selalu perlu akuntan." },
  { id: "P8", provision: "UU PPh Pasal 17 ayat (1) huruf b (tarif 22%)", status: "SEKUNDER_DJP", sourceIds: ["L1", "L11"], note: "Hanya artikel pegawai DJP (11 April 2023). Naskah JDIH UU 36/2008 hanya memuat 28%/25% (usang); naskah UU 7/2021 terpotong sebelum Pasal 17.", needed: "Teks UU 7/2021 Pasal 3 angka perubahan Pasal 17 (halaman setelah Pasal 9 pada berkas JDIH/BPK), atau UU PPh terkonsolidasi." },
  { id: "P9", provision: "UU PPh Pasal 28 (kredit pajak)", status: "BLOCKED", sourceIds: ["L6", "L11"], note: "Tidak ada di naskah UU 36/2008 (hanya rujukan silang dari Pasal 29); halaman DJP tanpa tanggal.", needed: "UU PPh terkonsolidasi atau UU 7/1983 dengan Pasal 28; peraturan.bpk.go.id tidak dapat dibaca dari lingkungan ini." },
  { id: "P10", provision: "UU PPh Pasal 31E ayat (1) dan (2): teks pasal", status: "TERVERIFIKASI_SEBAGIAN", sourceIds: ["L11", "L2"], note: "Teks ayat (1) (pengurangan 50%, Pasal 17 ayat (1) huruf b dan (2a), bagian peredaran bruto Rp4,8 miliar, batas Rp50 miliar) dan ayat (2) dibaca dari naskah resmi JDIH versi UU 36/2008. Belum terbaca: Penjelasan Pasal 31E dan konfirmasi tidak diubah UU 11/2020 atau UU 7/2021 (hanya dari artikel DJP).", needed: "Penjelasan Pasal 31E dan naskah UU PPh terkonsolidasi yang menunjukkan Pasal 31E setelah UU 7/2021." },
  { id: "P11", provision: "Rumus dan contoh Pasal 31E", status: "SEKUNDER_DJP", sourceIds: ["L10", "L2"], note: "Materi tutorial resmi DJP: rumus dan contoh omzet Rp30 miliar, PKP Rp5 miliar menjadi Rp1.012.000.000. Dipakai sebagai tes." },
  { id: "P12", provision: "UU PPN Pasal 9 dan PMK pengkreditan pajak masukan", status: "SEKUNDER_DJP", sourceIds: ["L9"], note: "Halaman DJP Pajak Masukan (tanpa tanggal, contoh tahun 2010, rujukan PMK lama). PMK 81/2024 tidak terbaca (halaman JDIH tidak diizinkan dari lingkungan ini). Pengkreditan selalu perlu akuntan.", needed: "Teks UU PPN terkini Pasal 9 dan PMK 81/2024 yang terbaca." },  { id: "P13", provision: "Penjelasan PP 20/2026 Pasal II ayat (1) huruf e: contoh CV AB (terdaftar 20 Juni 2023, final sampai TP 2026)", status: "TERVERIFIKASI_PRIMER", sourceIds: ["L3", "L4"], note: "Satu-satunya contoh resmi: tahun terdaftar dihitung, 4 tahun pajak bagi CV. Dipakai untuk CV/firma saja. Tidak ada contoh untuk PT biasa, sehingga PT biasa tetap PERLU VERIFIKASI AKUNTAN." },
];

export const verificationSummary = () => ({
  checkedOn: LAW_VERIFIED_ON,
  primary: PROVISION_CHECKS.filter((p) => p.status === "TERVERIFIKASI_PRIMER").length,
  partial: PROVISION_CHECKS.filter((p) => p.status === "TERVERIFIKASI_SEBAGIAN").length,
  secondary: PROVISION_CHECKS.filter((p) => p.status === "SEKUNDER_DJP").length,
  historical: PROVISION_CHECKS.filter((p) => p.status === "HISTORIS_DIHAPUS").length,
  blocked: PROVISION_CHECKS.filter((p) => p.status === "BLOCKED").length,
});

/** Provisions without a primary text. Anything that depends on them stays unverified. */
export const BLOCKED_OR_SECONDARY = PROVISION_CHECKS.filter((p) => p.status === "BLOCKED" || p.status === "SEKUNDER_DJP" || p.status === "HISTORIS_DIHAPUS");

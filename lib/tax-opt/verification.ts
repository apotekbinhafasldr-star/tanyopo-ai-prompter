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
  | "BLOCKED"; // not retrievable

export interface ProvisionCheck {
  readonly id: string;
  readonly provision: string;
  readonly status: ProvisionStatus;
  readonly sourceIds: readonly string[];
  readonly note: string;
}

export const PROVISION_CHECKS: readonly ProvisionCheck[] = [
  { id: "P1", provision: "PP 20/2026 Pasal I angka 3-6 (Pasal 56-59 PP 55/2022 baru)", status: "TERVERIFIKASI_PRIMER", sourceIds: ["L3"], note: "Naskah resmi JDIH Kemenkeu dibaca; ayat (1)-(5) Pasal 57, Pasal 58 dan contoh Penjelasan." },
  { id: "P2", provision: "PP 20/2026 Pasal II (peralihan) huruf a-g", status: "TERVERIFIKASI_PRIMER", sourceIds: ["L3"], note: "PT selain perseroan perorangan: hanya lanjutan sampai jangka waktu PP 55/2022 berakhir. Tidak ada peralihan bagi yang terdaftar setelah 22 April 2026." },
  { id: "P3", provision: "Pembedaan perseroan perorangan (1 pemilik) dan PT biasa", status: "TERVERIFIKASI_PRIMER", sourceIds: ["L3"], note: "Perseroan perorangan subjek tanpa batas waktu (kecuali dikecualikan Pasal 57(2)); PT biasa hanya peralihan." },
  { id: "P4", provision: "PP 23/2018 Pasal 5 (jangka waktu 3/4 tahun, hitung dari tahun terdaftar atau 2018)", status: "TERVERIFIKASI_PRIMER", sourceIds: ["L4"], note: "Salinan resmi di pajak.go.id." },
  { id: "P5", provision: "PP 55/2022 Pasal 59 (jangka waktu versi 2022)", status: "BLOCKED", sourceIds: ["L4"], note: "Berkas biner, teks tidak terbaca. Tahun batas ditandai PERLU VERIFIKASI." },
  { id: "P6", provision: "UU PPh Pasal 6 ayat (1) (UU 7/2021 Pasal 3 angka 2)", status: "TERVERIFIKASI_PRIMER", sourceIds: ["L5"], note: "Biaya untuk mendapatkan, menagih, dan memelihara penghasilan; huruf a dan awal huruf b terbaca." },
  { id: "P7", provision: "UU PPh Pasal 9 ayat (1)", status: "TERVERIFIKASI_SEBAGIAN", sourceIds: ["L5"], note: "Huruf a-c terbaca (dividen, kepentingan pribadi pemegang saham, dana cadangan); sisa daftar terpotong. Perlakuan nondeductible lain selalu perlu akuntan." },
  { id: "P8", provision: "UU PPh Pasal 17 ayat (1) huruf b (tarif 22%)", status: "SEKUNDER_DJP", sourceIds: ["L1"], note: "Hanya artikel pegawai DJP (11 April 2023). Teks UU tidak terbaca." },
  { id: "P9", provision: "UU PPh Pasal 28 (kredit pajak)", status: "BLOCKED", sourceIds: ["L6"], note: "Hanya halaman DJP tanpa tanggal; teks pasal tidak terbaca." },
  { id: "P10", provision: "UU PPh Pasal 31E ayat (1): teks pasal dan Penjelasan", status: "BLOCKED", sourceIds: ["L2"], note: "PDF UU terpotong sebelum Pasal 31E." },
  { id: "P11", provision: "Rumus dan contoh Pasal 31E", status: "SEKUNDER_DJP", sourceIds: ["L10", "L2"], note: "Materi tutorial resmi DJP: rumus dan contoh omzet Rp30 miliar, PKP Rp5 miliar menjadi Rp1.012.000.000. Dipakai sebagai tes." },
  { id: "P12", provision: "UU PPN Pasal 9 dan PMK pengkreditan pajak masukan", status: "SEKUNDER_DJP", sourceIds: ["L9"], note: "Halaman DJP Pajak Masukan (tanpa tanggal, contoh tahun 2010, rujukan PMK lama). PMK 81/2024 tidak terbaca. Pengkreditan selalu perlu akuntan." },
];

export const verificationSummary = () => ({
  checkedOn: LAW_VERIFIED_ON,
  primary: PROVISION_CHECKS.filter((p) => p.status === "TERVERIFIKASI_PRIMER").length,
  partial: PROVISION_CHECKS.filter((p) => p.status === "TERVERIFIKASI_SEBAGIAN").length,
  secondary: PROVISION_CHECKS.filter((p) => p.status === "SEKUNDER_DJP").length,
  blocked: PROVISION_CHECKS.filter((p) => p.status === "BLOCKED").length,
});

/** Provisions without a primary text. Anything that depends on them stays unverified. */
export const BLOCKED_OR_SECONDARY = PROVISION_CHECKS.filter((p) => p.status === "BLOCKED" || p.status === "SEKUNDER_DJP");

/**
 * Katalog persetujuan opsional (Paket 3), cermin dari seed pada migrasi 20261127100000.
 * Satu kode = satu tujuan. Teks versi terbit TIDAK diedit: perubahan substansial = versi baru (persetujuan ulang).
 * Terms dan Privacy Notice BUKAN bagian katalog ini (bukan persetujuan PDP): lihat features/legal/legal-versions.ts.
 */
export type ConsentCode = "CONNECT_META" | "CONNECT_TIKTOK" | "CONNECT_X" | "MARKETING_COMMS" | "ANALYTICS_TELEMETRY";

export interface ConsentCatalogEntry {
  code: ConsentCode;
  version: number;
  /** Judul kartu pada layar kelola. */
  title: string;
  /** Teks persetujuan persis seperti pada katalog database (hash dihitung dari teks ini). */
  text: string;
  purpose: string;
  withdrawable: boolean;
  serverGated: boolean;
  /** false = terdaftar tetapi belum ditawarkan (fitur belum ada / koneksi dinonaktifkan). */
  active: boolean;
  /** Persetujuan koneksi platform: hanya diberikan dari alur koneksi, ditarik dengan memutus koneksi. */
  kind: "CONNECTION" | "OPTIONAL";
}

export const CONSENT_CATALOG: readonly ConsentCatalogEntry[] = [
  {
    code: "CONNECT_META",
    version: 1,
    title: "Koneksi akun Meta",
    text: "Saya setuju LINOE mengakses akun iklan dan halaman Meta yang saya hubungkan, serta data kinerja iklan yang saya izinkan di Meta, untuk menyiapkan dan menganalisis kampanye saya. Saya dapat memutus koneksi kapan saja.",
    purpose: "Koneksi Meta",
    withdrawable: true,
    serverGated: true,
    active: true,
    kind: "CONNECTION",
  },
  {
    code: "CONNECT_TIKTOK",
    version: 1,
    title: "Koneksi akun TikTok",
    text: "Saya setuju LINOE mengakses akun TikTok yang saya hubungkan dan data yang saya izinkan di TikTok untuk menyiapkan dan menganalisis kampanye saya. Saya dapat memutus koneksi kapan saja.",
    purpose: "Koneksi TikTok",
    withdrawable: true,
    serverGated: true,
    active: true,
    kind: "CONNECTION",
  },
  {
    code: "CONNECT_X",
    version: 1,
    title: "Koneksi akun X",
    text: "Saya setuju LINOE mengakses akun X yang saya hubungkan dan data yang saya izinkan di X untuk menyiapkan dan menganalisis kampanye saya. Saya dapat memutus koneksi kapan saja.",
    purpose: "Koneksi X",
    withdrawable: true,
    serverGated: true,
    active: false,
    kind: "CONNECTION",
  },
  {
    code: "MARKETING_COMMS",
    version: 1,
    title: "Email pembaruan dan penawaran",
    text: "Saya setuju menerima email dari LINOE tentang fitur baru, tips, dan penawaran. Pesan layanan seperti verifikasi dan pemberitahuan akun tetap dikirim. Saya dapat berhenti kapan saja.",
    purpose: "Email promosi",
    withdrawable: true,
    serverGated: true,
    active: false,
    kind: "OPTIONAL",
  },
  {
    code: "ANALYTICS_TELEMETRY",
    version: 1,
    title: "Data pemakaian fitur",
    text: "Saya setuju LINOE mencatat data pemakaian fitur yang terbatas dan berpengenal samaran untuk meningkatkan layanan. Isi prompt dan hasil AI tidak termasuk.",
    purpose: "Telemetri pemakaian",
    withdrawable: true,
    serverGated: true,
    active: false,
    kind: "OPTIONAL",
  },
];

export function getConsentEntry(code: string): ConsentCatalogEntry | null {
  return CONSENT_CATALOG.find((e) => e.code === code) ?? null;
}

export function listActiveConsents(): ConsentCatalogEntry[] {
  return CONSENT_CATALOG.filter((e) => e.active);
}

/** Kode persetujuan koneksi untuk sebuah platform (Meta/TikTok/X); null untuk platform lain. */
export function connectConsentCode(platform: string): ConsentCode | null {
  if (platform === "META") return "CONNECT_META";
  if (platform === "TIKTOK") return "CONNECT_TIKTOK";
  if (platform === "X") return "CONNECT_X";
  return null;
}

/** Pesan galat (spesifikasi C.4). Tidak memuat detail internal. */
export const CONSENT_MESSAGES = {
  required: "Fitur ini memerlukan persetujuan Anda. Buka Privasi & persetujuan untuk mengaturnya.",
  saveFailed: "Persetujuan belum tersimpan. Periksa koneksi internet, lalu coba lagi.",
  withdrawFailed: "Penarikan belum berhasil. Status Anda belum berubah. Coba lagi.",
  ownerOnly: "Hanya Owner yang dapat mengatur koneksi ini.",
  sessionExpired: "Sesi Anda berakhir. Masuk lagi untuk melanjutkan.",
  saved: "Persetujuan tersimpan.",
  withdrawn: "Persetujuan ditarik.",
  loadFailed: "Daftar persetujuan belum dapat dimuat. Coba muat ulang halaman.",
  disconnectedNotRecorded: "Koneksi sudah diputus, tetapi penarikan persetujuan belum tercatat. Coba lagi.",
} as const;

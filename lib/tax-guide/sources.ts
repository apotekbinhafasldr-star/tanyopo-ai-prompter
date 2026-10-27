/**
 * Official DJP sources behind the guide. Every procedural statement in steps.ts points at one of
 * these ids. Nothing is copied from memory: if a procedure is not covered here, the step says so.
 * `verifiedOn` is the day a human-readable page was last read for this guide; DJP may change Coretax
 * at any time, so the UI always tells the reader to re-check the official page.
 */
export type ReturnKind = "PPH_BADAN" | "PPN" | "LAINNYA";

export interface GuideSource {
  readonly id: string;
  readonly title: string;
  readonly publisher: "DJP";
  readonly url: string;
  /** Date shown on the official page (as printed there). */
  readonly pageDate: string;
  /** Day this guide's author read the page. */
  readonly verifiedOn: string;
  readonly supports: readonly ReturnKind[];
  readonly covers: string;
}

export const SOURCE_VERIFIED_ON = "2026-10-27";

export const GUIDE_SOURCES: readonly GuideSource[] = [
  {
    id: "S1",
    title: "Coretaxpedia: Lapor SPT Tahunan Badan",
    publisher: "DJP",
    url: "https://www.pajak.go.id/coretaxpedia/lapor-spt-tahunan-badan",
    pageDate: "Diperbarui 27 Nov 2025",
    verifiedOn: SOURCE_VERIFIED_ON,
    supports: ["PPH_BADAN", "PPN"],
    covers: "Untuk kedua jenis: login dan impersonate ke akun badan. Khusus PPh Badan: Buat Konsep SPT, formulir induk dan lampiran, Bayar dan Lapor, pembayaran, tanda tangan, status Dilaporkan.",
  },
  {
    id: "S2",
    title: "SPT Masa Coretax DJP",
    publisher: "DJP",
    url: "https://pajak.go.id/en/node/107920",
    pageDate: "Update 06/10/2025",
    verifiedOn: SOURCE_VERIFIED_ON,
    supports: ["PPN"],
    covers: "SPT Masa PPN dibuat otomatis (auto created) dan data Faktur Pajak terposting. Nama menu dan penandatanganan tidak dijelaskan di halaman ini.",
  },
  {
    id: "S3",
    title: "Meski SPT PPN Nihil, PKP Tetap Wajib Lapor",
    publisher: "DJP",
    url: "https://www.pajak.go.id/en/node/119028",
    pageDate: "19 Januari 2026",
    verifiedOn: SOURCE_VERIFIED_ON,
    supports: ["PPN"],
    covers: "PKP yang sudah dikukuhkan wajib menyampaikan SPT Masa PPN setiap bulan, termasuk nihil.",
  },
  {
    id: "S4",
    title: "SPT Badan: Lapor Sekarang atau Ajukan Perpanjangan",
    publisher: "DJP",
    url: "https://www.pajak.go.id/en/node/119763",
    pageDate: "30 April 2026",
    verifiedOn: SOURCE_VERIFIED_ON,
    supports: ["PPH_BADAN"],
    covers: "Batas lapor akhir bulan keempat setelah tahun pajak; perpanjangan dua bulan hanya untuk pelaporan, bukan pembayaran.",
  },
];

/** The official portal. The app only links to it; it never logs in, files or pays. */
export const CORETAX_PORTAL = { label: "Portal Coretax DJP", url: "https://coretaxdjp.pajak.go.id" } as const;

export const sourceById = (id: string): GuideSource | undefined => GUIDE_SOURCES.find((s) => s.id === id);

export function sourcesFor(kind: ReturnKind): GuideSource[] {
  return GUIDE_SOURCES.filter((s) => s.supports.includes(kind));
}

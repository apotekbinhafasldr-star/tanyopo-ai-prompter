import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from "@/features/legal/legal-versions";
import { formatIndonesianDate } from "@/lib/consent/view";

export interface LegalDocRow {
  key: "TERMS" | "PRIVACY_NOTICE";
  name: string;
  href: string;
  readLabel: string;
  /** Versi tertinggi yang tercatat untuk akun ini; null = belum ada catatan. */
  recordedVersion: number | null;
  recordedDate: string;
  currentVersion: number;
  /** Ada versi lebih baru di kode daripada catatan akun. */
  hasNewer: boolean;
  /** Teks status (tanpa kata "disampaikan"; Privacy = pemberitahuan, bukan persetujuan). */
  status: string;
}

interface EventRow {
  doc_code?: unknown;
  version?: unknown;
  event?: unknown;
  occurred_at?: unknown;
}

const DOCS = [
  { key: "TERMS", event: "ACCEPTED", name: "Syarat & Ketentuan", href: "/terms", readLabel: "Baca Syarat & Ketentuan", current: TERMS_VERSION },
  { key: "PRIVACY_NOTICE", event: "DELIVERED", name: "Kebijakan Privasi", href: "/privacy", readLabel: "Baca Kebijakan Privasi", current: PRIVACY_NOTICE_VERSION },
] as const;

export const NO_RECORD_TEXT = "Belum ada catatan versi untuk akun ini.";

/** Murni: baris peristiwa dokumen hukum milik pengguna -> dua baris tampilan. Baris tak dikenal atau tak valid diabaikan. */
export function buildLegalDocRows(rows: unknown, timeZone: string): LegalDocRow[] {
  const list = Array.isArray(rows) ? (rows as EventRow[]) : [];
  return DOCS.map((doc) => {
    let best: { version: number; at: string } | null = null;
    for (const r of list) {
      if (r?.doc_code !== doc.key || r.event !== doc.event) continue;
      if (typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 1) continue;
      const at = typeof r.occurred_at === "string" ? r.occurred_at : "";
      if (!best || r.version > best.version) best = { version: r.version, at };
    }
    const date = best && best.at ? formatIndonesianDate(best.at, timeZone) : "";
    let status = NO_RECORD_TEXT;
    if (best) {
      if (doc.key === "TERMS") status = date ? `Anda menyetujui versi ${best.version} pada ${date}.` : `Anda menyetujui versi ${best.version}.`;
      else status = `Pemberitahuan versi ${best.version} untuk akun Anda. Ini pemberitahuan, bukan persetujuan.`;
    }
    return {
      key: doc.key,
      name: doc.name,
      href: doc.href,
      readLabel: doc.readLabel,
      recordedVersion: best?.version ?? null,
      recordedDate: date,
      currentVersion: doc.current,
      hasNewer: best !== null && best.version < doc.current,
      status,
    };
  });
}

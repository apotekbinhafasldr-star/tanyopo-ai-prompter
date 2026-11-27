import { getConsentEntry, type ConsentCode, type ConsentCatalogEntry } from "@/lib/consent/catalog";

export type ConsentStatus = "GRANTED" | "NOT_GIVEN" | "WITHDRAWN" | "OUTDATED";

export interface ConsentItemView {
  code: ConsentCode;
  title: string;
  text: string;
  kind: ConsentCatalogEntry["kind"];
  status: ConsentStatus;
  /** Teks status (bukan warna saja), mis. "Aktif" atau "Ditarik pada 3 Desember 2026". */
  statusLabel: string;
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** Tanggal Indonesia ("3 Desember 2026") pada zona waktu pengguna; zona tidak valid memakai Asia/Jakarta. Tanpa ketergantungan locale ICU. */
export function formatIndonesianDate(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, day: "numeric", month: "numeric", year: "numeric" }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", day: "numeric", month: "numeric", year: "numeric" }).formatToParts(date);
  }
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const day = pick("day");
  const month = pick("month");
  const year = pick("year");
  if (!day || !month || !year) return "";
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function statusLabel(status: ConsentStatus, occurredAt: string | null, timeZone: string): string {
  if (status === "GRANTED") return "Aktif";
  if (status === "OUTDATED") return "Perlu persetujuan ulang";
  if (status === "WITHDRAWN") {
    const when = occurredAt ? formatIndonesianDate(occurredAt, timeZone) : "";
    return when ? `Ditarik pada ${when}` : "Ditarik";
  }
  return "Belum diberikan";
}

interface StatusRow {
  code?: unknown;
  status?: unknown;
  occurred_at?: unknown;
}

const STATUSES: readonly string[] = ["GRANTED", "NOT_GIVEN", "WITHDRAWN", "OUTDATED"];

/** Mengubah hasil fn_prompter_consent_my_status() menjadi tampilan. Kode tak dikenal atau status tak valid dibuang (tidak ditebak). */
export function buildConsentItems(rows: unknown, timeZone: string): ConsentItemView[] {
  if (!Array.isArray(rows)) return [];
  const items: ConsentItemView[] = [];
  for (const raw of rows as StatusRow[]) {
    if (typeof raw?.code !== "string" || typeof raw.status !== "string" || !STATUSES.includes(raw.status)) continue;
    const entry = getConsentEntry(raw.code);
    if (!entry || !entry.active) continue;
    const status = raw.status as ConsentStatus;
    const occurredAt = typeof raw.occurred_at === "string" ? raw.occurred_at : null;
    items.push({ code: entry.code, title: entry.title, text: entry.text, kind: entry.kind, status, statusLabel: statusLabel(status, occurredAt, timeZone) });
  }
  return items;
}

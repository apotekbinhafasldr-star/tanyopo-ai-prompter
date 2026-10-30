import type { PaymentAlertKind, PaymentAlertState } from "@/types/database";

/** Pure helpers for the B4 payment alert queue (no I/O: directly unit-testable). */

export const PAYMENT_ALERT_NOTE_MIN = 5;
export const PAYMENT_ALERT_NOTE_MAX = 1000;

/** Re-sync lazily when the last successful sync is older than this (the sync itself is idempotent + lock-guarded). */
export const PAYMENT_ALERT_STALE_AFTER_MS = 5 * 60 * 1000;

export const PAYMENT_ALERT_KIND_LABEL: Record<PaymentAlertKind, string> = {
  REVIEW: "Pembayaran perlu dicek",
  REFUND: "Refund",
  CHARGEBACK: "Chargeback",
  REVERSAL: "Pembayaran dibatalkan setelah lunas",
};

export const PAYMENT_ALERT_STATE_LABEL: Record<PaymentAlertState, string> = {
  OPEN: "Baru",
  ACKED: "Sedang dicek",
  RESOLVED: "Selesai",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export type NoteCheck = { ok: true; note: string } | { ok: false; message: string };

export function checkResolveNote(raw: unknown): NoteCheck {
  const note = typeof raw === "string" ? raw.trim() : "";
  if (note.length < PAYMENT_ALERT_NOTE_MIN) return { ok: false, message: `Catatan wajib diisi (minimal ${PAYMENT_ALERT_NOTE_MIN} karakter).` };
  if (note.length > PAYMENT_ALERT_NOTE_MAX) return { ok: false, message: `Catatan terlalu panjang (maksimal ${PAYMENT_ALERT_NOTE_MAX} karakter).` };
  return { ok: true, note };
}

export function checkOptionalNote(raw: unknown): NoteCheck {
  const note = typeof raw === "string" ? raw.trim() : "";
  if (note.length > PAYMENT_ALERT_NOTE_MAX) return { ok: false, message: `Catatan terlalu panjang (maksimal ${PAYMENT_ALERT_NOTE_MAX} karakter).` };
  return { ok: true, note };
}

/** Maps an RPC outcome code from fn_ack/resolve_payment_alert to a short Indonesian message. */
export function describeAlertActionOutcome(outcome: string): { ok: boolean; message: string } {
  switch (outcome) {
    case "ACKED":
      return { ok: true, message: "Ditandai sedang dicek." };
    case "RESOLVED":
      return { ok: true, message: "Alarm diselesaikan." };
    case "INVALID_STATE":
      return { ok: false, message: "Status alarm sudah berubah. Muat ulang halaman." };
    case "NOT_FOUND":
      return { ok: false, message: "Alarm tidak ditemukan." };
    case "NOT_OPERATOR":
      return { ok: false, message: "Akses ditolak." };
    case "NOTE_REQUIRED":
      return { ok: false, message: `Catatan wajib diisi (minimal ${PAYMENT_ALERT_NOTE_MIN} karakter).` };
    case "NOTE_TOO_LONG":
      return { ok: false, message: "Catatan terlalu panjang." };
    default:
      return { ok: false, message: "Aksi gagal. Coba lagi." };
  }
}

/** True when the sync never succeeded or the last success is too old. */
export function isSyncStale(lastSuccessAt: string | null, now: number = Date.now()): boolean {
  if (!lastSuccessAt) return true;
  const t = Date.parse(lastSuccessAt);
  return Number.isNaN(t) || now - t > PAYMENT_ALERT_STALE_AFTER_MS;
}

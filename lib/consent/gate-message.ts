import { CONSENT_MESSAGES } from "@/lib/consent/catalog";

/**
 * Pemetaan alasan penolakan gerbang persetujuan ke pesan pengguna (satu sumber teks, Paket 5a).
 *
 *  - G1  : Owner ditolak karena persetujuan belum ada / ditarik / versi lama.
 *  - G1n : bukan Owner (persetujuan koneksi diberikan Owner, bukan pemanggil).
 *  - G2  : pemeriksaan sendiri gagal (galat, timeout, tanpa klien) atau kode tidak dikenal/tidak aktif. Tidak menyuruh pengguna memberi persetujuan.
 *
 * Tipe alasan didefinisikan di sini (bukan diimpor dari require-consent) agar tidak ada impor melingkar.
 */
export type GateDenyReason =
  | "UNKNOWN_CODE"
  | "INACTIVE_CODE"
  | "NO_RECORD"
  | "WITHDRAWN"
  | "VERSION_OUTDATED"
  | "NOT_IN_TENANT"
  | "GRANTOR_NOT_OWNER"
  | "NOT_TENANT_CODE"
  | "CHECK_FAILED"
  | "NO_CLIENT";

export type GateKind = "G1" | "G1n" | "G2";

const CHECK_FAILURE: readonly GateDenyReason[] = ["CHECK_FAILED", "NO_CLIENT", "UNKNOWN_CODE", "INACTIVE_CODE"];

export function gateKind(reason: GateDenyReason, isOwner: boolean): GateKind {
  if (CHECK_FAILURE.includes(reason)) return "G2";
  return isOwner ? "G1" : "G1n";
}

export function gateMessage(reason: GateDenyReason, isOwner: boolean): string {
  const kind = gateKind(reason, isOwner);
  if (kind === "G2") return CONSENT_MESSAGES.gateUnavailable;
  if (kind === "G1n") return CONSENT_MESSAGES.gateOwnerMissing;
  return CONSENT_MESSAGES.required;
}

/** Alasan penolakan pada rute authorize -> kode galat di URL /connections. */
export function authorizeErrorCode(reason: GateDenyReason): "consent_required" | "consent_check_failed" {
  return gateKind(reason, true) === "G2" ? "consent_check_failed" : "consent_required";
}

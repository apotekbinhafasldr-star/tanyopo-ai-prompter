import { getConsentEntry, type ConsentCode } from "@/lib/consent/catalog";
import { isConsentEnforcementEnabled } from "@/lib/consent/flags";
import { gateMessage } from "@/lib/consent/gate-message";
import type { ConsentRpcClient } from "@/lib/consent/rpc";

export type ConsentDenyReason =
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

export type ConsentDecision =
  | { allowed: true; reason: "ENFORCEMENT_OFF" | "NOT_GATED" | "GRANTED" }
  | { allowed: false; reason: ConsentDenyReason };

export interface RequireConsentDeps {
  /** Default: flag server CONSENT_ENFORCEMENT_ENABLED === "true". */
  isEnabled?: () => boolean;
  /** Default: klien service_role (dimuat malas, hanya bila enforcement ON). null = tidak tersedia. */
  getClient?: () => Promise<ConsentRpcClient | null>;
  timeoutMs?: number;
  /** Hanya untuk pemilihan teks pesan (G1 vs G1n). Default true. Bukan pemeriksaan hak akses. */
  isOwner?: boolean;
}

const DEFAULT_TIMEOUT_MS = 3000;
const DENY_REASONS: readonly ConsentDenyReason[] = [
  "NO_RECORD",
  "WITHDRAWN",
  "VERSION_OUTDATED",
  "INACTIVE_CODE",
  "UNKNOWN_CODE",
  "NOT_IN_TENANT",
  "GRANTOR_NOT_OWNER",
  "NOT_TENANT_CODE",
];

async function defaultGetClient(): Promise<ConsentRpcClient | null> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as ConsentRpcClient | null;
}

/**
 * Pemeriksaan persetujuan di sisi server untuk pemrosesan OPSIONAL.
 *
 *  - Kode koneksi (CONNECT_*): persetujuan adalah milik TENANT dan harus diberikan oleh Owner tenant itu (keputusan Founder Opsi A). Pemeriksaan
 *    memakai tenantId sesi (fn_prompter_consent_check_tenant): persetujuan Owner tenant lain tidak berlaku; tanpa tenantId = ditolak (fail-closed).
 *    Persetujuan Owner TIDAK otomatis mewakili semua subjek data dan bukan dasar hukum untuk semua pemrosesan.
 *
 *  - Enforcement MATI (default): langsung allowed, tanpa menyentuh database, tanpa memuat modul lain. Perilaku identik dengan sebelum Paket 3.
 *  - Enforcement HIDUP: fail-CLOSED. Tanpa persetujuan aktif untuk versi katalog terbaru, atau bila pemeriksaan gagal/timeout/tanpa klien,
 *    hasilnya ditolak. Koneksi lama tanpa catatan (NO_RECORD) TIDAK dianggap setuju.
 *  - Fungsi inti (login, daftar, billing, dasbor) tidak boleh memanggil ini: tidak pernah diblokir karena persetujuan.
 */
export async function requireConsent(code: ConsentCode, userId: string, tenantId: string | null, deps: RequireConsentDeps = {}): Promise<ConsentDecision> {
  const enabled = (deps.isEnabled ?? isConsentEnforcementEnabled)();
  if (!enabled) return { allowed: true, reason: "ENFORCEMENT_OFF" };

  const entry = getConsentEntry(code);
  if (!entry) return { allowed: false, reason: "UNKNOWN_CODE" };
  if (!entry.serverGated) return { allowed: true, reason: "NOT_GATED" };
  if (!entry.active) return { allowed: false, reason: "INACTIVE_CODE" };
  if (!userId) return { allowed: false, reason: "CHECK_FAILED" };
  const tenantScoped = entry.kind === "CONNECTION";
  if (tenantScoped && !tenantId) return { allowed: false, reason: "CHECK_FAILED" };

  try {
    const client = await (deps.getClient ?? defaultGetClient)();
    if (!client) return { allowed: false, reason: "NO_CLIENT" };
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"TIMEOUT">((resolve) => {
      timer = setTimeout(() => resolve("TIMEOUT"), timeoutMs);
    });
    const call = tenantScoped
      ? client.rpc("fn_prompter_consent_check_tenant", { p_user_id: userId, p_code: code, p_tenant_id: tenantId })
      : client.rpc("fn_prompter_consent_check", { p_user_id: userId, p_code: code });
    const result = await Promise.race([Promise.resolve(call), timeout]);
    if (timer) clearTimeout(timer);
    if (result === "TIMEOUT" || result.error) return { allowed: false, reason: "CHECK_FAILED" };
    const data = result.data as { consented?: unknown; reason?: unknown } | null;
    if (data && data.consented === true) return { allowed: true, reason: "GRANTED" };
    const reason = typeof data?.reason === "string" && (DENY_REASONS as readonly string[]).includes(data.reason) ? (data.reason as ConsentDenyReason) : "CHECK_FAILED";
    return { allowed: false, reason };
  } catch {
    return { allowed: false, reason: "CHECK_FAILED" };
  }
}

/** Pesan galat untuk pengguna bila ditolak; null bila boleh lanjut. Tanpa detail internal. */
export async function consentGateMessage(code: ConsentCode, userId: string, tenantId: string | null, deps: RequireConsentDeps = {}): Promise<string | null> {
  const decision = await requireConsent(code, userId, tenantId, deps);
  return decision.allowed ? null : gateMessage(decision.reason, deps.isOwner ?? true);
}

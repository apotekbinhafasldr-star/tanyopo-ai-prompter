import type { MetaReadinessResult } from "@/lib/connectors/meta-readiness";
import { formatCurrency } from "@/lib/utils/format";

/**
 * Launch-readiness checklist for a Meta campaign (read-only display).
 *
 * PURE: no network, database, environment or clock of its own (`now` is an
 * argument). It decides from data it is GIVEN and never opens, changes or
 * triggers anything. It does NOT replace the checks the launch action runs on
 * its own (features/campaigns/launch-actions.ts still decides, unchanged);
 * it only shows the Owner, ahead of time and honestly, where each of those
 * prerequisites stands.
 *
 * Fail-closed rules, shared by every item:
 *  - PASS needs positive evidence. A value that could not be read is UNKNOWN,
 *    never PASS, and an item never guesses a default.
 *  - The overall result is READY only when EVERY item is PASS. Any FAIL or
 *    UNKNOWN (including an unreadable source) means NOT_READY ("belum siap").
 *  - READY is an internal-checklist statement. It never promises that an ad
 *    will be delivered, approved by Meta, or perform in any way.
 */

/** A value read from a source that may have failed. `ok: false` = could not be read. */
export type Read<T> = { ok: true; value: T } | { ok: false };

export type LaunchReadinessItemId =
  | "META_CONNECTION"
  | "AD_ACCOUNT_CONFIRMED"
  | "TOKEN_VALID"
  | "BUDGET_SET"
  | "APPROVAL_THRESHOLD"
  | "OWNER_APPROVAL"
  | "S1_GATE"
  | "EMERGENCY_STOP"
  | "META_ACCOUNT_READINESS";

export type LaunchReadinessStatus = "PASS" | "FAIL" | "UNKNOWN";

export interface LaunchReadinessItem {
  id: LaunchReadinessItemId;
  label: string;
  status: LaunchReadinessStatus;
  /** Indonesian, user-facing; never carries a token, an account id or provider text. */
  detail: string;
}

export type LaunchReadinessOverall = "READY" | "NOT_READY";

export interface LaunchReadinessResult {
  overall: LaunchReadinessOverall;
  items: LaunchReadinessItem[];
  passCount: number;
  failCount: number;
  unknownCount: number;
  /** One short Indonesian sentence for the headline. */
  summary: string;
}

export interface LaunchReadinessConnection {
  /** Stored connection status (CONNECTED / EXPIRED / ACTION_REQUIRED / DISCONNECTED). */
  status: string;
  /** ISO timestamp or null when no expiry is stored. */
  expiresAt: string | null;
  /** Whether an ad account id is stored on the connection. */
  hasAdAccount: boolean;
}

export interface LaunchReadinessInput {
  now: Date;
  /** The tenant's META connection; `value: null` = no connection row. */
  connection: Read<LaunchReadinessConnection | null>;
  /** Has an Owner confirmed the stored ad account since the latest (re)connect? */
  adAccountConfirmed: Read<boolean>;
  dailyBudget: number | null | undefined;
  currency: string | null | undefined;
  /** Budget policy; `value: null` = tenant has no policy row (no threshold set). */
  approvalPolicy: Read<{ requireApprovalAbove: number | null; currency: string } | null>;
  /** CAMPAIGN_LAUNCH approvals of this master campaign. */
  launchApprovals: Read<readonly { status: string; created_at: string }[]>;
  /** Whether META is in the S1 allowlist (BUDGET_WRITE_ENABLED_PLATFORMS). `null` = unknown. */
  budgetWriteEnabled: boolean | null;
  /** `null` = the Emergency Stop flag could not be read. */
  emergencyStopActive: boolean | null;
  /**
   * A readiness result already obtained from Meta's read-only check, or `null`
   * when none is available. This module never triggers that check.
   */
  metaReadiness: MetaReadinessResult | null;
}

const LABELS: Record<LaunchReadinessItemId, string> = {
  META_CONNECTION: "Koneksi akun Meta",
  AD_ACCOUNT_CONFIRMED: "Akun iklan dikonfirmasi Owner",
  TOKEN_VALID: "Akses (token) Meta",
  BUDGET_SET: "Budget harian",
  APPROVAL_THRESHOLD: "Ambang persetujuan budget",
  OWNER_APPROVAL: "Persetujuan Owner",
  S1_GATE: "Gerbang keamanan budget (S1)",
  EMERGENCY_STOP: "Emergency Stop",
  META_ACCOUNT_READINESS: "Kesiapan akun iklan di Meta",
};

function item(id: LaunchReadinessItemId, status: LaunchReadinessStatus, detail: string): LaunchReadinessItem {
  return { id, label: LABELS[id], status, detail };
}

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

const SOURCE_UNREADABLE = "Data tidak dapat dibaca saat ini, jadi belum bisa dipastikan.";

// ---------------------------------------------------------------------------
// Individual items (exported for focused tests)
// ---------------------------------------------------------------------------

export function evaluateConnection(read: LaunchReadinessInput["connection"]): LaunchReadinessItem {
  if (!read.ok) return item("META_CONNECTION", "UNKNOWN", SOURCE_UNREADABLE);
  const conn = read.value;
  if (conn === null) {
    return item("META_CONNECTION", "FAIL", "Akun Meta belum terhubung. Hubungkan di halaman Connections.");
  }
  if (conn.status === "CONNECTED") {
    return item("META_CONNECTION", "PASS", "Akun Meta terhubung.");
  }
  if (conn.status === "EXPIRED" || conn.status === "ACTION_REQUIRED" || conn.status === "DISCONNECTED") {
    return item("META_CONNECTION", "FAIL", "Koneksi Meta tidak aktif. Sambungkan ulang di halaman Connections.");
  }
  return item("META_CONNECTION", "UNKNOWN", "Status koneksi Meta tidak dikenali, jadi belum bisa dipastikan.");
}

export function evaluateAdAccountConfirmed(input: Pick<LaunchReadinessInput, "connection" | "adAccountConfirmed">): LaunchReadinessItem {
  const { connection, adAccountConfirmed } = input;
  if (!connection.ok) return item("AD_ACCOUNT_CONFIRMED", "UNKNOWN", SOURCE_UNREADABLE);
  if (connection.value === null || connection.value.status !== "CONNECTED") {
    return item("AD_ACCOUNT_CONFIRMED", "FAIL", "Belum ada koneksi Meta yang aktif, jadi akun iklan belum bisa dikonfirmasi.");
  }
  if (!connection.value.hasAdAccount) {
    return item("AD_ACCOUNT_CONFIRMED", "FAIL", "Belum ada akun iklan tersimpan. Pilih dan konfirmasi akun iklan di halaman Connections.");
  }
  if (!adAccountConfirmed.ok) return item("AD_ACCOUNT_CONFIRMED", "UNKNOWN", SOURCE_UNREADABLE);
  if (adAccountConfirmed.value === true) {
    return item("AD_ACCOUNT_CONFIRMED", "PASS", "Owner sudah mengonfirmasi akun iklan yang dipakai.");
  }
  return item("AD_ACCOUNT_CONFIRMED", "FAIL", "Akun iklan belum dikonfirmasi Owner. Pilih dan konfirmasi di halaman Connections.");
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function evaluateToken(connection: LaunchReadinessInput["connection"], now: Date): LaunchReadinessItem {
  if (!connection.ok) return item("TOKEN_VALID", "UNKNOWN", SOURCE_UNREADABLE);
  const conn = connection.value;
  if (conn === null) return item("TOKEN_VALID", "FAIL", "Belum ada koneksi Meta, jadi belum ada akses yang bisa diperiksa.");
  if (conn.status === "EXPIRED") {
    return item("TOKEN_VALID", "FAIL", "Akses Meta sudah kedaluwarsa. Sambungkan ulang di halaman Connections.");
  }
  if (conn.expiresAt === null) {
    return item("TOKEN_VALID", "UNKNOWN", "Tanggal kedaluwarsa akses Meta tidak tercatat, jadi belum bisa dipastikan masih berlaku.");
  }
  const expires = Date.parse(conn.expiresAt);
  if (Number.isNaN(expires) || Number.isNaN(now.getTime())) {
    return item("TOKEN_VALID", "UNKNOWN", "Tanggal kedaluwarsa akses Meta tidak terbaca, jadi belum bisa dipastikan.");
  }
  if (expires <= now.getTime()) {
    return item("TOKEN_VALID", "FAIL", "Akses Meta sudah kedaluwarsa. Sambungkan ulang di halaman Connections.");
  }
  const daysLeft = Math.ceil((expires - now.getTime()) / DAY_MS);
  if (daysLeft <= 7) {
    return item("TOKEN_VALID", "PASS", `Akses Meta masih berlaku, tetapi berakhir dalam sekitar ${daysLeft} hari. Sebaiknya sambungkan ulang lebih awal.`);
  }
  return item("TOKEN_VALID", "PASS", "Akses Meta belum kedaluwarsa.");
}

export function evaluateBudget(dailyBudget: unknown, currency: unknown): LaunchReadinessItem {
  if (typeof currency !== "string" || currency.length === 0) {
    return item("BUDGET_SET", "UNKNOWN", "Mata uang campaign tidak terbaca, jadi budget belum bisa dinilai.");
  }
  if (dailyBudget === null || dailyBudget === undefined) {
    return item("BUDGET_SET", "FAIL", "Budget harian belum diisi. Peluncuran Meta memakai budget harian.");
  }
  if (typeof dailyBudget !== "number" || !Number.isFinite(dailyBudget)) {
    return item("BUDGET_SET", "UNKNOWN", "Nilai budget harian tidak terbaca dengan benar, jadi belum bisa dipastikan.");
  }
  if (!isPositiveSafeInteger(dailyBudget)) {
    return item("BUDGET_SET", "FAIL", "Budget harian harus berupa bilangan bulat minimal 1.");
  }
  if (currency !== "IDR") {
    return item("BUDGET_SET", "FAIL", `Mata uang campaign adalah ${currency}. LINOE saat ini hanya mendukung budget dalam IDR.`);
  }
  return item("BUDGET_SET", "PASS", `Budget harian terisi: ${formatCurrency(dailyBudget, "IDR")}.`);
}

/** Latest approval by created_at. `null` + `invalid` when no timestamp can be ordered. */
function latestApproval(
  rows: readonly { status: string; created_at: string }[],
): { kind: "NONE" } | { kind: "INVALID" } | { kind: "LATEST"; status: string } {
  if (rows.length === 0) return { kind: "NONE" };
  let best: { status: string; time: number } | null = null;
  for (const row of rows) {
    const time = Date.parse(row.created_at);
    if (Number.isNaN(time)) return { kind: "INVALID" };
    if (best === null || time > best.time) best = { status: row.status, time };
  }
  return best ? { kind: "LATEST", status: best.status } : { kind: "NONE" };
}

export function evaluateOwnerApproval(read: LaunchReadinessInput["launchApprovals"]): LaunchReadinessItem {
  if (!read.ok) return item("OWNER_APPROVAL", "UNKNOWN", SOURCE_UNREADABLE);
  const latest = latestApproval(read.value);
  if (latest.kind === "INVALID") {
    return item("OWNER_APPROVAL", "UNKNOWN", "Waktu pengajuan persetujuan tidak terbaca, jadi belum bisa dipastikan.");
  }
  if (latest.kind === "NONE") {
    return item("OWNER_APPROVAL", "FAIL", "Belum ada persetujuan peluncuran. Ajukan campaign untuk disetujui Owner.");
  }
  if (latest.status === "APPROVED") {
    return item("OWNER_APPROVAL", "PASS", "Persetujuan peluncuran terbaru berstatus Disetujui.");
  }
  if (latest.status === "PENDING") {
    return item("OWNER_APPROVAL", "FAIL", "Persetujuan peluncuran masih menunggu keputusan Owner di Approval Center.");
  }
  if (latest.status === "REJECTED") {
    return item("OWNER_APPROVAL", "FAIL", "Persetujuan peluncuran terbaru ditolak. Ajukan ulang setelah campaign diperbaiki.");
  }
  if (latest.status === "EXPIRED") {
    return item("OWNER_APPROVAL", "FAIL", "Persetujuan peluncuran sudah kedaluwarsa. Ajukan ulang.");
  }
  return item("OWNER_APPROVAL", "UNKNOWN", "Status persetujuan tidak dikenali, jadi belum bisa dipastikan.");
}

export function evaluateApprovalThreshold(input: Pick<LaunchReadinessInput, "approvalPolicy" | "launchApprovals" | "dailyBudget" | "currency">): LaunchReadinessItem {
  const { approvalPolicy, launchApprovals, dailyBudget, currency } = input;
  if (!approvalPolicy.ok) return item("APPROVAL_THRESHOLD", "UNKNOWN", SOURCE_UNREADABLE);
  const policy = approvalPolicy.value;
  const threshold = policy?.requireApprovalAbove ?? null;
  if (threshold === null) {
    return item(
      "APPROVAL_THRESHOLD",
      "PASS",
      "Tidak ada ambang khusus yang diatur. Persetujuan Owner tetap diperlukan untuk setiap peluncuran.",
    );
  }
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0) {
    return item("APPROVAL_THRESHOLD", "UNKNOWN", "Nilai ambang persetujuan tidak terbaca dengan benar, jadi belum bisa dipastikan.");
  }
  if (!isPositiveSafeInteger(dailyBudget)) {
    return item("APPROVAL_THRESHOLD", "UNKNOWN", "Budget harian belum valid, jadi belum bisa dibandingkan dengan ambang.");
  }
  if (typeof currency !== "string" || currency.length === 0 || policy === null || policy.currency !== currency) {
    return item("APPROVAL_THRESHOLD", "UNKNOWN", "Mata uang ambang berbeda atau tidak terbaca, jadi budget tidak dibandingkan.");
  }
  if (dailyBudget <= threshold) {
    return item(
      "APPROVAL_THRESHOLD",
      "PASS",
      `Budget harian tidak melebihi ambang persetujuan (${formatCurrency(threshold, currency)}).`,
    );
  }
  // Above the threshold: an Owner approval is mandatory, so this item follows it.
  const approval = evaluateOwnerApproval(launchApprovals);
  const over = `Budget harian melebihi ambang persetujuan (${formatCurrency(threshold, currency)})`;
  if (approval.status === "PASS") {
    return item("APPROVAL_THRESHOLD", "PASS", `${over} dan persetujuan Owner sudah ada. Nilai yang disetujui diperiksa lagi saat peluncuran.`);
  }
  if (approval.status === "FAIL") {
    return item("APPROVAL_THRESHOLD", "FAIL", `${over}. Perlu persetujuan Owner sebelum bisa diluncurkan.`);
  }
  return item("APPROVAL_THRESHOLD", "UNKNOWN", `${over}, tetapi status persetujuan belum bisa dipastikan.`);
}

export function evaluateS1Gate(budgetWriteEnabled: boolean | null): LaunchReadinessItem {
  if (budgetWriteEnabled === true) {
    return item(
      "S1_GATE",
      "PASS",
      "Terbuka untuk Meta. Verifikasi mata uang akun dan satuan budget tetap dijalankan saat peluncuran.",
    );
  }
  if (budgetWriteEnabled === false) {
    return item(
      "S1_GATE",
      "FAIL",
      "Terkunci. Pengiriman budget ke Meta dinonaktifkan sementara demi keamanan, jadi campaign belum bisa diluncurkan ke Meta.",
    );
  }
  return item("S1_GATE", "UNKNOWN", "Status gerbang keamanan budget tidak terbaca. Dianggap terkunci.");
}

export function evaluateEmergencyStop(active: boolean | null): LaunchReadinessItem {
  if (active === false) return item("EMERGENCY_STOP", "PASS", "Emergency Stop tidak aktif.");
  if (active === true) {
    return item("EMERGENCY_STOP", "FAIL", "Emergency Stop aktif. Semua pengiriman budget ke platform iklan diblokir.");
  }
  return item("EMERGENCY_STOP", "UNKNOWN", "Status Emergency Stop tidak dapat diverifikasi. Dianggap aktif.");
}

export function evaluateMetaAccountReadiness(result: MetaReadinessResult | null): LaunchReadinessItem {
  if (result === null) {
    return item(
      "META_ACCOUNT_READINESS",
      "UNKNOWN",
      "Belum diperiksa. Halaman ini tidak menghubungi Meta. Jalankan “Periksa kesiapan” di halaman Connections.",
    );
  }
  if (result.state === "READY") {
    return item("META_ACCOUNT_READINESS", "PASS", "Pemeriksaan baca-saja Meta: akun iklan aktif, mata uang IDR, metode pembayaran terdeteksi.");
  }
  if (result.state === "NOT_READY") {
    return item("META_ACCOUNT_READINESS", "FAIL", "Pemeriksaan Meta menemukan hal yang perlu diperbaiki. Lihat detailnya di halaman Connections.");
  }
  return item("META_ACCOUNT_READINESS", "UNKNOWN", "Pemeriksaan Meta belum bisa memastikan kesiapan akun iklan. Lihat detailnya di halaman Connections.");
}

// ---------------------------------------------------------------------------
// Whole checklist
// ---------------------------------------------------------------------------

export const READY_SUMMARY =
  "Semua pemeriksaan internal lulus. Ini bukan jaminan iklan disetujui Meta, tayang, atau menghasilkan hasil tertentu.";

export function evaluateLaunchReadiness(input: LaunchReadinessInput): LaunchReadinessResult {
  const items: LaunchReadinessItem[] = [
    evaluateConnection(input.connection),
    evaluateAdAccountConfirmed(input),
    evaluateToken(input.connection, input.now),
    evaluateBudget(input.dailyBudget, input.currency),
    evaluateApprovalThreshold(input),
    evaluateOwnerApproval(input.launchApprovals),
    evaluateS1Gate(input.budgetWriteEnabled),
    evaluateEmergencyStop(input.emergencyStopActive),
    evaluateMetaAccountReadiness(input.metaReadiness),
  ];
  const passCount = items.filter((i) => i.status === "PASS").length;
  const failCount = items.filter((i) => i.status === "FAIL").length;
  const unknownCount = items.filter((i) => i.status === "UNKNOWN").length;
  // READY only when every item has positive evidence; an empty list can never be READY.
  const ready = items.length > 0 && passCount === items.length;

  let summary: string;
  if (ready) {
    summary = READY_SUMMARY;
  } else if (failCount > 0) {
    summary = `Belum siap: ${failCount} hal perlu diperbaiki${unknownCount > 0 ? ` dan ${unknownCount} hal belum bisa dipastikan` : ""}.`;
  } else {
    summary = `Belum siap: ${unknownCount} hal belum bisa dipastikan dari data yang terbaca.`;
  }

  return {
    overall: ready ? "READY" : "NOT_READY",
    items,
    passCount,
    failCount,
    unknownCount,
    summary,
  };
}

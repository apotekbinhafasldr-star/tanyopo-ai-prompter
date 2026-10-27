/**
 * Meta ad-account READINESS evaluation (Phase F-2a). Pure logic only: no
 * network, no database, no environment, no "server-only" — so it is directly
 * unit-testable and its result type can be imported by the Connections UI.
 *
 * What "readiness" means here, and what it does NOT mean:
 *  - It answers "does the connected Meta ad account look able to deliver ads
 *    and be billed in IDR?" from a handful of read-only Marketing API fields.
 *  - It never opens the External Budget Safety Gate, never creates or
 *    activates anything, and never proves that money is available. Meta
 *    decides delivery and charges; LINOE does not hold or move ad budgets.
 *
 * The one rule that shapes every function below: READY requires positive
 * evidence for EVERY check. A missing, unreadable or unrecognised value is
 * UNKNOWN, never READY — and never silently NOT_READY either, because "we could
 * not read it" is not the same claim as "Meta says it is not set up".
 */

export type ReadinessState = "READY" | "NOT_READY" | "UNKNOWN";

export type ReadinessCheckId = "ACCOUNT_STATUS" | "CURRENCY" | "PAYMENT_METHOD" | "PREPAID";

export type ReadinessCheckStatus = "PASS" | "FAIL" | "UNKNOWN";

export interface ReadinessCheck {
  id: ReadinessCheckId;
  label: string;
  status: ReadinessCheckStatus;
  /** Indonesian, user-facing, free of provider text and identifiers. */
  detail: string;
}

/**
 * Normalised facts about ONE ad account. `null` always means "not provided or
 * not readable" and is never interpreted as a negative answer.
 */
export interface MetaAdAccountSnapshot {
  /** Marketing API `account_status` (numeric code). */
  accountStatus: number | null;
  /** ISO 4217 code from `currency`, already validated as three capital letters. */
  currency: string | null;
  /** `is_prepay_account`. */
  isPrepayAccount: boolean | null;
  /**
   * Whether a `funding_source` was returned. `true` is positive evidence.
   * `null` covers both "no payment method" and "field not readable": the API
   * omits the field in both cases, so absence proves nothing either way.
   * The funding source's ID itself is never carried past the connector.
   */
  hasFundingSource: boolean | null;
  /** `min_daily_budget` exactly as Meta returned it (currency minor units, unconverted). Optional. */
  minDailyBudgetRaw: number | null;
}

/** Why a check could not produce a snapshot at all. Every one of these is UNKNOWN. */
export type ReadinessUnavailableReason =
  | "NOT_CONFIGURED"
  | "NOT_CONNECTED"
  | "TOKEN_EXPIRED"
  | "PERMISSION_MISSING"
  | "FIELD_UNAVAILABLE"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "CREDENTIALS_UNAVAILABLE"
  | "NO_AD_ACCOUNT"
  | "MULTIPLE_AD_ACCOUNTS"
  | "AD_ACCOUNT_MISMATCH";

export interface MetaReadinessResult {
  state: ReadinessState;
  /** One short Indonesian sentence for the headline. */
  summary: string;
  checks: ReadinessCheck[];
  /** Present only when the check could not run at all. */
  unavailableReason: ReadinessUnavailableReason | null;
  /** Informational only; never affects `state`. Unconverted, in currency minor units. */
  minDailyBudgetRaw: number | null;
  /** ISO timestamp of this check. */
  checkedAt: string;
}

const LABELS: Record<ReadinessCheckId, string> = {
  ACCOUNT_STATUS: "Status akun iklan",
  CURRENCY: "Mata uang",
  PAYMENT_METHOD: "Metode pembayaran",
  PREPAID: "Jenis akun (prabayar/pascabayar)",
};

/**
 * Account-status codes with a documented meaning in Meta's AdAccount reference
 * (https://developers.facebook.com/docs/marketing-api/reference/ad-account).
 * Any other number is treated as UNKNOWN on purpose: guessing a meaning for a
 * code we have not verified could mislabel an account in either direction.
 */
const STATUS_ACTIVE = 1;
const STATUS_NOT_ACTIVE_MESSAGES: Readonly<Record<number, string>> = Object.freeze({
  2: "Akun iklan dinonaktifkan oleh Meta. Periksa penyebabnya di Meta Ads Manager.",
  3: "Akun iklan memiliki tagihan yang belum terselesaikan (unsettled). Selesaikan pembayaran di Meta Ads Manager.",
  7: "Akun iklan sedang menunggu tinjauan risiko dari Meta. Tunggu hasilnya di Meta Ads Manager.",
  8: "Pembayaran akun iklan sedang diproses (pending settlement). Tunggu hingga selesai di Meta Ads Manager.",
  9: "Akun iklan berada dalam masa tenggang pembayaran (grace period). Selesaikan pembayaran di Meta Ads Manager.",
});

function check(id: ReadinessCheckId, status: ReadinessCheckStatus, detail: string): ReadinessCheck {
  return { id, label: LABELS[id], status, detail };
}

function evaluateAccountStatus(value: number | null): ReadinessCheck {
  if (value === null || !Number.isInteger(value)) {
    return check("ACCOUNT_STATUS", "UNKNOWN", "Status akun iklan tidak terbaca dari Meta.");
  }
  if (value === STATUS_ACTIVE) {
    return check("ACCOUNT_STATUS", "PASS", "Akun iklan aktif.");
  }
  const message = STATUS_NOT_ACTIVE_MESSAGES[value];
  if (message) return check("ACCOUNT_STATUS", "FAIL", message);
  return check(
    "ACCOUNT_STATUS",
    "UNKNOWN",
    "Meta mengembalikan status akun yang belum dikenali LINOE. Periksa statusnya di Meta Ads Manager.",
  );
}

function evaluateCurrency(value: string | null): ReadinessCheck {
  if (value === null || !/^[A-Z]{3}$/.test(value)) {
    return check("CURRENCY", "UNKNOWN", "Mata uang akun iklan tidak terbaca dari Meta.");
  }
  if (value === "IDR") {
    return check("CURRENCY", "PASS", "Mata uang akun iklan adalah IDR.");
  }
  return check(
    "CURRENCY",
    "FAIL",
    `Mata uang akun iklan adalah ${value}. LINOE saat ini hanya mendukung akun iklan bermata uang IDR.`,
  );
}

function evaluatePaymentMethod(value: boolean | null): ReadinessCheck {
  if (value === true) {
    return check("PAYMENT_METHOD", "PASS", "Meta melaporkan adanya metode pembayaran pada akun iklan.");
  }
  // Absent from the API response = not proven. It can mean "no payment method"
  // OR "this token may not read it", and the API does not say which.
  return check(
    "PAYMENT_METHOD",
    "UNKNOWN",
    "Metode pembayaran tidak terdeteksi. Bisa jadi belum ditambahkan, atau izin akun tidak cukup untuk membacanya. Periksa di Meta Ads Manager (Pengaturan Pembayaran).",
  );
}

function evaluatePrepaid(value: boolean | null): ReadinessCheck {
  if (value === null) {
    return check("PREPAID", "UNKNOWN", "Jenis akun (prabayar/pascabayar) tidak terbaca dari Meta.");
  }
  if (value === false) {
    return check("PREPAID", "PASS", "Akun iklan pascabayar: Meta menagih sesuai pemakaian pada metode pembayaran.");
  }
  return check(
    "PREPAID",
    "UNKNOWN",
    "Akun iklan prabayar. LINOE tidak membaca saldo, jadi belum bisa memastikan dana cukup. Pastikan saldo tersedia di Meta Ads Manager.",
  );
}

/** Safe integer >= 0, else null. Never throws. */
function sanitizeMinDailyBudget(value: number | null): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

const SUMMARY: Record<ReadinessState, string> = {
  READY: "Siap: akun iklan aktif, mata uang IDR, dan metode pembayaran terdeteksi.",
  NOT_READY: "Belum siap: ada hal yang perlu diperbaiki di akun iklan Meta Anda.",
  UNKNOWN: "Belum bisa dipastikan: LINOE tidak dapat memastikan akun iklan siap dari data yang terbaca.",
};

/**
 * Combines the individual checks. Any FAIL is NOT_READY (a definite problem
 * outweighs an unknown). Otherwise any UNKNOWN is UNKNOWN. READY only when
 * every check passed — an empty list is therefore never READY.
 */
export function combineChecks(checks: readonly ReadinessCheck[]): ReadinessState {
  if (checks.length === 0) return "UNKNOWN";
  if (checks.some((c) => c.status === "FAIL")) return "NOT_READY";
  if (checks.every((c) => c.status === "PASS")) return "READY";
  return "UNKNOWN";
}

export function evaluateMetaReadiness(snapshot: MetaAdAccountSnapshot, now: Date): MetaReadinessResult {
  const checks: ReadinessCheck[] = [
    evaluateAccountStatus(snapshot.accountStatus),
    evaluateCurrency(snapshot.currency),
    evaluatePaymentMethod(snapshot.hasFundingSource),
    evaluatePrepaid(snapshot.isPrepayAccount),
  ];
  const state = combineChecks(checks);
  return {
    state,
    summary: SUMMARY[state],
    checks,
    unavailableReason: null,
    minDailyBudgetRaw: sanitizeMinDailyBudget(snapshot.minDailyBudgetRaw),
    checkedAt: now.toISOString(),
  };
}

const UNAVAILABLE_MESSAGES: Readonly<Record<ReadinessUnavailableReason, string>> = Object.freeze({
  NOT_CONFIGURED: "Koneksi Meta belum dikonfigurasi di server, sehingga akun iklan tidak dapat diperiksa.",
  NOT_CONNECTED: "Akun Meta belum terhubung. Hubungkan akun terlebih dahulu.",
  TOKEN_EXPIRED: "Akses ke Meta sudah kedaluwarsa atau dicabut. Klik “Sambungkan Ulang” lalu periksa lagi.",
  PERMISSION_MISSING:
    "Meta menolak pembacaan data akun iklan karena izin belum cukup. Sambungkan ulang dan setujui izin iklan, atau pastikan peran Anda pada akun iklan memadai.",
  FIELD_UNAVAILABLE:
    "Meta tidak menyediakan sebagian data akun iklan untuk koneksi ini. Pemeriksaan tidak dapat dilanjutkan.",
  RATE_LIMITED: "Meta sedang membatasi permintaan. Coba lagi beberapa menit lagi.",
  PROVIDER_ERROR: "Meta tidak merespons dengan benar. Coba lagi nanti; jika berulang, hubungi admin.",
  CREDENTIALS_UNAVAILABLE: "Kredensial koneksi tidak dapat dibaca. Coba sambungkan ulang akun Meta.",
  NO_AD_ACCOUNT: "Tidak ditemukan akun iklan pada akun Meta yang terhubung.",
  MULTIPLE_AD_ACCOUNTS:
    "Ditemukan lebih dari satu akun iklan pada akun Meta ini. LINOE belum mendukung pemilihan akun iklan, jadi tidak memilih salah satunya secara otomatis dan kesiapan tidak dapat dipastikan.",
  AD_ACCOUNT_MISMATCH:
    "Akun iklan yang ditemukan di Meta tidak sama dengan akun iklan yang tersimpan di LINOE. Sambungkan ulang akun Meta lalu periksa lagi.",
});

/** The check could not run (or ran without a usable answer): always UNKNOWN, never READY. */
export function unavailableMetaReadiness(reason: ReadinessUnavailableReason, now: Date): MetaReadinessResult {
  return {
    state: "UNKNOWN",
    summary: SUMMARY.UNKNOWN,
    checks: [],
    unavailableReason: reason,
    minDailyBudgetRaw: null,
    checkedAt: now.toISOString(),
  };
}

export function unavailableReasonMessage(reason: ReadinessUnavailableReason): string {
  return UNAVAILABLE_MESSAGES[reason];
}

/**
 * Maps a failed Graph call to a reason using ONLY the structured fields
 * (HTTP status, numeric code). The provider's message text is never read: it
 * can echo request data and must not reach a log or the browser.
 *
 * Codes (https://developers.facebook.com/docs/marketing-api/error-reference/):
 * 190 invalid OAuth token and 102 invalid session; 10 and 200-299 permission
 * errors (294 = ads_management / allow-listed app); 4 and 17 call limits;
 * 100 invalid parameter (also what an unsupported field produces).
 */
export function classifyGraphFailure(err: unknown): ReadinessUnavailableReason {
  if (typeof err !== "object" || err === null) return "PROVIDER_ERROR";
  const record = err as { status?: unknown; code?: unknown };
  const code = typeof record.code === "number" ? record.code : undefined;
  const status = typeof record.status === "number" ? record.status : undefined;

  if (code === 190 || code === 102) return "TOKEN_EXPIRED";
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) return "PERMISSION_MISSING";
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) return "RATE_LIMITED";
  if (code === 100) return "FIELD_UNAVAILABLE";
  if (status === 401) return "TOKEN_EXPIRED";
  if (status === 403) return "PERMISSION_MISSING";
  return "PROVIDER_ERROR";
}

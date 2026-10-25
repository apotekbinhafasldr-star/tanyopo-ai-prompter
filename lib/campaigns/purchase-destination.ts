import { resolveOwnHosts, validateLandingUrl } from "@/lib/campaigns/meta-launch-preflight";

/**
 * Purchase Destination (MVP v1): where a person who clicks an ad is sent.
 *
 * Pure and isomorphic (no database, no network, no `server-only`): it is used by the
 * wizard inputs (client), the server actions (input + storage) and the launch preflight.
 * It NEVER fetches a user-supplied URL.
 *
 * Stored per campaign inside the existing `prompter_master_campaigns.ai_proposal` JSON under
 * the key `purchase_destination` (no migration). Campaigns created before this feature have no
 * such key and are treated as "legacy": their launch behaviour is unchanged.
 *
 * Validation rules for websites are NOT re-implemented here: they are the audited
 * `validateLandingUrl` of the Meta preflight (HTTPS only, public DNS name, no IP / localhost /
 * internal host, no credentials, no explicit port, length limit, never a LINOE / Tanyopo /
 * Supabase host). WhatsApp numbers are normalised strictly and always turned into an official
 * `https://wa.me/<digits>` link.
 */

export const PURCHASE_DESTINATION_KEY = "purchase_destination";
export const PURCHASE_DESTINATION_VERSION = 1;
export const DESTINATION_TYPES = ["WEBSITE", "WHATSAPP", "NONE"] as const;
export type DestinationType = (typeof DESTINATION_TYPES)[number];

export const DESTINATION_LABELS: Record<DestinationType, string> = {
  WEBSITE: "Website / Toko Online",
  WHATSAPP: "WhatsApp Penjual",
  NONE: "Belum Punya Tujuan",
};

/** What is persisted. `link` is derived and is always re-derived/re-validated from `value` before use. */
export interface PurchaseDestination {
  version: typeof PURCHASE_DESTINATION_VERSION;
  type: DestinationType;
  /** WEBSITE: the validated https URL. WHATSAPP: the normalised international digits (e.g. 628123456789). NONE: null. */
  value: string | null;
  /** WEBSITE: same as value. WHATSAPP: https://wa.me/<digits>. NONE: null. */
  link: string | null;
}

export type DestinationResult<T> = { ok: true; value: T } | { ok: false; message: string };

const ok = <T>(value: T): DestinationResult<T> => ({ ok: true, value });
const fail = (message: string): DestinationResult<never> => ({ ok: false, message });

// ---------------------------------------------------------------------------
// WhatsApp (Indonesia)
// ---------------------------------------------------------------------------

const WA_INVALID = "Nomor WhatsApp tidak valid. Gunakan nomor Indonesia, contoh 08123456789 atau +628123456789.";

/**
 * Strict Indonesian mobile normalisation. Returns the international digits WITHOUT "+"
 * (e.g. "628123456789"). Accepted inputs: 08…, 8… is NOT accepted (ambiguous), +628…, 628…,
 * with spaces, hyphens, dots or parentheses as separators, or an official `wa.me/<digits>` link
 * (optionally with https://) which is only used to read the number back out.
 *
 * Rejected: empty, letters or any other character, other countries, landline numbers,
 * 620…, all-identical digits, and anything outside 10–13 digits in international form.
 */
export function normalizeIndonesianWhatsapp(raw: unknown): DestinationResult<string> {
  if (typeof raw !== "string") return fail(WA_INVALID);
  let text = raw.trim();
  if (text.length === 0) return fail("Nomor WhatsApp belum diisi.");
  if (text.length > 60) return fail(WA_INVALID);

  const link = /^(?:https:\/\/)?(?:www\.)?wa\.me\/(\+?[0-9]{8,16})\/?$/i.exec(text);
  if (link) text = link[1];

  if (!/^\+?[0-9\s().-]+$/.test(text)) return fail(WA_INVALID);
  if (text.includes("+") && !text.startsWith("+")) return fail(WA_INVALID);

  const digits = text.replace(/[^0-9]/g, "");
  let national: string;
  if (text.startsWith("+") || digits.startsWith("62")) {
    if (!digits.startsWith("62")) return fail(WA_INVALID);
    national = digits.slice(2);
  } else if (digits.startsWith("0")) {
    national = digits.slice(1);
  } else {
    return fail(WA_INVALID);
  }

  // Indonesian mobile numbers start with 8 (after the country/trunk prefix); 9–12 national digits.
  if (!/^8[0-9]{8,11}$/.test(national)) return fail(WA_INVALID);
  // Obvious placeholders such as 08111111111 or 0812222222: seven or more identical digits in a row.
  if (/(\d)\1{6,}/.test(national)) return fail(WA_INVALID);

  return ok(`62${national}`);
}

export function buildWhatsappLink(normalizedDigits: string): string {
  return `https://wa.me/${normalizedDigits}`;
}

// ---------------------------------------------------------------------------
// Website
// ---------------------------------------------------------------------------

/** Our own host list from trusted config; null when the app domain is not configured on this server. */
export function resolveOwnHostsFromEnv(env: {
  NEXT_PUBLIC_APP_URL?: string;
  META_REDIRECT_URI?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
}): string[] | null {
  const hosts = resolveOwnHosts({
    appUrl: env.NEXT_PUBLIC_APP_URL,
    metaRedirectUri: env.META_REDIRECT_URI,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
  });
  return hosts.ok ? hosts.value : null;
}

const TAIL_HINT = / Perbaiki URL pada produk atau profil brand\.$/;
const stripCatalogHint = (message: string) => message.replace(TAIL_HINT, "");

/**
 * `ownHosts === null` means the app domain is not configured on this server (client side, or a
 * misconfigured server): the audited validator still runs with its built-in blocked host, and
 * the launch preflight re-validates with the strict list (it fails closed when unconfigured).
 */
export function validateWebsiteUrl(raw: unknown, ownHosts: readonly string[] | null): DestinationResult<string> {
  if (typeof raw !== "string" || raw.trim().length === 0) return fail("URL website belum diisi.");
  const result = validateLandingUrl(raw.trim(), ownHosts ?? []);
  if (!result.ok) return fail(stripCatalogHint(result.message));
  return ok(result.value);
}

/**
 * Pre-fill value for the wizard's website field, derived from a product's stored website_url.
 * Only a URL that passes the full website validation (which includes LINOE's own hosts, with or
 * without environment configuration) is offered; anything else yields null so the field stays empty.
 */
export function safeWebsiteDefault(raw: string | null | undefined, ownHosts: readonly string[] | null): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const result = validateWebsiteUrl(raw, ownHosts);
  return result.ok ? result.value : null;
}

// ---------------------------------------------------------------------------
// Build / read
// ---------------------------------------------------------------------------

export function buildPurchaseDestination(
  input: { type: unknown; value?: unknown },
  ownHosts: readonly string[] | null,
): DestinationResult<PurchaseDestination> {
  switch (input.type) {
    case "WEBSITE": {
      const url = validateWebsiteUrl(input.value, ownHosts);
      if (!url.ok) return url;
      return ok({ version: PURCHASE_DESTINATION_VERSION, type: "WEBSITE", value: url.value, link: url.value });
    }
    case "WHATSAPP": {
      const digits = normalizeIndonesianWhatsapp(input.value);
      if (!digits.ok) return digits;
      return ok({
        version: PURCHASE_DESTINATION_VERSION,
        type: "WHATSAPP",
        value: digits.value,
        link: buildWhatsappLink(digits.value),
      });
    }
    case "NONE":
      return ok({ version: PURCHASE_DESTINATION_VERSION, type: "NONE", value: null, link: null });
    default:
      return fail("Pilih ke mana calon pembeli diarahkan.");
  }
}

/**
 * Form contract shared by both wizards: a missing/unknown type from a stale client is treated as NONE
 * (strategy only, paid launch refused) rather than as an error, so older pages keep working safely.
 */
export function buildPurchaseDestinationFromForm(
  rawType: unknown,
  rawValue: unknown,
  ownHosts: readonly string[] | null,
): DestinationResult<PurchaseDestination> {
  const type = typeof rawType === "string" && rawType.length > 0 ? rawType : "NONE";
  return buildPurchaseDestination({ type, value: rawValue }, ownHosts);
}

export type StoredDestination =
  | { kind: "legacy" }
  | { kind: "none" }
  | { kind: "valid"; destination: PurchaseDestination }
  | { kind: "invalid"; message: string };

/**
 * Reads `ai_proposal.purchase_destination` and RE-VALIDATES it (stored data is never trusted):
 * the link is rebuilt from `value`. No key at all => "legacy" (campaign created before this feature).
 */
export function readStoredDestination(aiProposal: unknown, ownHosts: readonly string[] | null): StoredDestination {
  if (aiProposal === null || typeof aiProposal !== "object" || Array.isArray(aiProposal)) return { kind: "legacy" };
  const raw = (aiProposal as Record<string, unknown>)[PURCHASE_DESTINATION_KEY];
  if (raw === undefined || raw === null) return { kind: "legacy" };
  if (typeof raw !== "object" || Array.isArray(raw)) return { kind: "invalid", message: "Data tujuan pembelian rusak." };
  const rec = raw as Record<string, unknown>;
  if (!(DESTINATION_TYPES as readonly unknown[]).includes(rec.type)) {
    return { kind: "invalid", message: "Jenis tujuan pembelian tidak dikenal." };
  }
  const built = buildPurchaseDestination({ type: rec.type, value: rec.value }, ownHosts);
  if (!built.ok) return { kind: "invalid", message: built.message };
  return built.value.type === "NONE" ? { kind: "none" } : { kind: "valid", destination: built.value };
}

/** Returns a copy of the proposal with the destination set; every other key is preserved untouched. */
export function withPurchaseDestination<T extends object>(proposal: T, destination: PurchaseDestination): T & {
  [PURCHASE_DESTINATION_KEY]: PurchaseDestination;
} {
  return { ...proposal, [PURCHASE_DESTINATION_KEY]: destination };
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

export type LaunchDestinationCheck =
  | { ok: true; mode: "legacy" }
  | { ok: true; mode: "destination"; destination: PurchaseDestination }
  | { ok: false; message: string };

/**
 * Platform-agnostic launch guard. Legacy campaigns behave exactly as before. A campaign whose
 * destination is "none" (or stored invalid) is refused: paid launch needs a valid destination.
 */
export function checkLaunchDestination(aiProposal: unknown, ownHosts: readonly string[] | null): LaunchDestinationCheck {
  const stored = readStoredDestination(aiProposal, ownHosts);
  switch (stored.kind) {
    case "legacy":
      return { ok: true, mode: "legacy" };
    case "none":
      return {
        ok: false,
        message:
          "Campaign ini belum punya tujuan pembelian (website atau WhatsApp). Peluncuran iklan berbayar ditolak sampai tujuan yang valid tersedia. Tidak ada yang dikirim ke platform iklan.",
      };
    case "invalid":
      return {
        ok: false,
        message: `Tujuan pembelian campaign tidak valid: ${stored.message} Peluncuran dibatalkan. Tidak ada yang dikirim ke platform iklan.`,
      };
    case "valid":
      return { ok: true, mode: "destination", destination: stored.destination };
  }
}

// ---------------------------------------------------------------------------
// Tracking (simple UTM, websites only)
// ---------------------------------------------------------------------------

const MAX_LINK_LENGTH = 2000;

/**
 * Adds simple UTM parameters to a WEBSITE link. Never touches WhatsApp links. Existing `utm_*`
 * parameters the seller already set are kept (never overwritten). Only non-sensitive constants
 * are added: no tenant id, user id, email or product name. This is click labelling only: it does
 * NOT mean sales attribution is automatic.
 */
export function withUtm(link: string, params: { campaignRef: string; medium?: string }): DestinationResult<string> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return fail("Format URL tidak valid.");
  }
  if (url.protocol !== "https:") return fail("Hanya HTTPS yang diizinkan.");
  if (url.hostname.toLowerCase() === "wa.me") return ok(link);

  const ref = params.campaignRef.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  const wanted: Record<string, string> = {
    utm_source: "linoe",
    utm_medium: params.medium ?? "paid_social",
    ...(ref ? { utm_campaign: `linoe-${ref}` } : {}),
  };
  for (const [key, value] of Object.entries(wanted)) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  const result = url.toString();
  if (result.length > MAX_LINK_LENGTH) return fail("URL terlalu panjang setelah parameter pelacakan ditambahkan.");
  return ok(result);
}

/** Short, human readable form for review screens: host only for websites, masked number for WhatsApp. */
export function describeDestinationTarget(destination: PurchaseDestination): string {
  if (destination.type === "WEBSITE" && destination.link) {
    try {
      const url = new URL(destination.link);
      return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
    } catch {
      return destination.link;
    }
  }
  if (destination.type === "WHATSAPP" && destination.value) {
    const v = destination.value;
    return `+${v.slice(0, 5)}…${v.slice(-3)}`;
  }
  return "—";
}

// ---------------------------------------------------------------------------
// Approval snapshot
// ---------------------------------------------------------------------------

/** Key inside prompter_approvals.context (existing JSON column, no migration). */
export const DESTINATION_SNAPSHOT_KEY = "destination_snapshot";

/**
 * What the owner approved, recorded at submission. Every submission records the ACTUAL destination:
 *  - "destination":       the campaign's own stored destination (website / WhatsApp);
 *  - "legacy_url":        a legacy campaign (no stored destination): the final product/brand landing URL
 *                         resolved and validated on the server at that moment;
 *  - "legacy_unresolved": a legacy campaign with no usable landing URL at that moment;
 *  - "none" / "invalid":  a stored destination that cannot be launched (kept for the audit trail).
 * An approval without a snapshot of one of these kinds is never trusted (fail closed).
 */
export type DestinationSnapshot =
  | { version: 1; kind: "destination"; type: "WEBSITE" | "WHATSAPP"; value: string; link: string }
  | { version: 1; kind: "legacy_url"; link: string }
  | { version: 1; kind: "legacy_unresolved" }
  | { version: 1; kind: "none" }
  | { version: 1; kind: "invalid" };

/** Server-side env hosts for this deployment (null when the app domain is not configured). */
export function ownHostsFromProcessEnv(): string[] | null {
  return resolveOwnHostsFromEnv({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    META_REDIRECT_URI: process.env.META_REDIRECT_URI,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
}

/**
 * Builds the snapshot for the CURRENT campaign. `legacyLandingUrl` is only used for a legacy campaign:
 * the validated product/brand URL as resolved on the server right now, or null when there is none.
 */
export function buildDestinationSnapshot(
  aiProposal: unknown,
  ownHosts: readonly string[] | null,
  legacyLandingUrl: string | null,
): DestinationSnapshot {
  const stored = readStoredDestination(aiProposal, ownHosts);
  switch (stored.kind) {
    case "legacy":
      return legacyLandingUrl
        ? { version: 1, kind: "legacy_url", link: legacyLandingUrl }
        : { version: 1, kind: "legacy_unresolved" };
    case "none":
      return { version: 1, kind: "none" };
    case "invalid":
      return { version: 1, kind: "invalid" };
    case "valid": {
      const d = stored.destination;
      return {
        version: 1,
        kind: "destination",
        type: d.type as "WEBSITE" | "WHATSAPP",
        value: d.value ?? "",
        link: d.link ?? "",
      };
    }
  }
}

export const SNAPSHOT_MISMATCH_MESSAGE =
  "Tujuan iklan berbeda dari yang disetujui, atau persetujuan ini tidak mencatat tujuan iklan (persetujuan lama). Peluncuran dibatalkan dan tidak ada yang dikirim ke platform iklan. Buka halaman campaign: pilih 'Kembalikan ke Draft' (jika sudah Terjadwal) atau 'Batalkan pengajuan' (jika menunggu persetujuan), lalu ajukan dan setujui ulang.";

/**
 * Compares the CURRENT destination with the snapshot stored in the approval context. Fail closed:
 * anything that cannot be proven identical is refused, including every approval that has no snapshot
 * (old approvals are never assumed to match today's destination).
 *
 * `legacyLandingUrl` (legacy campaigns only): string = the URL resolved and validated right now;
 * null = confirmed none/invalid; undefined = unknown (not resolved) which is refused.
 */
export function checkApprovalDestinationSnapshot(
  approvalContext: unknown,
  aiProposal: unknown,
  ownHosts: readonly string[] | null,
  legacyLandingUrl?: string | null,
): DestinationResult<true> {
  const current = readStoredDestination(aiProposal, ownHosts);
  const raw =
    approvalContext !== null && typeof approvalContext === "object" && !Array.isArray(approvalContext)
      ? (approvalContext as Record<string, unknown>)[DESTINATION_SNAPSHOT_KEY]
      : undefined;

  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return fail(SNAPSHOT_MISMATCH_MESSAGE);
  }
  const snap = raw as Record<string, unknown>;

  if (snap.kind === "destination" && current.kind === "valid") {
    const d = current.destination;
    return snap.type === d.type && snap.value === d.value && snap.link === d.link
      ? ok(true)
      : fail(SNAPSHOT_MISMATCH_MESSAGE);
  }
  // A destination that is "none" or invalid at submission and still is: unlaunchable either way (the
  // launch refuses it on its own), so there is nothing to compare.
  if ((snap.kind === "none" && current.kind === "none") || (snap.kind === "invalid" && current.kind === "invalid")) {
    return ok(true);
  }
  if (snap.kind === "legacy_url" && current.kind === "legacy") {
    return typeof snap.link === "string" && typeof legacyLandingUrl === "string" && snap.link === legacyLandingUrl
      ? ok(true)
      : fail(SNAPSHOT_MISMATCH_MESSAGE);
  }
  if (snap.kind === "legacy_unresolved" && current.kind === "legacy") {
    return legacyLandingUrl === null ? ok(true) : fail(SNAPSHOT_MISMATCH_MESSAGE);
  }
  return fail(SNAPSHOT_MISMATCH_MESSAGE);
}

/** One-line summary for wizard review screens; null when the input is not (yet) valid. */
export function summarizeDestinationInput(type: DestinationType | "", value: string): string | null {
  if (!type) return null;
  const built = buildPurchaseDestination({ type, value }, null);
  if (!built.ok) return null;
  if (built.value.type === "NONE") return "Belum ada tujuan. Iklan berbayar tidak bisa diluncurkan sampai tujuan diisi.";
  return `${DESTINATION_LABELS[built.value.type]} · ${describeDestinationTarget(built.value)}`;
}

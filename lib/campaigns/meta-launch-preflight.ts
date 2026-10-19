import { isOwnProductMediaPath } from "@/lib/media/product-media-path";
import { META_OBJECTIVE_CONTRACTS, META_UNSUPPORTED_OBJECTIVES } from "@/lib/campaigns/meta-objective-contracts";

/**
 * Pure Meta launch preflight (PR #36).
 *
 * Every function here decides from data it is GIVEN: no database, no
 * network, no Storage, no Meta. The launch action (features/campaigns/
 * launch-actions.ts) reads the data, runs these checks and only then makes
 * the exclusive launch claim — so a rejected launch claims nothing, creates
 * nothing on Meta and changes no status.
 *
 * Messages are our own Indonesian text. They never echo a provider error,
 * a token or a tenant's raw value other than the field name being rejected.
 */

export type PreflightFailureCode =
  | "APPROVAL_MISSING"
  | "AD_ACCOUNT_INVALID"
  | "PAGE_NOT_SELECTED"
  | "OBJECTIVE_UNSUPPORTED"
  | "OBJECTIVE_UNKNOWN"
  | "TARGET_COUNTRY_INVALID"
  | "LANDING_URL_MISSING"
  | "LANDING_URL_UNSAFE"
  | "APP_HOST_UNCONFIGURED"
  | "IMAGE_MISSING"
  | "IMAGE_INVALID"
  | "PREFLIGHT_READ_FAILED";

export type Check<T> = { ok: true; value: T } | { ok: false; code: PreflightFailureCode; message: string };

export function preflightFail(code: PreflightFailureCode, message: string): { ok: false; code: PreflightFailureCode; message: string } {
  return { ok: false, code, message };
}

function pass<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

/** The most recent CAMPAIGN_LAUNCH approval of the master must be APPROVED. */
export function checkLaunchApproval(rows: readonly { status: string; created_at: string }[] | null | undefined): Check<true> {
  const latest = [...(rows ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!latest || latest.status !== "APPROVED") {
    return preflightFail(
      "APPROVAL_MISSING",
      "Campaign ini belum memiliki persetujuan peluncuran yang berstatus Disetujui. Ajukan dan setujui terlebih dahulu di Pusat Persetujuan.",
    );
  }
  return pass(true);
}

// ---------------------------------------------------------------------------
// Ad account and Facebook Page
// ---------------------------------------------------------------------------

const AD_ACCOUNT_PATTERN = /^act_[0-9]{1,20}$/;

/** Meta ad account ids are `act_<digits>` exactly as `/me/adaccounts` returns them. */
export function checkAdAccountId(value: unknown): Check<string> {
  if (typeof value !== "string" || !AD_ACCOUNT_PATTERN.test(value)) {
    return preflightFail(
      "AD_ACCOUNT_INVALID",
      "ID ad account Meta tidak valid. Hubungkan ulang akun di halaman Connections. Tidak ada yang dikirim ke Meta.",
    );
  }
  return pass(value);
}

/** A Page must have been chosen by the Owner. Never replaced by another Page or a default. */
export function checkSelectedPageId(value: unknown): Check<string> {
  if (typeof value !== "string" || !/^\S{1,64}$/.test(value)) {
    return preflightFail(
      "PAGE_NOT_SELECTED",
      "Belum ada Facebook Page yang dipilih. Pilih Page di halaman Connections sebelum meluncurkan. Tidak ada yang dikirim ke Meta.",
    );
  }
  return pass(value);
}

// ---------------------------------------------------------------------------
// Objective
// ---------------------------------------------------------------------------

export interface MetaObjectivePlan {
  campaignObjective: string;
  optimizationGoal: string;
}

const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/**
 * Explicit mapping only. No default objective: an unknown value is rejected,
 * and a known value without a VERIFIED Meta contract is rejected too.
 */
export function resolveMetaObjectivePlan(objective: unknown): Check<MetaObjectivePlan> {
  if (typeof objective !== "string" || objective.length === 0) {
    return preflightFail("OBJECTIVE_UNKNOWN", "Objective campaign tidak dikenali. Campaign tidak dikirim ke Meta.");
  }

  if (has(META_OBJECTIVE_CONTRACTS, objective)) {
    const contract = META_OBJECTIVE_CONTRACTS[objective];
    if (contract && contract.verified) {
      return pass({ campaignObjective: contract.campaignObjective, optimizationGoal: contract.optimizationGoal });
    }
    return preflightFail(
      "OBJECTIVE_UNSUPPORTED",
      `Objective ${objective} belum memiliki kontrak Meta yang terverifikasi, jadi peluncuran ditahan. Campaign tidak dikirim ke Meta.`,
    );
  }

  if (has(META_UNSUPPORTED_OBJECTIVES, objective)) {
    return preflightFail("OBJECTIVE_UNSUPPORTED", META_UNSUPPORTED_OBJECTIVES[objective] ?? "Objective belum didukung.");
  }

  return preflightFail("OBJECTIVE_UNKNOWN", "Objective campaign tidak dikenali. Campaign tidak dikirim ke Meta.");
}

// ---------------------------------------------------------------------------
// Target country
// ---------------------------------------------------------------------------

/** ISO 3166-1 alpha-2 officially assigned codes. A code not listed is rejected (fail closed). */
const ISO_3166_1_ALPHA2 = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
    "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
    "UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

let nameToCode: Map<string, string> | null = null;

/** Country names (English and Indonesian) derived from the platform's ICU data, not a hand-written table. */
function countryNameIndex(): Map<string, string> {
  if (nameToCode) return nameToCode;
  const index = new Map<string, string>();
  for (const locale of ["en", "id"]) {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      names = null;
    }
    if (!names) continue;
    for (const code of ISO_3166_1_ALPHA2) {
      const name = names.of(code);
      if (name && name !== code) {
        const key = normalizeName(name);
        // An ambiguous name (same text for two codes) is dropped, never guessed.
        if (index.has(key) && index.get(key) !== code) index.set(key, "");
        else index.set(key, code);
      }
    }
  }
  nameToCode = index;
  return index;
}

/** `target_country` is free text on the master campaign: accept an ISO alpha-2 code or an exact country name. */
export function resolveTargetCountry(raw: unknown): Check<string> {
  const invalid = preflightFail(
    "TARGET_COUNTRY_INVALID",
    "Negara target campaign kosong atau tidak dikenali. Isi negara dengan nama atau kode negara yang valid (contoh: Indonesia atau ID). Tidak ada yang dikirim ke Meta.",
  );
  if (typeof raw !== "string") return invalid;
  const value = raw.trim();
  if (value.length === 0 || value.length > 100) return invalid;

  if (/^[A-Za-z]{2}$/.test(value)) {
    const code = value.toUpperCase();
    return ISO_3166_1_ALPHA2.has(code) ? pass(code) : invalid;
  }

  const code = countryNameIndex().get(normalizeName(value));
  return code ? pass(code) : invalid;
}

// ---------------------------------------------------------------------------
// Landing URL
// ---------------------------------------------------------------------------

const MAX_URL_LENGTH = 2000;
const RESERVED_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "intranet",
  "corp",
  "home",
  "lan",
  "test",
  "example",
  "invalid",
  "arpa",
  "onion",
];

/** The host of the fallback link PR #36 removed from the Meta connector. Blocked exactly, never by substring. */
const LEGACY_FALLBACK_HOST = "tanyopo.ai";

const unsafeUrl = (reason: string) =>
  preflightFail("LANDING_URL_UNSAFE", `URL landing tidak dapat dipakai untuk iklan: ${reason}. Perbaiki URL pada produk atau profil brand.`);

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function publicHttpsHost(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".") || host.startsWith("[") || /^[0-9.]+$/.test(host)) return null;
    const tld = host.split(".").pop() ?? "";
    if (RESERVED_SUFFIXES.includes(tld)) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * The hosts that belong to this application, from trusted configuration only:
 * `NEXT_PUBLIC_APP_URL` (the app's official URL) and the host of
 * `META_REDIRECT_URI` (always the app's own domain once Meta is configured),
 * plus the Supabase host. Nothing is hard-coded and no domain is guessed.
 *
 * Fails closed when NEITHER app source yields a public HTTPS host (for example
 * `NEXT_PUBLIC_APP_URL` unset, which defaults to localhost): without knowing
 * which domain is ours we cannot prove a tenant URL is not it.
 */
export function resolveOwnHosts(config: {
  appUrl?: string | null;
  metaRedirectUri?: string | null;
  supabaseUrl?: string | null;
}): Check<string[]> {
  const appHosts = [publicHttpsHost(config.appUrl), publicHttpsHost(config.metaRedirectUri)].filter(
    (host): host is string => host !== null,
  );
  if (appHosts.length === 0) {
    return preflightFail(
      "APP_HOST_UNCONFIGURED",
      "Domain resmi aplikasi belum terkonfigurasi di server (NEXT_PUBLIC_APP_URL atau META_REDIRECT_URI), sehingga URL landing tidak dapat diverifikasi. Hubungi admin. Tidak ada yang dikirim ke Meta.",
    );
  }
  let supabaseHost: string | null = null;
  try {
    supabaseHost = config.supabaseUrl ? new URL(config.supabaseUrl).hostname.toLowerCase() : null;
  } catch {
    supabaseHost = null;
  }
  return pass([...new Set([...appHosts, ...(supabaseHost ? [supabaseHost] : [])])]);
}

/**
 * Validates ONE landing URL without changing it: the original string is
 * returned untouched. HTTPS only, a public DNS name, no credentials, no
 * custom port, and never a Tanyopo / LINOE / Supabase host.
 */
export function validateLandingUrl(raw: string, ownHosts: readonly string[] = []): Check<string> {
  if (raw.length === 0) return preflightFail("LANDING_URL_MISSING", "URL landing belum diisi.");
  if (raw.length > MAX_URL_LENGTH) return unsafeUrl("terlalu panjang");
  if (/[\s\u0000-\u001f\u007f\\]/.test(raw)) return unsafeUrl("mengandung spasi atau karakter tidak valid");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return unsafeUrl("format tidak valid");
  }

  if (url.protocol !== "https:") return unsafeUrl("hanya HTTPS yang diizinkan");
  if (url.username !== "" || url.password !== "") return unsafeUrl("tidak boleh berisi kredensial");
  if (url.port !== "") return unsafeUrl("port khusus tidak diizinkan");

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname.startsWith("[") || hostname.includes(":")) return unsafeUrl("alamat IP tidak diizinkan");
  if (/^[0-9.]+$/.test(hostname)) return unsafeUrl("alamat IP tidak diizinkan");
  if (!hostname.includes(".")) return unsafeUrl("host internal tidak diizinkan");

  const labels = hostname.split(".");
  const tld = labels[labels.length - 1] ?? "";
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return unsafeUrl("domain tidak valid");
  if (RESERVED_SUFFIXES.includes(tld)) return unsafeUrl("host internal tidak diizinkan");

  // Own hosts come from trusted configuration (see resolveOwnHosts), never from a
  // substring of the brand name. The removed legacy fallback host stays blocked
  // as defence in depth (exact domain and its subdomains only).
  for (const own of [...ownHosts, LEGACY_FALLBACK_HOST]) {
    const normalized = own.toLowerCase().replace(/\.$/, "");
    if (normalized && hostMatches(hostname, normalized)) {
      return unsafeUrl("domain aplikasi ini tidak boleh dipakai sebagai tujuan iklan tenant");
    }
  }

  return pass(raw);
}

/**
 * Priority: product URL, then brand URL. A product URL that EXISTS but is
 * unsafe is rejected — it is never silently skipped in favour of the brand
 * URL. There is no other fallback.
 */
export function resolveLandingUrl(
  candidates: { productUrl?: string | null; brandUrl?: string | null },
  ownHosts: readonly string[] = [],
): Check<string> {
  const present = (value: string | null | undefined): value is string =>
    typeof value === "string" && value.trim().length > 0;

  if (present(candidates.productUrl)) return validateLandingUrl(candidates.productUrl, ownHosts);
  if (present(candidates.brandUrl)) return validateLandingUrl(candidates.brandUrl, ownHosts);

  return preflightFail(
    "LANDING_URL_MISSING",
    "URL landing belum tersedia. Isi URL pada produk (atau di profil brand) agar iklan punya tujuan. Tidak ada yang dikirim ke Meta.",
  );
}

// ---------------------------------------------------------------------------
// Creative image
// ---------------------------------------------------------------------------

export const PRODUCT_MEDIA_BUCKET = "product-media";
/** Internal conservative size cap, deliberately NOT a claim about Meta's own limit. */
export const MAX_CREATIVE_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png"]);

export interface ProductMediaRow {
  id: string;
  tenant_id: string;
  product_id: string;
  storage_path: string;
  media_type: string;
}

const imageMissing = () =>
  preflightFail(
    "IMAGE_MISSING",
    "Produk belum memiliki gambar untuk iklan. Unggah gambar JPG atau PNG pada produk. Tidak ada yang dikirim ke Meta.",
  );
const imageInvalid = (reason: string) =>
  preflightFail("IMAGE_INVALID", `Gambar iklan tidak dapat dipakai: ${reason}. Tidak ada yang dikirim ke Meta.`);

/**
 * Chooses the creative image from the product's own media rows (already
 * filtered by tenant and product). An explicitly selected image is used or
 * rejected — never swapped for another one. Without a selection, the first
 * IMAGE by position is used.
 */
export function pickLaunchMedia(
  rows: readonly (ProductMediaRow & { position?: number })[],
  selectedMediaId: string | null | undefined,
): Check<ProductMediaRow> {
  if (selectedMediaId) {
    const selected = rows.find((row) => row.id === selectedMediaId);
    return selected ? pass(selected) : imageInvalid("gambar yang dipilih tidak ditemukan pada produk ini");
  }
  const first = rows.find((row) => row.media_type === "IMAGE");
  return first ? pass(first) : imageMissing();
}

/** Public URL on the trusted Supabase host only; null when the base URL or path is not safe. */
export function buildPublicMediaUrl(baseUrl: string | undefined, storagePath: string): string | null {
  if (!baseUrl) return null;
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" || base.username || base.password) return null;
  const segments = storagePath.split("/");
  if (segments.length < 3 || segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  const encoded = segments.map((segment) => encodeURIComponent(segment)).join("/");
  return `${base.origin}/storage/v1/object/public/${PRODUCT_MEDIA_BUCKET}/${encoded}`;
}

export interface CreativeImageInput {
  media: ProductMediaRow;
  tenantId: string;
  productId: string;
  supabaseUrl: string | undefined;
  /** Storage object metadata, as reported by Supabase Storage itself. */
  metadata: { mimetype?: unknown; size?: unknown } | null;
}

/**
 * Validates ownership, path, type and Storage metadata of the chosen image.
 * The returned URL is built by us from the trusted Supabase base URL and the
 * stored path; no user-supplied URL is ever fetched or forwarded.
 */
export function checkCreativeImage(input: CreativeImageInput): Check<{ imageUrl: string; storagePath: string }> {
  const { media, tenantId, productId, supabaseUrl, metadata } = input;

  if (media.tenant_id !== tenantId || media.product_id !== productId) {
    return imageInvalid("gambar bukan milik produk ini");
  }
  if (media.media_type !== "IMAGE") return imageInvalid("media yang dipilih bukan gambar");

  const path = media.storage_path;
  if (
    !isOwnProductMediaPath(path, tenantId, productId) ||
    /[\\?#%\u0000-\u001f\u007f]/.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return imageInvalid("lokasi file tidak valid");
  }
  if (!/\.(?:jpe?g|png)$/i.test(path)) return imageInvalid("format harus JPG atau PNG");

  if (!metadata) return imageInvalid("file tidak ditemukan di penyimpanan");
  const mimetype = typeof metadata.mimetype === "string" ? metadata.mimetype.toLowerCase() : "";
  if (!ALLOWED_IMAGE_MIME.has(mimetype)) return imageInvalid("format harus JPG atau PNG");
  const size = metadata.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > MAX_CREATIVE_IMAGE_BYTES) {
    return imageInvalid("ukuran file tidak valid atau melebihi batas 8 MB");
  }

  const imageUrl = buildPublicMediaUrl(supabaseUrl, path);
  if (!imageUrl) return imageInvalid("sumber penyimpanan tidak tersedia");
  return pass({ imageUrl, storagePath: path });
}

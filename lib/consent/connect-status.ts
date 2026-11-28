import { CONSENT_CATALOG, type ConsentCode } from "@/lib/consent/catalog";
import { asConsentRpc } from "@/lib/consent/rpc";

/**
 * Keadaan persetujuan koneksi untuk Owner pada halaman Koneksi (Paket 5a).
 *  - GRANTED    : persetujuan aktif untuk versi katalog terbaru -> tombol langsung ke OAuth.
 *  - REQUIRED   : belum diberikan / ditarik / versi lama -> dialog persetujuan.
 *  - UNREADABLE : status tidak terbaca (galat RPC, baris hilang, versi kode != versi database) -> perilaku lama + catatan; TIDAK dinyatakan "belum setuju".
 */
export type ConnectConsentState = "GRANTED" | "REQUIRED" | "UNREADABLE";
export type ConnectConsentPlatform = "META" | "TIKTOK";

export const CONNECT_CONSENT_CODE: Record<ConnectConsentPlatform, ConsentCode> = {
  META: "CONNECT_META",
  TIKTOK: "CONNECT_TIKTOK",
};

interface Row {
  code?: unknown;
  version?: unknown;
  status?: unknown;
}

/** Murni: mengubah hasil fn_prompter_consent_my_status menjadi keadaan per platform. */
export function resolveConnectConsentStates(rows: unknown): Record<ConnectConsentPlatform, ConnectConsentState> {
  const result: Record<ConnectConsentPlatform, ConnectConsentState> = { META: "UNREADABLE", TIKTOK: "UNREADABLE" };
  if (!Array.isArray(rows)) return result;
  for (const platform of Object.keys(CONNECT_CONSENT_CODE) as ConnectConsentPlatform[]) {
    const code = CONNECT_CONSENT_CODE[platform];
    const entry = CONSENT_CATALOG.find((e) => e.code === code);
    const row = (rows as Row[]).find((r) => r?.code === code);
    if (!entry || !entry.active || !row) continue;
    // Drift: versi aktif di database harus sama dengan teks yang ada di kode; bila tidak, teks yang akan ditampilkan bukan teks yang disetujui.
    if (typeof row.version !== "number" || row.version !== entry.version) continue;
    if (row.status === "GRANTED") result[platform] = "GRANTED";
    else if (row.status === "NOT_GIVEN" || row.status === "WITHDRAWN" || row.status === "OUTDATED") result[platform] = "REQUIRED";
  }
  return result;
}

/** Membaca status lewat sesi pengguna (RLS/auth.uid). Galat apa pun = UNREADABLE (tidak melempar). Hanya dipanggil bila CONSENT_UI_ENABLED hidup. */
export async function loadConnectConsentStates(supabase: unknown): Promise<Record<ConnectConsentPlatform, ConnectConsentState>> {
  try {
    const { data, error } = await asConsentRpc(supabase).rpc("fn_prompter_consent_my_status");
    if (error) return resolveConnectConsentStates(null);
    return resolveConnectConsentStates(data);
  } catch {
    return resolveConnectConsentStates(null);
  }
}

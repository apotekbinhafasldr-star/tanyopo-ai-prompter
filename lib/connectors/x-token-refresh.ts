import { ConnectorApiError, type ConnectorTokenResult } from "@/lib/connectors/types";

/**
 * Refresh token X + rotasi — orkestrasi murni (tanpa jaringan, tanpa database
 * sendiri): penyimpanan, enkripsi, dan pemanggil refresh DISUNTIK.
 *
 * Access token X berlaku 2 jam (docs.x.com authorization-code.md, diakses
 * 2026-11-15); refresh token hanya ada bila scope `offline.access` diminta.
 * Dokumen TIDAK menyebut apakah refresh token berotasi atau berapa umurnya
 * (UNKNOWN), jadi kode menangani dua kemungkinan: bila respons membawa
 * refresh_token baru, yang lama DIGANTI; bila tidak, yang lama dipertahankan.
 *
 * Aturan: token baru disimpan (terenkripsi) SEBELUM dikembalikan ke pemanggil.
 * Penolakan X (400/401, mis. invalid_grant) -> koneksi ACTION_REQUIRED agar
 * pengguna menyambungkan ulang. Galat sementara (5xx/jaringan) tidak mengubah
 * status. Refresh tidak pernah diulang otomatis (token bisa sekali pakai).
 * Belum ada pemanggil di aplikasi (belum ada posting); wajib dipanggil sebelum
 * pemakaian API X atas nama tenant, dengan tenantId dari sesi/server.
 */

export interface XRefreshStore {
  /** Harus memfilter tenant_id: hanya koneksi X milik tenant itu. */
  load(tenantId: string): Promise<{ accountId: string; encryptedRefreshToken: string | null } | null>;
  save(
    tenantId: string,
    accountId: string,
    input: {
      encryptedAccessToken: string;
      encryptedRefreshToken: string | null;
      expiresAt: string | null;
      scopes: string[];
      refreshedAt: string;
    },
  ): Promise<boolean>;
  markActionRequired(tenantId: string, accountId: string): Promise<void>;
}

export interface XRefreshDeps {
  store: XRefreshStore;
  refresh: (refreshToken: string) => Promise<ConnectorTokenResult>;
  encrypt: (plaintext: string) => string;
  decrypt: (blob: string) => string;
  now?: () => Date;
}

export type XRefreshResult =
  | { ok: true; accessToken: string; expiresAt: Date | null }
  | { ok: false; reason: "no_connection" | "no_refresh_token" | "rejected" | "save_failed" | "error" };

export async function refreshXConnection(tenantId: string, deps: XRefreshDeps): Promise<XRefreshResult> {
  const stored = await deps.store.load(tenantId);
  if (!stored) return { ok: false, reason: "no_connection" };
  if (!stored.encryptedRefreshToken) {
    await deps.store.markActionRequired(tenantId, stored.accountId);
    return { ok: false, reason: "no_refresh_token" };
  }

  let oldRefreshToken: string;
  try {
    oldRefreshToken = deps.decrypt(stored.encryptedRefreshToken);
  } catch {
    return { ok: false, reason: "error" };
  }

  let fresh: ConnectorTokenResult;
  try {
    fresh = await deps.refresh(oldRefreshToken);
  } catch (err) {
    if (err instanceof ConnectorApiError && (err.status === 400 || err.status === 401)) {
      await deps.store.markActionRequired(tenantId, stored.accountId);
      return { ok: false, reason: "rejected" };
    }
    return { ok: false, reason: "error" };
  }

  // Rotasi: pakai refresh token baru bila ada, kalau tidak pertahankan yang lama.
  const nextRefreshToken = fresh.refreshToken ?? oldRefreshToken;
  const now = (deps.now ?? (() => new Date()))();
  let saved = false;
  try {
    saved = await deps.store.save(tenantId, stored.accountId, {
      encryptedAccessToken: deps.encrypt(fresh.accessToken),
      encryptedRefreshToken: deps.encrypt(nextRefreshToken),
      expiresAt: fresh.expiresAt ? fresh.expiresAt.toISOString() : null,
      scopes: fresh.scopes,
      refreshedAt: now.toISOString(),
    });
  } catch {
    saved = false;
  }
  if (!saved) {
    // Refresh token lama mungkin sudah tidak berlaku di X (rotasi): jangan
    // berpura-pura masih tersambung.
    await deps.store.markActionRequired(tenantId, stored.accountId);
    return { ok: false, reason: "save_failed" };
  }
  return { ok: true, accessToken: fresh.accessToken, expiresAt: fresh.expiresAt ?? null };
}

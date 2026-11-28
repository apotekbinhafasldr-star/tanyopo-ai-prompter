"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { disconnectAction } from "@/features/connections/actions";
import { CONSENT_MESSAGES, getConsentEntry, type ConsentCode } from "@/lib/consent/catalog";
import { asConsentRpc } from "@/lib/consent/rpc";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ConnectorPlatform } from "@/types/database";

export interface ConsentActionState {
  error: string | null;
  info?: string | null;
}

const PLATFORM_BY_CODE: Partial<Record<ConsentCode, ConnectorPlatform>> = {
  CONNECT_META: "META",
  CONNECT_TIKTOK: "TIKTOK",
  CONNECT_X: "X",
};

type Source = "SETTINGS" | "CONNECT_FLOW";

/** Rem sederhana (best effort, memori per instance) terhadap penekanan tombol berulang. 30 permintaan per menit per pengguna. */
const CONSENT_RATE_LIMIT = 30;
const CONSENT_RATE_WINDOW_MS = 60 * 1000;
function allowConsentRequest(userId: string): boolean {
  return checkRateLimit(`consent:${userId}`, CONSENT_RATE_LIMIT, CONSENT_RATE_WINDOW_MS).allowed;
}

/** Memanggil fn_prompter_consent_set lewat sesi pengguna (auth.uid()). Versi diambil server dari katalog database, bukan dari klien. */
async function setConsent(code: ConsentCode, action: "GRANTED" | "WITHDRAWN", source: Source, tenantId?: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { error } = await asConsentRpc(supabase).rpc("fn_prompter_consent_set", {
      p_code: code,
      p_action: action,
      p_source: source,
      // Persetujuan koneksi milik TENANT: database memvalidasi bahwa tenant ini = tenant pemanggil DAN pemanggil adalah Owner.
      ...(tenantId ? { p_tenant_id: tenantId } : {}),
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Mengaktifkan persetujuan OPSIONAL non-koneksi (mis. email pembaruan, telemetri) dari layar Privasi & persetujuan.
 * Hanya kode aktif di katalog. Persetujuan koneksi (CONNECT_*) TIDAK diberikan dari sini: hanya dari alur koneksi.
 */
export async function grantOptionalConsentAction(code: string): Promise<ConsentActionState> {
  const session = await requireSessionContext({ allowIncompleteOnboarding: true });
  const entry = getConsentEntry(code);
  if (!entry || !entry.active || entry.kind !== "OPTIONAL") return { error: CONSENT_MESSAGES.saveFailed };
  if (!allowConsentRequest(session.userId)) return { error: CONSENT_MESSAGES.tooMany };
  const ok = await setConsent(entry.code, "GRANTED", "SETTINGS");
  if (!ok) return { error: CONSENT_MESSAGES.saveFailed };
  revalidatePath("/settings");
  return { error: null, info: CONSENT_MESSAGES.saved };
}

/**
 * Membaca versi persetujuan AKTIF untuk satu kode dari database (fn_prompter_consent_my_status, lewat sesi pengguna).
 * Mengembalikan null bila tidak terbaca (galat/baris tidak ada); pemanggil memperlakukannya sebagai gagal.
 */
async function readActiveVersion(code: ConsentCode): Promise<number | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await asConsentRpc(supabase).rpc("fn_prompter_consent_my_status");
    if (error || !Array.isArray(data)) return null;
    const row = (data as Array<{ code?: unknown; version?: unknown }>).find((r) => r?.code === code);
    return typeof row?.version === "number" && Number.isInteger(row.version) ? row.version : null;
  } catch {
    return null;
  }
}

/**
 * Memberi persetujuan koneksi platform (hanya Owner). Dipanggil dari dialog persetujuan di halaman Koneksi SEBELUM OAuth dimulai;
 * tidak memutus atau mengubah koneksi apa pun.
 *
 * `shownVersion` (opsional, agar pemanggil lama tetap aman): versi teks yang BENAR-BENAR ditampilkan di dialog. Bila ada, versi aktif
 * di database harus sama; bila berbeda atau tidak terbaca, tidak ada yang disimpan (persetujuan tidak boleh menunjuk teks yang tidak dilihat pengguna).
 * Versi yang disimpan tetap ditentukan database, bukan klien.
 */
export async function grantConnectionConsentAction(platform: ConnectorPlatform, shownVersion?: number): Promise<ConsentActionState> {
  const session = await requireSessionContext();
  if (session.role !== "owner") return { error: CONSENT_MESSAGES.ownerOnly };
  const code = (Object.keys(PLATFORM_BY_CODE) as ConsentCode[]).find((c) => PLATFORM_BY_CODE[c] === platform);
  const entry = code ? getConsentEntry(code) : null;
  if (!entry || !entry.active) return { error: CONSENT_MESSAGES.saveFailed };
  if (!allowConsentRequest(session.userId)) return { error: CONSENT_MESSAGES.tooMany };
  if (shownVersion !== undefined) {
    const active = await readActiveVersion(entry.code);
    if (active === null) return { error: CONSENT_MESSAGES.saveFailed };
    if (active !== shownVersion || entry.version !== shownVersion) return { error: CONSENT_MESSAGES.staleText };
  }
  const ok = await setConsent(entry.code, "GRANTED", "CONNECT_FLOW", session.tenantId);
  if (!ok) return { error: CONSENT_MESSAGES.saveFailed };
  revalidatePath("/connections");
  return { error: null, info: CONSENT_MESSAGES.saved };
}

/**
 * Menarik persetujuan. Opsional: langsung dicatat WITHDRAWN. Koneksi: memutus koneksi lewat disconnectAction yang ada (hanya Owner),
 * lalu mencatat WITHDRAWN. Pencabutan di sisi platform (Meta/TikTok) adalah BEST EFFORT, tidak dijamin selesai. Status berubah hanya setelah server mengonfirmasi (tanpa pembaruan optimistis). Data yang sudah diimpor
 * tidak otomatis terhapus.
 */
export async function withdrawConsentAction(code: string): Promise<ConsentActionState> {
  const session = await requireSessionContext({ allowIncompleteOnboarding: true });
  const entry = getConsentEntry(code);
  if (!entry || !entry.withdrawable) return { error: CONSENT_MESSAGES.withdrawFailed };
  if (!allowConsentRequest(session.userId)) return { error: CONSENT_MESSAGES.tooMany };

  if (entry.kind === "CONNECTION") {
    if (session.role !== "owner") return { error: CONSENT_MESSAGES.ownerOnly };
    const platform = PLATFORM_BY_CODE[entry.code];
    if (!platform) return { error: CONSENT_MESSAGES.withdrawFailed };
    const disconnected = await disconnectAction(platform);
    if (disconnected.error) return { error: disconnected.error };
    const ok = await setConsent(entry.code, "WITHDRAWN", "SETTINGS", session.tenantId);
    if (!ok) return { error: CONSENT_MESSAGES.disconnectedNotRecorded };
  } else {
    const ok = await setConsent(entry.code, "WITHDRAWN", "SETTINGS");
    if (!ok) return { error: CONSENT_MESSAGES.withdrawFailed };
  }
  revalidatePath("/settings");
  revalidatePath("/connections");
  return { error: null, info: CONSENT_MESSAGES.withdrawn };
}

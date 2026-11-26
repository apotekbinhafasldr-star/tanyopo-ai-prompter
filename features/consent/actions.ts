"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { disconnectAction } from "@/features/connections/actions";
import { CONSENT_MESSAGES, getConsentEntry, type ConsentCode } from "@/lib/consent/catalog";
import { asConsentRpc } from "@/lib/consent/rpc";
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

/** Memanggil fn_prompter_consent_set lewat sesi pengguna (auth.uid()). Versi diambil server dari katalog database, bukan dari klien. */
async function setConsent(code: ConsentCode, action: "GRANTED" | "WITHDRAWN", source: Source): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { error } = await asConsentRpc(supabase).rpc("fn_prompter_consent_set", { p_code: code, p_action: action, p_source: source });
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
  await requireSessionContext({ allowIncompleteOnboarding: true });
  const entry = getConsentEntry(code);
  if (!entry || !entry.active || entry.kind !== "OPTIONAL") return { error: CONSENT_MESSAGES.saveFailed };
  const ok = await setConsent(entry.code, "GRANTED", "SETTINGS");
  if (!ok) return { error: CONSENT_MESSAGES.saveFailed };
  revalidatePath("/settings");
  return { error: null, info: CONSENT_MESSAGES.saved };
}

/**
 * Memberi persetujuan koneksi platform (hanya Owner). Dipanggil dari alur koneksi SEBELUM OAuth dimulai (dialog menyusul di paket UI
 * berikutnya); tidak memutus atau mengubah koneksi apa pun.
 */
export async function grantConnectionConsentAction(platform: ConnectorPlatform): Promise<ConsentActionState> {
  const session = await requireSessionContext();
  if (session.role !== "owner") return { error: CONSENT_MESSAGES.ownerOnly };
  const code = (Object.keys(PLATFORM_BY_CODE) as ConsentCode[]).find((c) => PLATFORM_BY_CODE[c] === platform);
  const entry = code ? getConsentEntry(code) : null;
  if (!entry || !entry.active) return { error: CONSENT_MESSAGES.saveFailed };
  const ok = await setConsent(entry.code, "GRANTED", "CONNECT_FLOW");
  if (!ok) return { error: CONSENT_MESSAGES.saveFailed };
  revalidatePath("/connections");
  return { error: null, info: CONSENT_MESSAGES.saved };
}

/**
 * Menarik persetujuan. Opsional: langsung dicatat WITHDRAWN. Koneksi: memutus koneksi lewat disconnectAction yang ada (hanya Owner),
 * lalu mencatat WITHDRAWN. Status berubah hanya setelah server mengonfirmasi (tanpa pembaruan optimistis). Data yang sudah diimpor
 * tidak otomatis terhapus.
 */
export async function withdrawConsentAction(code: string): Promise<ConsentActionState> {
  const session = await requireSessionContext({ allowIncompleteOnboarding: true });
  const entry = getConsentEntry(code);
  if (!entry || !entry.withdrawable) return { error: CONSENT_MESSAGES.withdrawFailed };

  if (entry.kind === "CONNECTION") {
    if (session.role !== "owner") return { error: CONSENT_MESSAGES.ownerOnly };
    const platform = PLATFORM_BY_CODE[entry.code];
    if (!platform) return { error: CONSENT_MESSAGES.withdrawFailed };
    const disconnected = await disconnectAction(platform);
    if (disconnected.error) return { error: disconnected.error };
    const ok = await setConsent(entry.code, "WITHDRAWN", "SETTINGS");
    if (!ok) return { error: CONSENT_MESSAGES.disconnectedNotRecorded };
  } else {
    const ok = await setConsent(entry.code, "WITHDRAWN", "SETTINGS");
    if (!ok) return { error: CONSENT_MESSAGES.withdrawFailed };
  }
  revalidatePath("/settings");
  revalidatePath("/connections");
  return { error: null, info: CONSENT_MESSAGES.withdrawn };
}

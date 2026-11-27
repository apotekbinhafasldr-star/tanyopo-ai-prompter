import { createClient } from "@/lib/supabase/server";
import { asConsentRpc } from "@/lib/consent/rpc";
import { buildConsentItems } from "@/lib/consent/view";
import { ConsentPanel } from "@/features/consent/consent-panel";

/**
 * Memuat status persetujuan milik pengguna masuk dan menampilkan panel. Dipasang di halaman pengaturan HANYA bila
 * CONSENT_UI_ENABLED === "true". Gagal memuat = pesan galat + tombol muat ulang (bukan daftar kosong yang menyesatkan).
 */
export async function ConsentSection({ timeZone }: { timeZone: string }) {
  let rows: unknown = null;
  let failed = false;
  try {
    const supabase = await createClient();
    const { data, error } = await asConsentRpc(supabase).rpc("fn_prompter_consent_my_status");
    if (error) failed = true;
    else rows = data;
  } catch {
    failed = true;
  }
  const items = failed ? [] : buildConsentItems(rows, timeZone);
  return <ConsentPanel items={items} loadError={failed} />;
}

import { createClient } from "@/lib/supabase/server";
import { asConsentRpc } from "@/lib/consent/rpc";
import { buildConsentItems } from "@/lib/consent/view";
import { ConsentPanel } from "@/features/consent/consent-panel";

/**
 * Memuat status persetujuan milik pengguna masuk dan menampilkan panel (dipakai di /settings/privasi, hanya bila CONSENT_UI_ENABLED === "true").
 * Gagal memuat = pesan galat + tombol muat ulang (bukan daftar kosong yang menyesatkan).
 * `includeConnections=false` (bukan Owner): kartu persetujuan koneksi tidak ditampilkan; persetujuan koneksi platform diberikan Owner dan
 * status per pengguna ini tidak boleh dibaca sebagai status Owner.
 */
export async function ConsentSection({
  timeZone,
  includeConnections = true,
  title,
  intro,
}: {
  timeZone: string;
  includeConnections?: boolean;
  title?: string;
  intro?: string;
}) {
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
  const all = failed ? [] : buildConsentItems(rows, timeZone);
  const items = includeConnections ? all : all.filter((i) => i.kind !== "CONNECTION");
  return <ConsentPanel items={items} loadError={failed} title={title} intro={intro} />;
}

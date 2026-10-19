/**
 * Replaces the misleading "Coba Lagi" button on a Meta channel campaign in
 * FAILED (PR #37 / A2). Informational only: it has no button, form or
 * action, and no path from here can call the platform's create APIs.
 */
export function ManualCheckPanel({
  externalCampaignId,
  note,
}: {
  externalCampaignId: string | null;
  note: string | null;
}) {
  return (
    <div
      role="note"
      aria-label="Perlu pemeriksaan manual"
      className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-warning/30 bg-warning-muted/40 p-3"
    >
      <p className="text-sm font-semibold text-warning">Perlu pemeriksaan manual</p>
      <p className="text-xs text-foreground">
        Peluncuran ini berhenti sebelum selesai. Sebagian objek iklan (campaign, ad set, creative, atau ad) mungkin
        sudah dibuat di Meta, semuanya dalam status dijeda. Periksa Meta Ads Manager terlebih dahulu. LINOE tidak
        meluncurkan ulang secara otomatis dan tidak menyediakan tombol coba lagi.
      </p>
      {externalCampaignId ? (
        <p className="text-xs text-foreground">
          ID campaign yang tercatat: <span className="font-mono">{externalCampaignId}</span>
        </p>
      ) : (
        <p className="text-xs text-foreground">
          Tidak ada ID objek yang tercatat. Ini tidak membuktikan bahwa tidak ada objek yang dibuat di Meta.
        </p>
      )}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

import { Card, CardContent } from "@/components/ui/card";
import {
  DESTINATION_LABELS,
  describeDestinationTarget,
  readStoredDestination,
  resolveOwnHostsFromEnv,
} from "@/lib/campaigns/purchase-destination";

/**
 * Shows where buyers are sent BEFORE the owner approves. Server component: the stored value is
 * re-validated on every render (never trusted). Makes no sales-attribution claim.
 */
export function PurchaseDestinationCard({ aiProposal }: { aiProposal: unknown }) {
  const stored = readStoredDestination(
    aiProposal,
    resolveOwnHostsFromEnv({
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      META_REDIRECT_URI: process.env.META_REDIRECT_URI,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    }),
  );

  let title: string;
  let detail: string | null = null;
  let status: string;
  let warning: string | null = null;

  switch (stored.kind) {
    case "valid":
      title = DESTINATION_LABELS[stored.destination.type];
      detail = describeDestinationTarget(stored.destination);
      status = "Valid";
      break;
    case "none":
      title = DESTINATION_LABELS.NONE;
      status = "Belum ada tujuan";
      warning =
        "Calon pembeli belum punya tujuan. Iklan berbayar tidak bisa diluncurkan sampai website atau WhatsApp yang valid tersedia.";
      break;
    case "invalid":
      title = "Tujuan tidak valid";
      status = "Tidak valid";
      warning = `${stored.message} Iklan berbayar tidak bisa diluncurkan sampai diperbaiki.`;
      break;
    case "legacy":
      title = "Belum diatur";
      status = "Campaign lama (dibuat sebelum fitur ini)";
      warning =
        "Campaign ini dibuat sebelum ada pilihan tujuan pembelian. Tujuan memakai URL produk/brand seperti sebelumnya.";
      break;
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-1.5 p-4 text-sm">
        <p className="font-semibold text-foreground">Calon pembeli diarahkan ke:</p>
        <p className="text-foreground">
          {title}
          {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">Status: {status}</p>
        {warning ? (
          <p role="alert" className="rounded-[var(--radius-md)] bg-warning-muted p-2 text-xs text-foreground">
            {warning}
          </p>
        ) : null}
        {stored.kind === "valid" && stored.destination.type === "WEBSITE" ? (
          <p className="text-xs text-muted-foreground">
            Saat peluncuran, parameter utm sederhana ditambahkan ke tautan website untuk menandai klik. Ini bukan
            pelacakan penjualan otomatis.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

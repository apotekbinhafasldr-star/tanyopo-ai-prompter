import Link from "next/link";
import { Sparkles, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The Golden Path entry point on Product Detail — one simple, always-visible
 * primary action card, not a step checklist. Real-user testing found the
 * previous step-chip guidance ("Foto/Video → Blueprint → Content →
 * Campaign" + "Selanjutnya: buka tab X") added cognitive load without a
 * clear next action, and — because it only appeared right after creation
 * (justCreated) — reopening an existing product later showed no golden-path
 * entry point at all. This renders unconditionally for both cases, only the
 * headline copy differs.
 */
export function NextStepsGuidance({
  productId,
  justCreated,
}: {
  productId: string;
  justCreated: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-brand/25 bg-brand-muted/60 p-5">
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-brand">
          {justCreated ? "Produk berhasil dibuat 🎉" : "Produk Anda siap dipromosikan 🚀"}
        </p>
        <p className="text-sm text-foreground">
          LINOE akan membantu menentukan target pelanggan, strategi, konten, channel, dan campaign untuk
          produk ini.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link href={`/promote?product=${productId}`}>
            <Sparkles />
            Promosikan Produk Ini
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          Cukup tentukan tujuan dan budget. Selebihnya LINOE bantu kerjakan.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" size="sm" className="min-h-11">
          <Link href="#product-media">
            <ImagePlus />
            Tambah Foto/Video
          </Link>
        </Button>
        <Link
          href="#product-info"
          className="inline-flex min-h-11 items-center text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Lihat Detail Produk
        </Link>
      </div>
    </div>
  );
}

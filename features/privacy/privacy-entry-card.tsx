import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** Kartu masuk di Pengaturan ke /settings/privasi (dipasang hanya bila CONSENT_UI_ENABLED === "true"). */
export function PrivacyEntryCard() {
  return (
    <Link
      href="/settings/privasi"
      className="block rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <Card>
        <CardContent className="flex min-h-11 items-center gap-3 p-4">
          <ShieldCheck className="size-5 shrink-0 text-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">Privasi &amp; Data Saya</span>
            <span className="block text-sm text-muted-foreground">Persetujuan opsional, dokumen hukum, dan permintaan terkait data Anda.</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </CardContent>
      </Card>
    </Link>
  );
}

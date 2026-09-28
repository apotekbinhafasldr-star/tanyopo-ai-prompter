import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Demo — LINOE",
  robots: { index: false, follow: false },
};

/**
 * Shared shell for the entire /demo route tree (Founder requirement #6 —
 * "Demo harus terasa seperti produk LINOE sebenarnya tetapi seluruh
 * tindakan berisiko harus sandboxed/simulated"). The persistent banner
 * here is the one UI element every demo page inherits automatically, so
 * no individual page can accidentally ship without the required "data
 * simulasi" disclosure.
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-brand-muted px-4 py-2.5 sm:px-8">
        <div className="flex items-center gap-2 text-sm font-medium text-brand">
          <Sparkles className="size-4" aria-hidden />
          <span>Mode Demo LINOE</span>
          <Badge variant="outline">Data Simulasi</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Sesi sementara &middot; tidak terhubung ke akun, iklan, atau pembayaran nyata.
        </p>
        <Button asChild size="sm" className="bg-gradient-to-r from-brand to-brand-2">
          <Link href="/register">Mulai Gratis / Buat Akun</Link>
        </Button>
      </div>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

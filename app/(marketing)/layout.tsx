import { MarketingHeader } from "@/features/marketing/marketing-header";
import { LinoeLogo } from "@/components/brand/linoe-logo";
import { brand } from "@/lib/brand";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <MarketingHeader />

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        {/* PR #4 round-2: corporate identity footer, per Founder's exact
            requested copy — LINOE by Tanyopo / legal entity / coarse
            location only (no street/house address) / copyright line. */}
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          {/* Batch B10: Landing is frozen — pin the pre-B10 asset here too. */}
          <LinoeLogo size="sm" variant="legacy" />
          <div className="space-y-1 sm:text-right">
            <p className="font-medium text-foreground">{brand.lockup}</p>
            <p>Produk dari {brand.companyFull}</p>
            <p>{brand.companyLocation}</p>
            <p>
              © {new Date().getFullYear()} {brand.companyFull}. Hak cipta dilindungi.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

import { MarketingHeader } from "@/features/marketing/marketing-header";
import { LinoeLogo } from "@/components/brand/linoe-logo";
import { brand } from "@/lib/brand";
import { LegalLinks } from "@/features/legal/legal-links";
import { CompanyContact } from "@/features/legal/company-contact";
import { LEGAL } from "@/features/legal/legal-meta";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <MarketingHeader />

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 text-sm text-muted-foreground sm:px-6 md:flex-row md:justify-between">
          <div className="flex flex-col gap-4">
            {/* Batch B10: Landing is frozen — pin the pre-B10 asset here too. */}
            <LinoeLogo size="sm" variant="legacy" />
            <CompanyContact />
          </div>
          <div className="flex flex-col gap-3 md:max-w-md md:items-end md:text-right">
            <LegalLinks />
            <p>
              © {new Date().getFullYear()} {LEGAL.operator}. {brand.lockup} — bagian dari ekosistem{" "}
              {brand.companyFull}, bersama UMKMpro AI.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

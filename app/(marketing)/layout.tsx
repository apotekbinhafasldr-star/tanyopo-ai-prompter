import { MarketingHeader } from "@/features/marketing/marketing-header";
import { LinoeLogo } from "@/components/brand/linoe-logo";
import { brand } from "@/lib/brand";
import { LegalLinks } from "@/features/legal/legal-links";
import { LEGAL } from "@/features/legal/legal-meta";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <MarketingHeader />

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <LinoeLogo size="sm" />
          <div className="flex flex-col gap-3">
            <LegalLinks />
            <address className="not-italic">
              <p className="font-medium text-foreground">{LEGAL.operator}</p>
              <p>{LEGAL.location}</p>
              <p>
                Email:{" "}
                <a href={`mailto:${LEGAL.contactEmail}`} className="hover:text-foreground hover:underline">
                  {LEGAL.contactEmail}
                </a>
              </p>
            </address>
            <p>
              © {new Date().getFullYear()} {LEGAL.operator}. {brand.lockup} — bagian dari ekosistem Tanyopo, bersama
              UMKMpro AI.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

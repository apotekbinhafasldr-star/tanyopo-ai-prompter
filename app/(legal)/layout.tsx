import { LinoeLogo } from "@/components/brand/linoe-logo";
import { LegalHeader } from "@/features/legal/legal-header";
import { LegalLinks } from "@/features/legal/legal-links";
import { LEGAL } from "@/features/legal/legal-meta";
import { CompanyContact } from "@/features/legal/company-contact";

/**
 * Layout for the public legal pages only. Separate from the (marketing)
 * layout on purpose: the landing page keeps its own fixed hero header and
 * frozen footer, while legal pages get an in-flow header that never covers
 * the page title, and a footer that names the legal operator.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <LegalHeader />

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted-foreground md:flex-row md:justify-between sm:px-6">
          <div className="flex flex-col gap-4">
            <LinoeLogo size="sm" href={null} />
            <CompanyContact />
          </div>
          <div className="flex flex-col gap-3 md:items-end">
            <LegalLinks />
            <p>
              © {new Date().getFullYear()} {LEGAL.operator}. {LEGAL.product}.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

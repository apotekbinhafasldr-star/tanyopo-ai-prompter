import Link from "next/link";
import { LinoeLogo } from "@/components/brand/linoe-logo";
import { LegalHeader } from "@/features/legal/legal-header";
import { LegalLinks } from "@/features/legal/legal-links";
import { LEGAL } from "@/features/legal/legal-meta";

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
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <LinoeLogo size="sm" href={null} />
          <div className="flex flex-col gap-3">
            <LegalLinks />
            <p>
              <Link href="/help" className="hover:text-foreground hover:underline">
                Pusat Bantuan
              </Link>
            </p>
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
              © {new Date().getFullYear()} {LEGAL.operator}. {LEGAL.product}.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

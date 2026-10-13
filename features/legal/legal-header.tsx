import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LinoeLogo } from "@/components/brand/linoe-logo";

/**
 * Simple, in-flow header for the public legal pages (/privacy, /terms,
 * /data-deletion).
 *
 * The landing MarketingHeader is `fixed` and renders light-on-dark text
 * over the hero, which overlaps content and is unreadable on a plain page
 * background. This header is deliberately NOT fixed, always uses the normal
 * foreground colours, and is scoped to the legal route group only, so the
 * landing page header is untouched.
 */
export function LegalHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <LinoeLogo size="sm" />
        <nav aria-label="Navigasi utama" className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">Beranda</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Masuk</Link>
          </Button>
          <Button asChild size="sm" className="bg-gradient-to-r from-brand to-brand-2 hover:opacity-95">
            <Link href="/register">Daftar</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}

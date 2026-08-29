import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-[var(--radius-md)] bg-brand text-sm font-bold text-brand-foreground">
              T
            </span>
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Tanyopo AI Promoter
            </span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground sm:flex">
            <a href="#cara-kerja" className="hover:text-foreground">
              Cara Kerja
            </a>
            <a href="#kapabilitas" className="hover:text-foreground">
              Kapabilitas
            </a>
            <a href="#keamanan" className="hover:text-foreground">
              Keamanan
            </a>
            <a href="#harga" className="hover:text-foreground">
              Harga
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Masuk</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/register">Mulai Gratis</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Tanyopo Labs. Tanyopo AI Promoter.</p>
          <p>Bagian dari ekosistem Tanyopo — bersama UMKMpro AI.</p>
        </div>
      </footer>
    </div>
  );
}

import Link from "next/link";
import { MarketingHeader } from "@/features/marketing/marketing-header";
import { brand } from "@/features/marketing/brand";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <MarketingHeader />

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-brand to-brand-2 text-xs font-bold text-brand-foreground">
              {brand.initial}
            </span>
            <span className="font-medium text-foreground">{brand.name}</span>
          </Link>
          <p>
            © {new Date().getFullYear()} {brand.parentCompany}. Bagian dari ekosistem Tanyopo —
            bersama UMKMpro AI.
          </p>
        </div>
      </footer>
    </div>
  );
}

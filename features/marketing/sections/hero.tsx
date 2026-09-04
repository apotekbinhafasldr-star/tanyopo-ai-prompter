import Link from "next/link";
import { Sparkles, ArrowRight, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroVisual } from "@/features/marketing/components/hero-visual";
import { ProductVisual } from "@/features/marketing/components/product-visual";

export function Hero() {
  return (
    <section id="produk" className="relative scroll-mt-16 overflow-hidden">
      {/* Restrained gradient mesh — brand hues only, no neon. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, color-mix(in srgb, var(--brand) 12%, transparent), transparent 70%), radial-gradient(40% 35% at 85% 15%, color-mix(in srgb, var(--brand-2) 10%, transparent), transparent 70%)",
        }}
      />

      <div className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6 sm:pb-16 sm:pt-10 lg:pb-20 lg:pt-12">
        {/* One shared hero panel — text and visual both live inside the same
            bordered/gradient/shadowed card so they read as one integrated
            composition, not two independent page sections. */}
        <div className="relative overflow-hidden rounded-[1.75rem] border border-border bg-gradient-to-b from-brand-muted/70 via-surface to-surface shadow-[var(--shadow-lg)] sm:rounded-[2rem]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(55% 45% at 90% 0%, color-mix(in srgb, var(--brand-2) 16%, transparent), transparent 70%)",
            }}
          />

          <div className="relative grid gap-6 p-5 sm:gap-8 sm:p-8 lg:grid-cols-2 lg:items-center lg:gap-12 lg:p-12">
            {/* Left: message. Centered on mobile, left-aligned from lg up. */}
            <div className="flex flex-col items-center gap-4 text-center sm:gap-5 lg:items-start lg:text-left">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-[var(--shadow-sm)] backdrop-blur">
                <Sparkles className="size-3.5 text-brand" aria-hidden />
                AI Marketing & Growth Platform
              </div>

              <h1 className="max-w-xl text-4xl font-semibold leading-[1.05] tracking-[-0.02em] text-foreground sm:text-5xl lg:text-6xl">
                Marketing Lebih Cepat. Bisnis Melaju Lebih Jauh.{" "}
                <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">
                  Bersama LINOE.
                </span>
              </h1>

              <p className="max-w-md text-balance text-sm leading-relaxed text-muted-foreground sm:text-base">
                LINOE membantu Anda menganalisis produk, menyusun strategi, membuat konten,
                menjalankan campaign, memantau hasil, dan mengoptimasi pertumbuhan — semua dengan
                AI dalam satu platform.
              </p>

              <div className="flex w-full flex-col gap-3 pt-1 sm:w-auto sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="bg-gradient-to-r from-brand to-brand-2 shadow-[var(--shadow-glow)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgb(67_56_202_/_0.12),0_20px_48px_-12px_rgb(67_56_202_/_0.35)] motion-reduce:hover:translate-y-0 active:translate-y-0"
                >
                  <Link href="/register">
                    Mulai Promosikan
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="transition-all duration-300 hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-muted motion-reduce:hover:translate-y-0 active:translate-y-0"
                >
                  <a href="#cara-kerja">
                    <PlayCircle className="size-4" aria-hidden />
                    Lihat Cara Kerja
                  </a>
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Tidak perlu kartu kredit · Anda menyetujui setiap campaign sebelum tayang
              </p>
            </div>

            {/* Right: human visual + floating capability overlay — directly
                beneath the CTA on mobile with no section-like gap, inside
                the same panel. */}
            <HeroVisual />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-16">
        <p className="mb-6 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Bagaimana LINOE Bekerja
        </p>
        <ProductVisual />
      </div>
    </section>
  );
}

import Link from "next/link";
import { Sparkles, ArrowRight, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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

      <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 pb-10 pt-14 text-center sm:gap-6 sm:px-6 sm:pb-16 sm:pt-20">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-[var(--shadow-sm)] backdrop-blur">
          <Sparkles className="size-3.5 text-brand" aria-hidden />
          AI Marketing Command Center
        </div>

        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
          Turn Your Product Into{" "}
          <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">
            Growth.
          </span>
        </h1>
        <p className="text-lg font-medium text-muted-foreground sm:text-xl">
          Ubah Produk Menjadi Pertumbuhan.
        </p>

        <p className="max-w-xl text-balance text-sm text-muted-foreground sm:text-base">
          Tim marketing AI yang memahami produk Anda, menyusun strategi, membuat konten,
          menyiapkan campaign, menganalisis hasil, dan terus mengoptimasi — sementara Anda tetap
          memegang kendali penuh atas akun, izin, dan budget.
        </p>

        <div className="flex w-full flex-col gap-3 pt-1 sm:w-auto sm:flex-row">
          <Button
            asChild
            size="lg"
            className="bg-gradient-to-r from-brand to-brand-2 shadow-[var(--shadow-glow)] hover:opacity-95"
          >
            <Link href="/register">
              Mulai Promosikan
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#cara-kerja">
              <PlayCircle className="size-4" aria-hidden />
              Lihat Cara Kerja
            </a>
          </Button>
        </div>

        <p className="pt-1 text-xs text-muted-foreground">
          Tidak perlu kartu kredit · Anda menyetujui setiap campaign sebelum tayang
        </p>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
        <ProductVisual />
      </div>
    </section>
  );
}

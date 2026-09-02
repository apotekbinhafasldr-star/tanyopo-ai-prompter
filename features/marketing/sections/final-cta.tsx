import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/features/marketing/components/reveal";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-border py-16 sm:py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(50% 60% at 50% 50%, color-mix(in srgb, var(--brand) 8%, transparent), transparent 70%)",
        }}
      />
      <Reveal className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 text-center sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Siap mengubah produk Anda menjadi pertumbuhan?
        </h2>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
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
            <Link href="/login">Masuk</Link>
          </Button>
        </div>
      </Reveal>
    </section>
  );
}

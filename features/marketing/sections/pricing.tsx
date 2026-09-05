import { Sparkles } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

const PLANS = [
  { name: "Free", desc: "Untuk mulai mencoba" },
  { name: "Pro", desc: "Untuk satu bisnis yang serius bertumbuh" },
  { name: "Business", desc: "Untuk tim dengan banyak produk" },
  { name: "Growth", desc: "Untuk skala campaign yang lebih besar" },
  { name: "Agency", desc: "Untuk mengelola banyak klien" },
  { name: "Bundle UMKMpro", desc: "Untuk pengguna UMKMpro AI" },
];

export function Pricing() {
  return (
    <section id="harga" className="scroll-mt-16 border-t border-border py-14 sm:py-20">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <Reveal>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Harga
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground sm:text-base">
            Beberapa paket sedang kami siapkan — detail harga akan diumumkan sebelum peluncuran
            publik.
          </p>
        </Reveal>

        <Reveal className="mt-8 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-4 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className="flex flex-col items-center gap-1.5 rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5"
            >
              <Sparkles className="size-4 text-brand" aria-hidden />
              <p className="text-sm font-semibold text-foreground">{plan.name}</p>
              <p className="text-xs text-muted-foreground">{plan.desc}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/features/marketing/components/reveal";
import { DeviceShowcaseStack } from "@/features/marketing/components/device-showcase-mockup";

const FEATURES = [
  "AI analisis produk & target market",
  "Pembuatan konten & materi iklan",
  "Eksekusi campaign multi-channel",
  "Analitik real-time & rekomendasi",
  "Mudah digunakan, tidak perlu keahlian teknis",
];

/**
 * "FITUR UTAMA" device showcase — the one missing piece from the
 * founder's approved mockup: a product/dashboard device visual between
 * the Tanyopo Intelligence section's "Hasil Nyata untuk Pertumbuhan
 * Bisnis Anda" outcome strip and the AI Marketing Team section. New
 * file, new section — nothing in tanyopo-intelligence.tsx or ai-team.tsx
 * changes; this is inserted between them in
 * app/(marketing)/page.tsx and features/marketing/sections/index.tsx.
 *
 * The device mockup itself (`DeviceShowcaseStack`, imported from
 * features/marketing/components/device-showcase-mockup.tsx) is a
 * stylized CSS/SVG illustration, not a real screenshot — the repo has
 * no existing dashboard screenshot asset, and the founder's own brief
 * said not to invent fake product functionality, so the mini "screen"
 * content only reuses metric names already established elsewhere in
 * this codebase (ROAS / Konversi / CTR / Growth, the same four from
 * features/marketing/sections/analytics-showcase.tsx) rather than
 * depicting any specific real screen as an accurate reproduction.
 *
 * Desktop: device stack on the left, copy + feature list + CTA on the
 * right (`md:grid-cols-2`). Phone-width: device stack first, then copy
 * underneath — same DOM order serves both layouts, no `order-*` swap
 * needed. Light background with a restrained cyan/violet ambient glow,
 * matching the house style used by tanyopo-intelligence.tsx.
 */
export function DeviceShowcase() {
  return (
    <section className="relative overflow-hidden bg-background py-16 sm:py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(45% 45% at 12% 85%, color-mix(in srgb, #22d3ee 10%, transparent), transparent 70%), " +
            "radial-gradient(45% 45% at 88% 15%, color-mix(in srgb, #8b5cf6 10%, transparent), transparent 70%)",
        }}
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 md:grid-cols-2 md:gap-12">
        <Reveal className="w-full">
          <DeviceShowcaseStack />
        </Reveal>

        <Reveal className="flex flex-col items-start gap-4 text-left" delayMs={100}>
          <span className="text-xs font-semibold uppercase tracking-wide text-brand">FITUR UTAMA</span>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Semua yang Anda Butuhkan
            <br />
            dalam Satu Platform.
          </h2>
          <p className="max-w-md text-sm text-muted-foreground sm:text-base">
            Dari strategi, konten, campaign hingga analitik, semuanya terintegrasi dalam Tanyopo
            Intelligence.
          </p>
          <ul className="flex flex-col gap-2.5">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-foreground sm:text-base">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <Button
            asChild
            size="lg"
            className="mt-2 bg-gradient-to-r from-brand to-brand-2 shadow-[var(--shadow-glow)] hover:opacity-95"
          >
            <Link href="/register">
              Mulai Gratis Sekarang
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </Reveal>
      </div>
    </section>
  );
}

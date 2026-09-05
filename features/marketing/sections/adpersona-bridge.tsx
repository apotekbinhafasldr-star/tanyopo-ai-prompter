import { Clapperboard, Camera, UserRound, Fingerprint, PackageSearch, Sparkles } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

const EXAMPLES = [
  { icon: Clapperboard, label: "Video Iklan AI Realistis" },
  { icon: Camera, label: "Foto Produk AI" },
  { icon: UserRound, label: "AI Presenter" },
  { icon: Fingerprint, label: "Karakter Konsisten" },
  { icon: PackageSearch, label: "Product Showcase" },
];

/**
 * Ecosystem positioning only — Tanyopo AdPersona (heavy AI creative
 * production: video, AI presenters, consistent characters) is a separate
 * product from LINOE (marketing/distribution/analytics/optimization).
 * There is no AdPersona backend/API in this codebase to link to, so both
 * CTAs are intentionally non-interactive ("Segera Hadir") rather than a
 * fake link — LINOE works fully standalone; a user can upload their own
 * creative and never touch AdPersona at all. A deliberately darker,
 * gradient-forward treatment (vs. the page's mostly-white surfaces) marks
 * this as a distinct, premium "studio" moment rather than another card
 * grid — restrained to this one section, not applied page-wide.
 */
export function AdPersonaBridge() {
  return (
    <section className="border-t border-border py-14 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div
          className="relative overflow-hidden rounded-[var(--radius-xl)] px-5 py-10 text-center shadow-[var(--shadow-lg)] sm:px-10 sm:py-14"
          style={{ background: "linear-gradient(135deg, var(--ink) 0%, #1b1140 55%, var(--brand-2) 130%)" }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(45% 60% at 80% 0%, color-mix(in srgb, var(--brand-2) 40%, transparent), transparent 70%)",
            }}
          />

          <Reveal className="relative">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
              <Sparkles className="size-3.5" aria-hidden />
              Ekosistem Tanyopo
            </span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Buat Creative yang Benar-Benar Menarik
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-white/70 sm:text-base">
              Butuh foto atau video iklan yang lebih realistis? Buat dengan{" "}
              <strong className="text-white">Tanyopo AdPersona AI</strong> — studio creative AI,
              lalu promosikan dan optimalkan performanya melalui LINOE.
            </p>
          </Reveal>

          <Reveal className="relative mt-8 grid grid-cols-2 gap-3 sm:mt-10 sm:grid-cols-5 sm:gap-4">
            {EXAMPLES.map((item) => (
              <div
                key={item.label}
                className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-white/10 bg-white/[0.06] p-4 text-center backdrop-blur"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-2 text-white">
                  <item.icon className="size-4" aria-hidden />
                </span>
                <span className="text-xs font-medium text-white/90">{item.label}</span>
              </div>
            ))}
          </Reveal>

          <Reveal className="relative mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <span
              aria-disabled="true"
              className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-[var(--radius-md)] bg-gradient-to-r from-brand to-brand-2 px-5 py-2.5 text-sm font-semibold text-white opacity-90 sm:w-auto"
            >
              Buat Creative dengan AdPersona
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium">
                Segera Hadir
              </span>
            </span>
            <span
              aria-disabled="true"
              className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-[var(--radius-md)] border border-white/20 px-5 py-2.5 text-sm font-semibold text-white/80 sm:w-auto"
            >
              Lihat Contoh
            </span>
          </Reveal>

          <p className="relative mt-4 text-xs text-white/60">
            Tidak wajib — LINOE tetap berjalan penuh dengan creative yang Anda unggah sendiri.
          </p>
        </div>
      </div>
    </section>
  );
}

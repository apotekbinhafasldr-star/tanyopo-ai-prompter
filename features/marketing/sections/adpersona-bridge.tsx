import { Clapperboard, Camera, UserRound, Fingerprint, PackageSearch, Sparkles } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

const EXAMPLES = [
  { icon: Clapperboard, label: "Video Iklan AI Realistis" },
  { icon: Camera, label: "Foto Produk Profesional" },
  { icon: UserRound, label: "AI Presenter" },
  { icon: Fingerprint, label: "Karakter Konsisten" },
  { icon: PackageSearch, label: "Product Showcase" },
];

/**
 * Ecosystem positioning only — Tanyopo AdPersona (heavy AI creative
 * production: video, AI presenters, consistent characters) is a separate
 * product from LINOE (marketing/distribution/analytics/optimization).
 * There is no AdPersona backend/API in this codebase to link to, so the
 * CTA is intentionally non-interactive ("Segera Hadir") rather than a
 * fake link — LINOE works fully standalone; a user can upload their own
 * creative and never touch AdPersona at all.
 */
export function AdPersonaBridge() {
  return (
    <section className="border-t border-border bg-surface-muted/40 py-14 sm:py-20">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <Reveal>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5 text-brand" aria-hidden />
            Ekosistem Tanyopo
          </span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Buat Creative yang Lebih Menarik
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
            Untuk produksi foto dan video iklan AI yang lebih realistis, gunakan{" "}
            <strong className="text-foreground">Tanyopo AdPersona</strong> — studio creative AI
            yang dapat terhubung dengan LINOE.
          </p>
        </Reveal>

        <Reveal className="mt-8 grid grid-cols-2 gap-3 sm:mt-10 sm:grid-cols-5 sm:gap-4">
          {EXAMPLES.map((item) => (
            <div
              key={item.label}
              className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-border bg-surface p-4 text-center shadow-[var(--shadow-sm)]"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-brand-muted text-brand">
                <item.icon className="size-4" aria-hidden />
              </span>
              <span className="text-xs font-medium text-foreground">{item.label}</span>
            </div>
          ))}
        </Reveal>

        <Reveal className="mt-8 flex flex-col items-center gap-2">
          <span
            aria-disabled="true"
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-[var(--radius-md)] border border-border-strong bg-surface px-5 py-2.5 text-sm font-semibold text-muted-foreground"
          >
            Buat Creative dengan AdPersona
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium">
              Segera Hadir
            </span>
          </span>
          <p className="text-xs text-muted-foreground">
            Tidak wajib — LINOE tetap berjalan penuh dengan creative yang Anda unggah sendiri.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

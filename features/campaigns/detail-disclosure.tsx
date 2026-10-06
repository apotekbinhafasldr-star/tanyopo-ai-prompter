import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Progressive-disclosure wrapper for the full strategy detail ("AI di
 * belakang tetap lengkap").
 *
 * - `enabled=false`: returns the children untouched (a Fragment), so every
 *   non-Quick-Promote / non-DRAFT page renders exactly as before.
 * - `enabled=true`: wraps them in a native <details>, closed by default.
 *   Closed content stays in the DOM, so editors, selectors and forms inside
 *   are not unmounted and keep working once opened.
 */
export function DetailDisclosure({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <details className="group rounded-[var(--radius-lg)] border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-brand [&::-webkit-details-marker]:hidden">
        <span className="flex flex-col">
          <span>Lihat Detail Strategi</span>
          <span className="text-xs font-normal text-muted-foreground">
            Strategi AI lengkap, alasan channel, teks iklan, materi, dan jadwal
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="flex flex-col gap-6 border-t border-border p-4">{children}</div>
    </details>
  );
}

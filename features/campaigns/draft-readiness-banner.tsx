import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { CampaignReadiness, ReadinessTone } from "@/lib/campaigns/draft-readiness";

const TONE_BOX: Record<ReadinessTone, string> = {
  ready: "border-brand/30 bg-brand-muted/40",
  review: "border-warning/30 bg-warning-muted/40",
  blocked: "border-danger/30 bg-danger-muted/40",
  info: "border-border bg-surface",
};

const TONE_TEXT: Record<ReadinessTone, string> = {
  ready: "text-brand",
  review: "text-warning",
  blocked: "text-danger",
  info: "text-foreground",
};

const TONE_MARK: Record<ReadinessTone, string> = {
  ready: "Siap ditinjau",
  review: "Perlu pemeriksaan",
  blocked: "Belum siap",
  info: "Status",
};

/**
 * Honest status for the campaign page: one primary line for where the
 * campaign really is, the specific reasons when it is not ready, and a separate
 * "can it go live" line. Status is carried by words and an icon, never colour
 * alone. Presentational: reads a precomputed readiness, fetches nothing.
 */
export function DraftReadinessBanner({ readiness }: { readiness: CampaignReadiness }) {
  const { primary, draftReasons, reviewNote, launch } = readiness;
  const Icon = primary.tone === "ready" ? CheckCircle2 : primary.tone === "info" ? Info : AlertTriangle;

  return (
    <section
      aria-label="Status kesiapan campaign"
      data-testid="draft-readiness"
      data-stage={readiness.stage}
      className={`flex flex-col gap-3 rounded-[var(--radius-lg)] border p-4 ${TONE_BOX[primary.tone]}`}
    >
      <div className="flex flex-col gap-1">
        <p className={`flex items-start gap-2 text-base font-semibold ${TONE_TEXT[primary.tone]}`} data-testid="readiness-primary">
          <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="sr-only">{TONE_MARK[primary.tone]}: </span>
            {primary.label}
          </span>
        </p>
        {primary.detail ? <p className="text-sm text-foreground">{primary.detail}</p> : null}
      </div>

      {reviewNote ? (
        <p className="text-sm text-foreground" data-testid="readiness-review-note">
          {reviewNote}
        </p>
      ) : null}

      {draftReasons.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground" data-testid="readiness-draft-reasons">
          {draftReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}

      {launch ? (
        <div className="flex flex-col gap-1 border-t border-border pt-3" data-testid="readiness-launch">
          <p className="text-sm font-medium text-foreground" data-testid="readiness-launch-label">
            {launch.label}
          </p>
          {launch.reasons.length > 0 ? (
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-brand [&::-webkit-details-marker]:hidden">
                Lihat alasan ({launch.reasons.length})
              </summary>
              <ul className="flex list-disc flex-col gap-1 pb-1 pl-5 text-sm text-muted-foreground">
                {launch.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

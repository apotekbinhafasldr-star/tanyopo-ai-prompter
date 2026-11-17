import { Check, ChevronDown } from "lucide-react";
import { buildCampaignJourney, type JourneyStepState } from "@/lib/campaigns/journey";

const BAR: Record<JourneyStepState, string> = {
  done: "bg-brand",
  current: "bg-brand/50",
  attention: "bg-warning",
  upcoming: "bg-border",
};

const STATE_TEXT: Record<JourneyStepState, string> = {
  done: "selesai",
  current: "sekarang",
  attention: "perlu perhatian",
  upcoming: "berikutnya",
};

/**
 * Compact progress header for the campaign page: one line saying which stage
 * the campaign is in, one sentence saying what to do next, and the full list
 * of stages behind a native <details> so a 360px screen stays short. Status
 * is carried by text as well as colour.
 */
export function CampaignJourney({ status, hasProposal }: { status: string; hasProposal: boolean }) {
  const journey = buildCampaignJourney(status, hasProposal);

  return (
    <section
      aria-label="Tahap campaign"
      data-testid="campaign-journey"
      className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-border bg-surface p-4"
    >
      <p className="text-xs font-medium text-muted-foreground" data-testid="journey-position">
        Tahap {journey.currentIndex} dari {journey.steps.length}:{" "}
        <span className="text-foreground">{journey.currentLabel}</span>
      </p>
      <div className="flex gap-1" aria-hidden>
        {journey.steps.map((s) => (
          <span key={s.id} className={`h-1.5 flex-1 rounded-full ${BAR[s.state]}`} />
        ))}
      </div>
      <p className="text-sm text-foreground" data-testid="journey-next">
        {journey.nextAction}
      </p>
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-brand [&::-webkit-details-marker]:hidden">
          <span>Lihat semua tahap</span>
          <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <ol className="flex flex-col gap-1.5 pb-1 pt-1">
          {journey.steps.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm" data-state={s.state}>
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                  s.state === "done" ? "bg-brand text-white" : s.state === "attention" ? "bg-warning text-white" : "border border-border"
                }`}
                aria-hidden
              >
                {s.state === "done" ? <Check className="size-3" /> : null}
              </span>
              <span className={s.state === "upcoming" ? "text-muted-foreground" : "text-foreground"}>{s.label}</span>
              <span className="text-xs text-muted-foreground">· {STATE_TEXT[s.state]}</span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

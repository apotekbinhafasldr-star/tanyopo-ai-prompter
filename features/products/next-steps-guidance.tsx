import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface StepState {
  label: string;
  done: boolean;
  /** How to tell the user to get there — matches an existing tab label. */
  tabHint: string;
}

/**
 * Lightweight, always-on guidance for what to do after creating a product —
 * a success banner right after creation, plus a small checklist so a
 * first-time user always knows "what have I finished?" / "what's next?"
 * without a new page or a noisy wizard. Reuses the existing tabs (Overview,
 * Marketing Blueprint, Content, Campaigns, Analytics) as the destinations.
 */
export function NextStepsGuidance({
  justCreated,
  hasMedia,
  hasBlueprint,
  hasContent,
  hasCampaigns,
}: {
  justCreated: boolean;
  hasMedia: boolean;
  hasBlueprint: boolean;
  hasContent: boolean;
  hasCampaigns: boolean;
}) {
  const steps: StepState[] = [
    { label: "Foto/Video (opsional)", done: hasMedia, tabHint: "tab “Overview”" },
    { label: "Marketing Blueprint", done: hasBlueprint, tabHint: "tab “Marketing Blueprint”" },
    { label: "Content", done: hasContent, tabHint: "tab “Content”" },
    { label: "Campaign", done: hasCampaigns, tabHint: "tab “Campaigns”" },
  ];
  const nextStep = steps.find((s) => !s.done);

  if (!justCreated && !nextStep) return null;

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-brand/25 bg-brand-muted/60 p-4">
      {justCreated ? (
        <p className="text-sm font-medium text-brand">
          Produk berhasil dibuat. Ikuti langkah di bawah untuk mulai mempromosikannya.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
        {steps.map((step, i) => (
          <span key={step.label} className="flex items-center gap-2">
            {i > 0 ? (
              <span className="text-border-strong" aria-hidden>
                →
              </span>
            ) : null}
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
                step.done
                  ? "bg-success/15 text-success"
                  : step === nextStep
                    ? "bg-brand text-brand-foreground"
                    : "bg-surface text-muted-foreground",
              )}
            >
              {step.done ? <Check className="size-3" aria-hidden /> : null}
              {step.label}
            </span>
          </span>
        ))}
      </div>

      {nextStep ? (
        <p className="text-xs text-muted-foreground">
          Selanjutnya: buka {nextStep.tabHint} di bawah.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Semua langkah utama selesai — cek performa produk ini di tab &ldquo;Analytics&rdquo;.
        </p>
      )}
    </div>
  );
}

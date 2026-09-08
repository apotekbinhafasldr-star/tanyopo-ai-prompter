"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Sparkles, ImagePlus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

interface StepState {
  label: string;
  done: boolean;
  /** How to tell the user to get there — matches an existing tab label. */
  tabHint: string;
}

/**
 * Post-creation guidance. Real-user testing found the previous
 * text-only "Selanjutnya: buka tab X" hint left users guessing which
 * button to press next, so a just-created product now gets an explicit
 * primary/secondary/tertiary CTA block instead of a breadcrumb. The
 * ongoing progress checklist below it is unchanged and still shows for
 * any product with an unfinished step, not just right after creation.
 */
export function NextStepsGuidance({
  productId,
  justCreated,
  hasMedia,
  hasBlueprint,
  hasContent,
  hasCampaigns,
}: {
  productId: string;
  justCreated: boolean;
  hasMedia: boolean;
  hasBlueprint: boolean;
  hasContent: boolean;
  hasCampaigns: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);

  const steps: StepState[] = [
    { label: "Foto/Video (opsional)", done: hasMedia, tabHint: "tab “Overview”" },
    { label: "Marketing Blueprint", done: hasBlueprint, tabHint: "tab “Marketing Blueprint”" },
    { label: "Content", done: hasContent, tabHint: "tab “Content”" },
    { label: "Campaign", done: hasCampaigns, tabHint: "tab “Campaigns”" },
  ];
  const nextStep = steps.find((s) => !s.done);

  const showCta = justCreated && !dismissed;

  if (!showCta && !nextStep) return null;

  return (
    <div className="flex flex-col gap-4">
      {showCta ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-brand/25 bg-brand-muted/60 p-5">
          <p className="text-base font-semibold text-brand">Produk berhasil dibuat 🎉</p>
          <p className="text-sm text-foreground">
            LINOE akan membuat target audience, strategi, konten dan campaign untuk Anda.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="lg">
              <Link href={`/promote?product=${productId}`}>
                <Sparkles />
                Promosikan Produk Ini
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="#product-media">
                <ImagePlus />
                Tambah Foto/Video
              </Link>
            </Button>
            <Button variant="ghost" onClick={() => setDismissed(true)}>
              Lihat Detail Produk
              <ArrowRight />
            </Button>
          </div>
        </div>
      ) : null}

      {nextStep || !justCreated ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface-muted/60 p-4">
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
      ) : null}
    </div>
  );
}

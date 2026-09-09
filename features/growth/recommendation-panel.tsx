"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Sparkles, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateGrowthRecommendationAction } from "@/features/growth/actions";
import type { GrowthRecommendation } from "@/schemas/ai/growth-recommendation";

/**
 * "Rekomendasi LINOE" (Batch B6) — answers "apa yang sebaiknya saya
 * lakukan berikutnya?" from real tenant data. Ephemeral by design (see
 * generateGrowthRecommendationAction) — held only in this component's own
 * state, regenerated fresh every time the button is pressed.
 */
export function GrowthRecommendationPanel() {
  const [error, setError] = useState<string | null>(null);
  const [insufficientData, setInsufficientData] = useState(false);
  const [recommendation, setRecommendation] = useState<GrowthRecommendation | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    setError(null);
    setInsufficientData(false);
    startTransition(async () => {
      try {
        const result = await generateGrowthRecommendationAction();
        if (result.error) {
          setError(result.error);
        } else if (result.insufficientData) {
          setInsufficientData(true);
          setRecommendation(null);
        } else {
          setRecommendation(result.recommendation);
        }
      } catch {
        setError("Data belum dapat dimuat. Coba lagi beberapa saat.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {!recommendation && !insufficientData ? (
        <Button loading={pending} onClick={generate} className="w-full sm:w-auto">
          <Sparkles />
          Lihat Rekomendasi LINOE
        </Button>
      ) : null}

      {pending ? <p className="text-xs text-muted-foreground">LINOE sedang menyusun rekomendasi...</p> : null}

      {insufficientData ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-surface-muted p-3">
          <p className="text-sm text-foreground">
            LINOE membutuhkan lebih banyak data untuk memberikan rekomendasi pertumbuhan yang lebih spesifik.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline" className="min-h-11">
              <Link href="/products/new">Masukkan Data Awal</Link>
            </Button>
          </div>
        </div>
      ) : null}

      {recommendation ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-brand/30 bg-brand-muted/40 p-4">
          <div className="flex items-start gap-2">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <p className="text-sm text-foreground">{recommendation.summary}</p>
          </div>
          <ul className="flex flex-col gap-1.5 pl-5 text-sm text-foreground">
            {recommendation.next_actions.map((action, i) => (
              <li key={i} className="list-disc">
                {action}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="min-h-11 w-full sm:w-auto self-start" loading={pending} onClick={generate}>
            Perbarui Rekomendasi
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

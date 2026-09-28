"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { generateDemoBlueprintAction, type DemoBlueprintResult } from "@/features/demo/ai-actions";

export function DemoBlueprintGenerator({ productId }: { productId: string }) {
  const [result, setResult] = useState<DemoBlueprintResult | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <Button
        onClick={() => startTransition(async () => setResult(await generateDemoBlueprintAction(productId)))}
        loading={isPending}
      >
        <Sparkles className="size-4" aria-hidden />
        Buat Marketing Blueprint dengan AI
      </Button>

      {result && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Marketing Blueprint</p>
              <Badge variant={result.simulated ? "outline" : "brand"}>
                {result.simulated ? "Data Simulasi" : "AI Live (Demo)"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{result.summary}</p>
            <p className="text-sm text-foreground">
              <span className="font-medium">USP:</span> {result.usp}
            </p>
            <div>
              <p className="text-sm font-medium text-foreground">Manfaat utama:</p>
              <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">
                {result.benefits.map((benefit) => (
                  <li key={benefit}>{benefit}</li>
                ))}
              </ul>
            </div>
            <p className="text-sm text-muted-foreground">
              Persona target: {result.targetPersona} &middot; Channel rekomendasi: {result.recommendedChannel}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

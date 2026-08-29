"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateSeoRecommendationsAction } from "@/features/seo/actions";

export function GenerateRecommendationsButton({
  projectId,
  hasExisting,
}: {
  projectId: string;
  hasExisting: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={hasExisting ? "secondary" : "primary"}
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await generateSeoRecommendationsAction(projectId);
            if (result.error) {
              setError(result.error);
            }
          });
        }}
      >
        <Sparkles />
        {hasExisting ? "Buat Ulang dengan AI" : "Buat Rekomendasi dengan AI"}
      </Button>
      {pending ? (
        <p className="text-xs text-muted-foreground">AI sedang menganalisis peluang SEO...</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

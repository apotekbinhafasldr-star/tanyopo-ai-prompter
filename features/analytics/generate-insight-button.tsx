"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateAnalyticsInsightAction } from "@/features/analytics/actions";

export function GenerateInsightButton({ hasExisting }: { hasExisting: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={hasExisting ? "secondary" : "primary"}
        size="sm"
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await generateAnalyticsInsightAction();
            if (result.error) setError(result.error);
          });
        }}
      >
        <Sparkles />
        {hasExisting ? "Buat Ulang Insight" : "Buat Insight dengan AI"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateMarketingBlueprintAction } from "@/features/products/actions";

export function GenerateBlueprintButton({
  productId,
  hasExisting,
}: {
  productId: string;
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
            const result = await generateMarketingBlueprintAction(productId);
            if (result.error) {
              setError(result.error);
            }
          });
        }}
      >
        <Sparkles />
        {hasExisting ? "Buat Ulang dengan AI" : "Buat Blueprint dengan AI"}
      </Button>
      {pending ? (
        <p className="text-xs text-muted-foreground">AI sedang menyusun blueprint marketing...</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

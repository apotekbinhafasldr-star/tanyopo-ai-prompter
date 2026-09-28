"use client";

import { useState, useTransition } from "react";
import { PenSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { generateDemoContentAction, type DemoContentResult } from "@/features/demo/ai-actions";
import { DEMO_PRODUCTS } from "@/lib/demo/dataset";

export function DemoContentGenerator() {
  const [result, setResult] = useState<DemoContentResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const product = DEMO_PRODUCTS[0];

  return (
    <div className="flex flex-col gap-4">
      <Button
        onClick={() => startTransition(async () => setResult(await generateDemoContentAction(product.id)))}
        loading={isPending}
      >
        <PenSquare className="size-4" aria-hidden />
        Buat Caption untuk {product.name}
      </Button>

      {result && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Caption Instagram</p>
              <Badge variant={result.simulated ? "outline" : "brand"}>
                {result.simulated ? "Data Simulasi" : "AI Live (Demo)"}
              </Badge>
            </div>
            <p className="text-sm text-foreground">{result.caption}</p>
            <p className="text-sm text-muted-foreground">{result.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

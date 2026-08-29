import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * TANYOPO INTELLIGENCE card. Only ever renders real, tenant-scoped
 * insights or an explicit empty state — never fabricated examples, and
 * anything sourced from demo data must be labelled DEMO (see
 * docs/AI_SYSTEM.md). Phase 0 has no analytics pipeline yet, so this
 * always shows the empty state.
 */
export function AiInsightCard() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Sparkles className="size-4 text-brand" aria-hidden />
        <CardTitle>Tanyopo Intelligence</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <EmptyState
          title="Belum ada insight"
          description="Setelah Anda menjalankan campaign pertama, AI akan menampilkan insight nyata di sini — bukan data contoh."
        />
      </CardContent>
    </Card>
  );
}

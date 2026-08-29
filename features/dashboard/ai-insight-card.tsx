import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils/format";

export interface AiInsight {
  summary: string | null;
  top_channel: string | null;
  underperforming_channels: unknown;
  updated_at: string;
}

/**
 * TANYOPO INTELLIGENCE card. Only ever renders a real, tenant-scoped
 * insight persisted by the AnalyticsAgent (Phase 7,
 * features/analytics/actions.ts#generateAnalyticsInsightAction) or an
 * explicit empty state — never fabricated examples. Generation itself
 * happens on /analytics (where the underlying metrics/conversions data
 * lives); this card is read-only.
 */
export function AiInsightCard({ insight }: { insight: AiInsight | null }) {
  const underperforming = (insight?.underperforming_channels as string[] | undefined) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Sparkles className="size-4 text-brand" aria-hidden />
        <CardTitle>Tanyopo Intelligence</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {!insight?.summary ? (
          <EmptyState
            title="Belum ada insight"
            description="Buat insight AI di halaman Analytics setelah ada data campaign/konversi — bukan data contoh."
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-foreground">{insight.summary}</p>
            <div className="flex flex-wrap items-center gap-2">
              {insight.top_channel ? <Badge variant="success">Terbaik: {insight.top_channel}</Badge> : null}
              {underperforming.map((c) => (
                <Badge key={c} variant="warning">
                  Perlu perhatian: {c}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Diperbarui {formatDate(insight.updated_at)}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

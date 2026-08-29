import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface MetricCardProps {
  label: string;
  icon: LucideIcon;
  value?: string;
  hint?: string;
}

/**
 * Renders a metric tile. When `value` is omitted there is no marketing
 * data yet for this tenant — shows an honest empty state instead of a
 * fabricated number (dashboard rule: never show fake metrics).
 */
export function MetricCard({ label, icon: Icon, value, hint }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </div>
        {value ? (
          <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
        ) : (
          <p className="text-2xl font-semibold tracking-tight text-border-strong">—</p>
        )}
        <p className="text-xs text-muted-foreground">{hint ?? "Belum ada data"}</p>
      </CardContent>
    </Card>
  );
}

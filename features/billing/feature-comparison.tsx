import { Badge } from "@/components/ui/badge";
import { FEATURE_CATEGORIES, type FeatureAvailability } from "@/lib/billing/plans";

const STATUS_LABEL: Record<FeatureAvailability, string> = {
  AVAILABLE: "Tersedia",
  LIMITED: "Terbatas",
  COMING_SOON: "Segera tersedia",
};

const STATUS_VARIANT: Record<FeatureAvailability, "success" | "warning" | "outline"> = {
  AVAILABLE: "success",
  LIMITED: "warning",
  COMING_SOON: "outline",
};

/**
 * Batch B8 — one row per feature category, not a plan x category grid.
 * Audited (see lib/billing/plans.ts header) that no category here is
 * actually restricted by plan tier in the current codebase — a wide
 * table repeating the same status six times per row would also risk
 * horizontal overflow on mobile for no honest benefit. This list is the
 * same information without either problem.
 */
export function FeatureComparison() {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {FEATURE_CATEGORIES.map((row) => (
        <li key={row.category} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">{row.category}</span>
            <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
          </div>
          {row.note ? <p className="text-xs text-muted-foreground">{row.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

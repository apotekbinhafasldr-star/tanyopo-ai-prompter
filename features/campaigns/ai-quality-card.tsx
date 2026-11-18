import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { GATE_DISCLAIMER, type QualityGateResult, type QualityStatus } from "@/lib/ai/campaign-quality-gate";
import type { AiProvenance } from "@/lib/ai/provenance";

const STATUS_TEXT: Record<QualityStatus, string> = {
  PASS: "Lolos pemeriksaan otomatis",
  REVIEW: "Perlu ditinjau",
  FAIL: "Perbaiki sebelum diterbitkan",
};

const STATUS_VARIANT: Record<QualityStatus, "success" | "warning" | "danger"> = {
  PASS: "success",
  REVIEW: "warning",
  FAIL: "danger",
};

const DIM_TEXT: Record<QualityStatus, string> = { PASS: "Lolos", REVIEW: "Tinjau", FAIL: "Perbaiki" };

/**
 * Server component: where the strategy came from (real model / backup
 * model / unknown) and what the rule-based quality gate found. The detail is
 * in a native <details> so the top of a phone screen stays short.
 */
export function AiQualityCard({ provenance, quality }: { provenance: AiProvenance; quality: QualityGateResult }) {
  const provenanceVariant = provenance.kind === "MODEL" ? "brand" : provenance.kind === "FALLBACK_PROVIDER" ? "warning" : "neutral";

  return (
    <Card data-testid="ai-quality-card">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={provenanceVariant} data-testid="ai-provenance">
            {provenance.label}
          </Badge>
          <Badge variant={STATUS_VARIANT[quality.status]} data-testid="ai-quality-status">
            {STATUS_TEXT[quality.status]}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{provenance.detail}</p>

        <details className="group rounded-[var(--radius-md)] border border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span>
              Hasil pemeriksaan
              {quality.issues.length > 0 ? ` (${quality.issues.length} catatan)` : ""}
            </span>
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="flex flex-col gap-3 border-t border-border p-3">
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {quality.dimensions.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{d.label}</span>
                  <Badge variant={STATUS_VARIANT[d.status]}>{DIM_TEXT[d.status]}</Badge>
                </li>
              ))}
            </ul>
            {quality.issues.length > 0 ? (
              <ul className="flex flex-col gap-2" data-testid="ai-quality-issues">
                {quality.issues.map((issue, i) => (
                  <li key={`${issue.code}-${i}`} className="text-sm">
                    <span className={issue.severity === "block" ? "font-medium text-danger" : "font-medium text-warning"}>
                      {issue.severity === "block" ? "Perbaiki: " : "Tinjau: "}
                    </span>
                    {issue.message}
                    {issue.excerpt ? <span className="text-muted-foreground"> — “{issue.excerpt}”</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">{GATE_DISCLAIMER}</p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

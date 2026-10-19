import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  BREAK_EVEN_LABEL,
  BREAK_EVEN_NOTE,
  VERDICT_DISCLAIMER,
  type AdPerformanceVerdict,
  type AdVerdict,
} from "@/lib/ad-performance-verdict";

const VERDICT_BADGE: Record<AdVerdict, "neutral" | "info" | "success" | "danger" | "brand" | "warning"> = {
  MARGIN_TIDAK_SEHAT: "warning",
  DATA_BELUM_CUKUP: "neutral",
  LANJUT_UJI: "info",
  PEMENANG_AWAL: "success",
  STOP_LOSS: "danger",
  KANDIDAT_SCALING: "brand",
};

function fmt(n: number | null, suffix = "", digits = 2): string {
  return n === null ? "—" : `${n.toFixed(digits)}${suffix}`;
}

function fmtMoney(n: number | null, currency: string): string {
  if (n === null) return "—";
  const rounded = Math.round(n).toLocaleString("id-ID");
  return currency === "IDR" ? `Rp${rounded}` : `${currency} ${rounded}`;
}

/**
 * Renders one Ad Performance Verdict. Presentational only: it receives an
 * already-computed verdict and has no data access, no actions and no
 * approval hooks — the demo only ever *displays* a recommendation.
 */
export function AdVerdictCard({
  title,
  description,
  result,
  simulated = true,
  sourceLabel,
  currency = "IDR",
}: {
  title: string;
  description?: string;
  result: AdPerformanceVerdict;
  simulated?: boolean;
  /** Replaces the demo badge for non-demo data (e.g. manually typed metrics). */
  sourceLabel?: string;
  /** ISO currency used to format CPA; IDR renders as "Rp". */
  currency?: string;
}) {
  const { metrics } = result;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <div className="flex items-center gap-2">
            {simulated ? <Badge variant="outline">DATA SIMULASI / DEMO</Badge> : null}
            {!simulated && sourceLabel ? <Badge variant="outline">{sourceLabel}</Badge> : null}
            <Badge variant={VERDICT_BADGE[result.verdict]}>{result.label}</Badge>
          </div>
        </div>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground sm:grid-cols-4">
          <div>
            <dt>ROAS</dt>
            <dd className="font-medium text-foreground">{fmt(metrics.roas, "x")}</dd>
          </div>
          <div>
            <dt>{BREAK_EVEN_LABEL}</dt>
            <dd className="font-medium text-foreground">{fmt(metrics.breakEvenRoas, "x")}</dd>
          </div>
          <div>
            <dt>CPA</dt>
            <dd className="font-medium text-foreground">{fmtMoney(metrics.cpa, currency)}</dd>
          </div>
          <div>
            <dt>CTR</dt>
            <dd className="font-medium text-foreground">
              {metrics.ctr === null ? "—" : `${(metrics.ctr * 100).toFixed(2)}%`}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">{BREAK_EVEN_NOTE}</p>

        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {result.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Saran: </span>
          {result.recommendation}
        </p>
      </CardContent>
    </Card>
  );
}

export function AdVerdictDisclaimer() {
  return <p className="text-xs text-muted-foreground">{VERDICT_DISCLAIMER}</p>;
}

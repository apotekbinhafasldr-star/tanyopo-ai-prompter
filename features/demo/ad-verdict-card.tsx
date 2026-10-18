import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  VERDICT_DISCLAIMER,
  type AdPerformanceVerdict,
  type AdVerdict,
} from "@/lib/ad-performance-verdict";

const VERDICT_BADGE: Record<AdVerdict, "neutral" | "info" | "success" | "danger" | "brand"> = {
  DATA_BELUM_CUKUP: "neutral",
  LANJUT_UJI: "info",
  PEMENANG_AWAL: "success",
  STOP_LOSS: "danger",
  KANDIDAT_SCALING: "brand",
};

function fmt(n: number | null, suffix = "", digits = 2): string {
  return n === null ? "—" : `${n.toFixed(digits)}${suffix}`;
}

function fmtRp(n: number | null): string {
  return n === null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`;
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
}: {
  title: string;
  description?: string;
  result: AdPerformanceVerdict;
  simulated?: boolean;
}) {
  const { metrics } = result;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <div className="flex items-center gap-2">
            {simulated ? <Badge variant="outline">DATA SIMULASI / DEMO</Badge> : null}
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
            <dt>Break-even ROAS</dt>
            <dd className="font-medium text-foreground">{fmt(metrics.breakEvenRoas, "x")}</dd>
          </div>
          <div>
            <dt>CPA</dt>
            <dd className="font-medium text-foreground">{fmtRp(metrics.cpa)}</dd>
          </div>
          <div>
            <dt>CTR</dt>
            <dd className="font-medium text-foreground">
              {metrics.ctr === null ? "—" : `${(metrics.ctr * 100).toFixed(2)}%`}
            </dd>
          </div>
        </dl>

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

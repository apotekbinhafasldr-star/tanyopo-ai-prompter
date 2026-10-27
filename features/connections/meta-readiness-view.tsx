import { Badge } from "@/components/ui/badge";
import {
  unavailableReasonMessage,
  type MetaReadinessResult,
  type ReadinessCheckStatus,
  type ReadinessState,
} from "@/lib/connectors/meta-readiness";

/**
 * F-2a — presentation of a Meta ad-account readiness result. Pure rendering:
 * no data fetching, no state, no client-only APIs, so it is unit-testable with
 * `renderToStaticMarkup`. The wording is deliberately cautious:
 *  - READY never says "dana cukup" or "bisa tayang" — LINOE does not read the
 *    balance and Meta decides delivery;
 *  - UNKNOWN is never styled as success.
 */

const STATE_LABEL: Record<ReadinessState, string> = {
  READY: "Siap",
  NOT_READY: "Belum siap",
  UNKNOWN: "Belum bisa dipastikan",
};

const STATE_VARIANT: Record<ReadinessState, "success" | "danger" | "warning"> = {
  READY: "success",
  NOT_READY: "danger",
  UNKNOWN: "warning",
};

const CHECK_MARK: Record<ReadinessCheckStatus, { symbol: string; className: string; sr: string }> = {
  PASS: { symbol: "✓", className: "text-success", sr: "Lulus" },
  FAIL: { symbol: "✕", className: "text-danger", sr: "Gagal" },
  UNKNOWN: { symbol: "?", className: "text-warning", sr: "Belum pasti" },
};

export const READINESS_DISCLAIMER =
  "Pemeriksaan ini hanya membaca data dari Meta; tidak membuat atau menjalankan iklan. LINOE tidak membaca saldo atau batas belanja, dan biaya iklan dibayar langsung kepada Meta, bukan kepada LINOE.";

export function MetaReadinessView({ result }: { result: MetaReadinessResult }) {
  return (
    <div className="flex flex-col gap-2" data-testid="meta-readiness-result" data-state={result.state}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATE_VARIANT[result.state]}>{STATE_LABEL[result.state]}</Badge>
        <p className="text-xs text-foreground">{result.summary}</p>
      </div>

      {result.unavailableReason ? (
        <p className="text-xs text-muted-foreground">{unavailableReasonMessage(result.unavailableReason)}</p>
      ) : null}

      {result.checks.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {result.checks.map((check) => {
            const mark = CHECK_MARK[check.status];
            return (
              <li key={check.id} className="flex items-start gap-2 text-xs">
                <span className={`${mark.className} w-4 shrink-0 text-center font-semibold`} aria-hidden>
                  {mark.symbol}
                </span>
                <span>
                  <span className="sr-only">{mark.sr}: </span>
                  <span className="font-medium text-foreground">{check.label}.</span>{" "}
                  <span className="text-muted-foreground">{check.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {result.minDailyBudgetRaw !== null ? (
        <p className="text-xs text-muted-foreground">
          Budget harian minimum menurut Meta: {result.minDailyBudgetRaw} (angka mentah dalam satuan terkecil mata uang
          akun; belum dikonversi).
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">{READINESS_DISCLAIMER}</p>
    </div>
  );
}

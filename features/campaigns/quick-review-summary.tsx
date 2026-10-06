import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { channelLabel, formatCurrency, goalLabel } from "@/lib/utils/format";

export interface QuickReviewAllocation {
  channel: string;
  percentage: number;
}

export interface QuickReviewScheduleLine {
  channel: string;
  /** Human label such as "Sel, 19:00"; null = no specific time. */
  label: string | null;
  /** true = already saved on the channel campaign; false = LINOE suggestion only. */
  scheduled: boolean;
}

export interface QuickReviewSummaryProps {
  objective: string;
  dailyBudget: number | null;
  totalBudget: number | null;
  currency: string;
  allocation: QuickReviewAllocation[] | null;
  /** Used only when the stored proposal has no usable budget_allocation. */
  fallbackChannels: string[];
  headline: string | null;
  primaryText: string | null;
  cta: string | null;
  schedule: QuickReviewScheduleLine[];
  changeBudgetHref: string;
  /** The single primary CTA (SubmitForApprovalButton), rendered by the page inside its provider. */
  action: ReactNode;
}

/**
 * Pure budget wording — "harian" wins over "total", mirroring how the rest
 * of the app already picks the basis (daily_budget ?? total_budget).
 */
export function describeBudget(
  dailyBudget: number | null,
  totalBudget: number | null,
  currency: string,
): { primary: string; secondary: string | null } {
  const hasDaily = dailyBudget !== null && dailyBudget > 0;
  const hasTotal = totalBudget !== null && totalBudget > 0;

  if (hasDaily) {
    return {
      primary: `${formatCurrency(dailyBudget, currency)} per hari`,
      secondary: hasTotal ? `Batas total ${formatCurrency(totalBudget, currency)}` : null,
    };
  }
  if (hasTotal) {
    return { primary: `${formatCurrency(totalBudget, currency)} total`, secondary: null };
  }
  return { primary: "Belum diatur", secondary: null };
}

/**
 * Compact "Rencana Promosi Anda Siap" card for the DRAFT Quick Promote
 * review. Presentational only: it reads values the page already loaded and
 * never fetches, mutates, or duplicates an editor — all editing stays in
 * "Lihat Detail Strategi". Carries the #ringkasan-target-budget anchor.
 */
export function QuickReviewSummary({
  objective,
  dailyBudget,
  totalBudget,
  currency,
  allocation,
  fallbackChannels,
  headline,
  primaryText,
  cta,
  schedule,
  changeBudgetHref,
  action,
}: QuickReviewSummaryProps) {
  const budget = describeBudget(dailyBudget, totalBudget, currency);
  const basisAmount = dailyBudget && dailyBudget > 0 ? dailyBudget : totalBudget && totalBudget > 0 ? totalBudget : null;
  const basisLabel = dailyBudget && dailyBudget > 0 ? "/hari" : " total";
  const hasAllocation = !!allocation && allocation.length > 0;

  return (
    <Card id="ringkasan-target-budget" className="border-brand/30">
      <CardHeader>
        <CardTitle>Rencana Promosi Anda Siap</CardTitle>
        <p className="text-sm text-muted-foreground">
          Periksa ringkasan di bawah. Belum ada yang berjalan — tidak ada yang terkirim sebelum Anda
          menyetujui dan meluncurkan per channel.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-4">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Tujuan</dt>
            <dd className="text-sm font-medium text-foreground">{goalLabel(objective)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Budget</dt>
            <dd className="text-sm font-medium text-foreground">{budget.primary}</dd>
            {budget.secondary ? <dd className="text-xs text-muted-foreground">{budget.secondary}</dd> : null}
          </div>
        </dl>

        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Channel rekomendasi</p>
          {hasAllocation ? (
            <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-md)] border border-border">
              {allocation!.map((a) => (
                <li key={a.channel} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {channelLabel(a.channel)}
                    <Badge variant="brand">{a.percentage}%</Badge>
                  </span>
                  {basisAmount !== null ? (
                    <span className="text-xs text-muted-foreground">
                      ~{formatCurrency((basisAmount * a.percentage) / 100, currency)}
                      {basisLabel}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm font-medium text-foreground">
              {fallbackChannels.map(channelLabel).join(", ") || "—"}
            </p>
          )}
        </div>

        {headline || primaryText || cta ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">Pesan utama</p>
            <div className="rounded-[var(--radius-md)] border border-border p-3 text-sm">
              {headline ? <p className="font-medium text-foreground">{headline}</p> : null}
              {primaryText ? <p className="mt-1 line-clamp-3 text-muted-foreground">{primaryText}</p> : null}
              {cta ? (
                <p className="mt-2 text-xs text-foreground">
                  <span className="text-muted-foreground">Ajakan: </span>
                  {cta}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">Ringkasan jadwal</p>
          {schedule.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {schedule.map((s) => (
                <li key={s.channel} className="text-sm text-foreground">
                  <span className="font-medium">{channelLabel(s.channel)}</span>
                  <span className="text-muted-foreground">
                    {s.label
                      ? ` — ${s.scheduled ? "dijadwalkan" : "disarankan"} ${s.label}`
                      : " — waktu fleksibel"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Belum dijadwalkan — bisa diatur di detail strategi.</p>
          )}
        </div>

        {/* One primary CTA. Rendered by the page so it stays inside the
            existing CampaignSubmitProvider (single in-flight submission). */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button asChild variant="ghost" size="lg" className="w-full sm:w-auto">
            <Link href={changeBudgetHref}>
              <ArrowLeft />
              Ubah tujuan &amp; budget
            </Link>
          </Button>
          {action}
        </div>
      </CardContent>
    </Card>
  );
}

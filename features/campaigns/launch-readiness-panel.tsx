import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import type { InternalPreview } from "@/lib/campaigns/internal-preview";
import type { LaunchReadinessResult, LaunchReadinessStatus } from "@/lib/campaigns/launch-readiness";

/**
 * READ-ONLY panel: launch-readiness checklist + internal preview for a Meta
 * campaign. Pure presentation of already-computed data. It has no button,
 * form or action: it cannot launch, publish, activate or change anything, and
 * it never contacts Meta.
 */

export const READINESS_PANEL_DISCLAIMER =
  "Panel ini hanya menampilkan pemeriksaan internal LINOE dan tidak menghubungi Meta. Lulus pemeriksaan bukan jaminan iklan disetujui Meta, tayang, atau memberi hasil tertentu. Biaya iklan dibayar langsung kepada Meta.";

export const PREVIEW_DISCLAIMER =
  "Pratinjau internal dari rencana yang tersimpan di LINOE, bukan tampilan resmi iklan di Meta. Angka biaya hanyalah perkiraan dari budget Anda, bukan perkiraan jangkauan, klik, atau penjualan.";

export const NOT_AVAILABLE_NOTE =
  "Belum tersedia: audiens terstruktur (usia, minat, dan sejenisnya) serta metrik konversi. Keduanya memerlukan pengembangan lebih lanjut.";

const MARK: Record<LaunchReadinessStatus, { symbol: string; className: string; sr: string }> = {
  PASS: { symbol: "✓", className: "text-success", sr: "Lulus" },
  FAIL: { symbol: "✕", className: "text-danger", sr: "Belum lulus" },
  UNKNOWN: { symbol: "?", className: "text-warning", sr: "Belum pasti" },
};

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground break-words">{value ?? "Belum diisi"}</dd>
    </div>
  );
}

export function LaunchReadinessPanel({
  readiness,
  preview,
}: {
  readiness: LaunchReadinessResult;
  preview: InternalPreview;
}) {
  const ready = readiness.overall === "READY";
  const b = preview.budget;
  const e = preview.estimate;
  return (
    <Card data-testid="launch-readiness-panel" data-overall={readiness.overall}>
      <CardHeader>
        <CardTitle>Kesiapan Peluncuran Meta</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={ready ? "success" : "warning"}>{ready ? "Pemeriksaan lulus" : "Belum siap"}</Badge>
          <p className="text-sm text-foreground">{readiness.summary}</p>
        </div>

        <ul className="flex flex-col gap-2.5">
          {readiness.items.map((it) => {
            const mark = MARK[it.status];
            return (
              <li key={it.id} className="flex items-start gap-2 text-sm" data-item={it.id} data-status={it.status}>
                <span className={`${mark.className} w-4 shrink-0 text-center font-semibold`} aria-hidden>
                  {mark.symbol}
                </span>
                <span>
                  <span className="sr-only">{mark.sr}: </span>
                  <span className="font-medium text-foreground">{it.label}.</span>{" "}
                  <span className="text-muted-foreground">{it.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>

        <p className="text-xs text-muted-foreground">
          Perbaiki hal di atas lewat halaman{" "}
          <Link href="/connections" className="text-brand hover:underline">
            Connections
          </Link>{" "}
          atau Approval Center. {READINESS_PANEL_DISCLAIMER}
        </p>

        <section className="flex flex-col gap-4 border-t border-border pt-4" aria-label="Pratinjau internal">
          <h3 className="text-sm font-semibold text-foreground">Pratinjau Internal</h3>
          {!preview.hasProposal ? (
            <p className="text-sm text-muted-foreground">Belum ada proposal AI yang tersimpan untuk dipratinjau.</p>
          ) : null}

          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Strategi</h4>
            <dl className="flex flex-col gap-2">
              <Row label="Positioning" value={preview.strategy.positioning} />
              <Row label="Sudut pemasaran" value={preview.strategy.marketingAngle} />
              <Row label="Proposisi nilai" value={preview.strategy.valueProposition} />
            </dl>
          </div>

          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Materi iklan</h4>
            <dl className="flex flex-col gap-2">
              <Row label="Judul" value={preview.creative.headline} />
              <Row label="Teks utama" value={preview.creative.primaryText} />
              <Row label="Ajakan (CTA)" value={preview.creative.cta} />
              <Row label="Konsep visual" value={preview.creative.concept} />
            </dl>
          </div>

          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audiens</h4>
            <dl className="flex flex-col gap-2">
              <Row label="Ringkasan" value={preview.audience.summary} />
              <Row label="Catatan Anda" value={preview.audience.notes} />
              <Row label="Lokasi" value={preview.audience.location} />
              <Row label="Bahasa" value={preview.audience.language} />
            </dl>
          </div>

          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Budget &amp; perkiraan biaya</h4>
            <dl className="flex flex-col gap-2">
              <Row label="Budget harian" value={b.dailyBudget !== null ? formatCurrency(b.dailyBudget, b.currency) : null} />
              <Row label="Budget total" value={b.totalBudget !== null ? formatCurrency(b.totalBudget, b.currency) : null} />
              <Row label="Porsi Facebook + Instagram" value={b.metaSharePercent !== null ? `${b.metaSharePercent}%` : null} />
              <Row
                label="Perkiraan budget harian di Meta"
                value={b.metaDailyAmount !== null ? formatCurrency(b.metaDailyAmount, b.currency) : null}
              />
              <Row label="Durasi" value={e.durationDays !== null ? `${e.durationDays} hari` : null} />
              <Row
                label="Perkiraan biaya selama durasi"
                value={e.metaCostForDuration !== null ? formatCurrency(e.metaCostForDuration, b.currency) : null}
              />
            </dl>
          </div>

          <p className="text-xs text-muted-foreground">{PREVIEW_DISCLAIMER}</p>
          <p className="text-xs text-muted-foreground">{NOT_AVAILABLE_NOTE}</p>
        </section>
      </CardContent>
    </Card>
  );
}

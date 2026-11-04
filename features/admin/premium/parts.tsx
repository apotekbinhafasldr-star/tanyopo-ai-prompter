import Link from "next/link";
import type { ReactNode } from "react";
import { DEMO_LABEL } from "@/lib/admin/demo-data";
import type { KpiView, TrendView } from "@/lib/admin/dashboard-model";
import { PREMIUM_CSS, PREMIUM_CSS_EXTRA } from "./theme";
import { AreaSpark } from "./visuals";

/** Wrapper that scopes the navy/cyan/blue theme to the finance screens only. */
export function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="fin" data-testid="fin-frame">
      <style>{PREMIUM_CSS + PREMIUM_CSS_EXTRA}</style>
      {children}
    </div>
  );
}

export function Hero({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="fin-hero">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}

/**
 * Headline of the finance page: a dark hero with the operating result as one large figure, the change
 * against last month, three supporting figures and the cash curve. Chart values are drawing-only;
 * every label the reader sees is the exact text from the model.
 */
export function ResultHero({ result, revenue, expenses, cash, label }: { result: KpiView; revenue: KpiView; expenses: KpiView; cash: KpiView | undefined; label: string }) {
  const neg = result.amount.text.startsWith("-") || result.amount.value < 0;
  const t = result.trend;
  const tone = t.kind === "UP" || t.kind === "DOWN" ? trendTone(t, result.upIsGood) : "flat";
  return (
    <section className="fin-rh" data-testid={`kpi-${result.id}`}>
      <h1>{label}</h1>
      <p className={`big${neg ? " neg" : ""}`}>{result.amount.text}</p>
      {t.kind === "UP" || t.kind === "DOWN" ? (
        <span className={`delta ${tone}`}>
          <span aria-hidden>{t.kind === "UP" ? "▲" : "▼"}</span> {t.text} dibanding bulan lalu
        </span>
      ) : t.kind === "NEW" ? (
        <span className="delta flat">Baru bulan ini</span>
      ) : (
        <span className="delta flat">{result.hint}</span>
      )}
      <div className="tri">
        <div>
          <small>Pendapatan</small>
          <strong>{revenue.amount.text}</strong>
        </div>
        <div>
          <small>Beban</small>
          <strong>{expenses.amount.text}</strong>
        </div>
        {cash ? (
          <div>
            <small>Kas dan bank</small>
            <strong>{cash.amount.text}</strong>
          </div>
        ) : null}
      </div>
      {cash && cash.spark.length >= 2 ? (
        <div className="area">
          <AreaSpark values={cash.spark} color="#8f86ff" id="fin-hero-cash" height={92} label="Saldo kas akhir bulan" />
        </div>
      ) : null}
    </section>
  );
}

/** Must appear on every screen that shows demo data. */
export function DemoNotice() {
  return (
    <div className="fin-demo" role="note" data-testid="demo-banner">
      <span>
        {DEMO_LABEL}. Migrasi database belum diterapkan, jadi semua angka di sini contoh fiktif. Laporan masih draf.
      </span>
    </div>
  );
}

export function Chip({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <Link href={href} className="fin-chip" aria-current={current ? "true" : undefined} prefetch={false}>
      {children}
    </Link>
  );
}

export function Badge({ tone, children }: { tone: "good" | "bad" | "warn" | "info" | "brand" | "mute"; children: ReactNode }) {
  return <span className={`fin-badge ${tone}`}>{children}</span>;
}

export function Card({ title, sub, children }: { title?: string; sub?: string; children: ReactNode }) {
  return (
    <section className="fin-card">
      {title ? <h2>{title}</h2> : null}
      {sub ? <p className="sub">{sub}</p> : null}
      {children}
    </section>
  );
}

export function Row({ label, value, total, negative }: { label: string; value: string; total?: boolean; negative?: boolean }) {
  const neg = negative ?? value.startsWith("-");
  return (
    <div className={`fin-row${total ? " total" : ""}`}>
      <span>{label}</span>
      <span className={`n${neg ? " neg" : ""}`}>{value}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="fin-empty" role="status" data-testid="empty-state">
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="fin-check">
      <span className={`ic ${ok ? "ok" : "no"}`} aria-hidden>{ok ? "✓" : "!"}</span>
      <span>
        {label} <span className="sr-only">{ok ? "(lulus)" : "(perlu dicek)"}</span>
        {detail ? <small>{detail}</small> : null}
      </span>
    </div>
  );
}

function trendTone(t: TrendView, upIsGood: boolean): "good" | "bad" | "flat" {
  if (t.kind === "UP") return upIsGood ? "good" : "bad";
  if (t.kind === "DOWN") return upIsGood ? "bad" : "good";
  return "flat";
}

const SPARK_COLOR: Record<string, string> = { revenue: "#0e9f6e", expenses: "#d9483b", result: "#4338ca", cash: "#4338ca" };

export function KpiCard({ kpi }: { kpi: KpiView }) {
  const t = kpi.trend;
  return (
    <div className="fin-card fin-kpi" data-testid={`kpi-${kpi.id}`}>
      <p className="k">{kpi.label}</p>
      <p className={`v${kpi.amount.text.startsWith("-") ? " neg" : ""}`}>{kpi.amount.text}</p>
      {t.kind === "NONE" ? null : (
        <span className={`fin-trend ${trendTone(t, kpi.upIsGood)}`}>
          <span aria-hidden>{t.kind === "UP" ? "▲" : t.kind === "DOWN" ? "▼" : "●"}</span>
          {t.kind === "UP" || t.kind === "DOWN" ? `${t.text} vs bulan lalu` : t.kind === "NEW" ? "Baru bulan ini" : "Tetap"}
        </span>
      )}
      <p className="h">{kpi.hint}</p>
      {kpi.spark.length >= 2 ? (
        <div className="sp">
          <AreaSpark values={kpi.spark} color={SPARK_COLOR[kpi.id] ?? "#4338ca"} id={`fin-sp-${kpi.id}`} height={36} />
        </div>
      ) : null}
    </div>
  );
}

export function Skeleton({ height = 90 }: { height?: number }) {
  return <div className="fin-skel" style={{ height }} aria-hidden />;
}

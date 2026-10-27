"use client";

import { useId, useState } from "react";

/**
 * Hand-built SVG charts (no chart library, so nothing to install or audit). Numbers are used
 * ONLY to place marks; every figure shown to the reader is an exact string prepared on the
 * server. Interactive by tap, hover or keyboard: choose a month with the buttons below the
 * chart and the details panel follows.
 */
export interface ChartPoint {
  readonly key: string;
  readonly label: string;
  readonly short: string;
  readonly revenue: { text: string; value: number };
  readonly expenses: { text: string; value: number };
  readonly net: { text: string; value: number };
  readonly cash: { text: string; value: number };
}

const W = 360;
const H = 190;
const PAD = { l: 8, r: 8, t: 14, b: 26 };

function scale(values: number[]) {
  const max = Math.max(1, ...values, 0);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const y = (v: number) => PAD.t + ((max - v) / span) * (H - PAD.t - PAD.b);
  return { y, zero: y(0) };
}

export function TrendChart({ points, initialKey }: { points: readonly ChartPoint[]; initialKey: string }) {
  const [active, setActive] = useState(points.some((p) => p.key === initialKey) ? initialKey : points[points.length - 1]?.key);
  const [mode, setMode] = useState<"flow" | "cash">("flow");
  const uid = useId();
  if (points.length === 0) return null;
  const idx = Math.max(0, points.findIndex((p) => p.key === active));
  const cur = points[idx];
  const slot = (W - PAD.l - PAD.r) / points.length;
  const cx = (i: number) => PAD.l + slot * i + slot / 2;

  const flowScale = scale(points.flatMap((p) => [p.revenue.value, p.expenses.value, p.net.value]));
  const cashScale = scale(points.map((p) => p.cash.value));
  const barW = Math.min(26, slot / 3);

  return (
    <div className="fin-chart">
      <div className="fin-seg" role="group" aria-label="Jenis grafik">
        <button type="button" aria-pressed={mode === "flow"} onClick={() => setMode("flow")}>Pendapatan vs beban</button>
        <button type="button" aria-pressed={mode === "cash"} onClick={() => setMode("cash")}>Saldo kas</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${uid}-t`}>
        <title id={`${uid}-t`}>{mode === "flow" ? "Pendapatan dan beban per bulan" : "Saldo kas akhir bulan"}</title>
        {points.map((p, i) => (
          <g key={p.key} onClick={() => setActive(p.key)} onMouseEnter={() => setActive(p.key)} style={{ cursor: "pointer" }}>
            <rect x={PAD.l + slot * i} y={PAD.t - 6} width={slot} height={H - PAD.t - PAD.b + 6} fill={i === idx ? "#2563eb" : "transparent"} opacity={0.08} />
            {mode === "flow" ? (
              <>
                <rect x={cx(i) - barW - 2} width={barW} y={Math.min(flowScale.y(p.revenue.value), flowScale.zero)} height={Math.abs(flowScale.zero - flowScale.y(p.revenue.value))} rx={3} fill="#2563eb" />
                <rect x={cx(i) + 2} width={barW} y={Math.min(flowScale.y(p.expenses.value), flowScale.zero)} height={Math.abs(flowScale.zero - flowScale.y(p.expenses.value))} rx={3} fill="#0b1f3a" />
                <circle cx={cx(i)} cy={flowScale.y(p.net.value)} r={4.5} fill="#06b6d4" stroke="#fff" strokeWidth={1.5} />
              </>
            ) : (
              <rect x={cx(i) - barW} width={barW * 2} y={Math.min(cashScale.y(p.cash.value), cashScale.zero)} height={Math.abs(cashScale.zero - cashScale.y(p.cash.value))} rx={4} fill="#06b6d4" />
            )}
            <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize={11} fontWeight={i === idx ? 800 : 500} fill="#566780">{p.short}</text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={(mode === "flow" ? flowScale : cashScale).zero} y2={(mode === "flow" ? flowScale : cashScale).zero} stroke="#dbe3ef" />
      </svg>
      <div className="fin-legend" aria-hidden>
        {mode === "flow" ? (
          <>
            <span><i style={{ background: "#2563eb" }} />Pendapatan</span>
            <span><i style={{ background: "#0b1f3a" }} />Beban</span>
            <span><i style={{ background: "#06b6d4", borderRadius: 99 }} />Hasil</span>
          </>
        ) : (
          <span><i style={{ background: "#06b6d4" }} />Kas akhir bulan</span>
        )}
      </div>
      <div className="fin-seg" role="group" aria-label="Pilih bulan">
        {points.map((p) => (
          <button key={p.key} type="button" aria-pressed={p.key === cur.key} onClick={() => setActive(p.key)}>{p.short}</button>
        ))}
      </div>
      <div className="fin-tip" aria-live="polite" data-testid="chart-tip">
        <strong>{cur.label}</strong>
        {mode === "flow" ? (
          <>
            <div><span>Pendapatan</span><span>{cur.revenue.text}</span></div>
            <div><span>Beban</span><span>{cur.expenses.text}</span></div>
            <div><span>Hasil</span><span>{cur.net.text}</span></div>
          </>
        ) : (
          <div><span>Kas akhir</span><span>{cur.cash.text}</span></div>
        )}
      </div>
    </div>
  );
}

import type { ShareView } from "@/lib/admin/dashboard-model";

/**
 * Small hand-built SVG visuals (no chart library). They are plain server components: numbers are used
 * only to place marks; every figure the reader sees is an exact string prepared in the model.
 */

export const SLICE_COLORS = ["#4338ca", "#38bdf8", "#0f1330", "#c98a00", "#0e9f6e", "#9aa4ba"];

function smooth(pts: ReadonlyArray<readonly [number, number]>): string {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = ((x0 + x1) / 2).toFixed(1);
    d += ` C${cx},${y0.toFixed(1)} ${cx},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/** Smooth area/line chart that stretches to its container width. Renders nothing for fewer than 2 points. */
export function AreaSpark({ values, color, id, height = 40, label }: { values: readonly number[]; color: string; id: string; height?: number; label?: string }) {
  if (values.length < 2) return null;
  const w = 200;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i): [number, number] => [(i * w) / (values.length - 1), pad + (1 - (v - min) / range) * (height - pad * 2 - 4)]);
  const line = smooth(pts);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ display: "block" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.4} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L${last[0].toFixed(1)},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Ring split by `share` (0..1). The centre shows exact text passed by the caller. */
export function Donut({ items, centerLabel, centerValue }: { items: readonly ShareView[]; centerLabel: string; centerValue: string }) {
  const r = 58;
  const c = 2 * Math.PI * r;
  const starts = items.map((_, i) => items.slice(0, i).reduce((acc, it) => acc + c * it.share, 0));
  return (
    <div className="fin-ring">
      <svg viewBox="0 0 150 150" width={150} height={150} role="img" aria-label={`${centerLabel}: ${items.map((i) => `${i.name} ${i.pct}`).join(", ")}`}>
        <circle cx={75} cy={75} r={r} fill="none" stroke="#eef0f7" strokeWidth={20} />
        {items.map((it, i) => {
          const dash = Math.max(c * it.share - 2, 0);
          return (
            <circle
              key={it.key}
              cx={75}
              cy={75}
              r={r}
              fill="none"
              stroke={SLICE_COLORS[i % SLICE_COLORS.length]}
              strokeWidth={20}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-starts[i]}
              transform="rotate(-90 75 75)"
            />
          );
        })}
      </svg>
      <div className="ctr">
        <small>{centerLabel}</small>
        <b>{centerValue}</b>
      </div>
    </div>
  );
}

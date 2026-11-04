/**
 * Scoped theme for the finance / admin screens. Everything is under `.fin`, so no other screen of the
 * app is affected.
 *
 * Direction: a quiet ledger, not a grid of cards. One accent (indigo, the LINOE brand), figures set
 * large and tight, sections separated by hairlines instead of boxes, tabs instead of pills. Colour
 * carries meaning only: mint = good, coral = bad, amber = caution. Variable names are kept stable
 * because the guide wizard and tax screens ship their own CSS that reads them.
 */
export const PREMIUM_CSS = `
.fin{--navy:#0f1330;--navy2:#2a2f55;--blue:#4338ca;--cyan:#4338ca;--cyan-soft:#eceafd;--bg:#f6f7fb;--card:#fff;--ink:#0f1330;--mute:#647089;--line:#e4e7f0;--good:#0a7d57;--good-bg:#e3f6ee;--bad:#cc3a2e;--bad-bg:#fdeceb;--warn:#8a5a00;--warn-bg:#fdf3dc;
font-family:var(--font-geist-sans),ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:transparent;padding:0;display:flex;flex-direction:column;gap:14px;font-variant-numeric:tabular-nums;line-height:1.45;min-width:0;max-width:100%;-webkit-font-smoothing:antialiased}
.fin *{box-sizing:border-box}
.fin>*{min-width:0;max-width:100%}
.fin a{color:inherit;text-decoration:none}
.fin h1,.fin h2,.fin h3,.fin p{margin:0}

.fin-hero{display:flex;flex-direction:column;gap:4px;padding:4px 0 0}
.fin-hero h1{font-size:26px;font-weight:600;letter-spacing:-.03em;line-height:1.15}
.fin-hero p{font-size:14px;color:var(--mute);line-height:1.45}

.fin-demo{display:flex;gap:8px;align-items:baseline;background:var(--warn-bg);color:var(--warn);border-radius:10px;padding:8px 12px;font-size:12.5px;line-height:1.4}
.fin-demo b{flex:0 0 auto;font-weight:700}
.fin-demo b::after{content:"."}

.fin-chips{display:flex;gap:22px;overflow-x:auto;max-width:100%;padding:0;border-bottom:1px solid var(--line);scrollbar-width:none;-webkit-overflow-scrolling:touch}
.fin-chips::-webkit-scrollbar{display:none}
.fin-chip{flex:0 0 auto;min-height:44px;display:inline-flex;align-items:center;gap:6px;padding:0 0 2px;border-bottom:2px solid transparent;margin-bottom:-1px;font-size:14px;font-weight:500;color:var(--mute);white-space:nowrap}
.fin-chip[aria-current="true"]{color:var(--ink);font-weight:600;border-bottom-color:var(--blue)}
.fin-chip small{font-size:12px;color:var(--mute);font-weight:500}

.fin-label{font-size:12.5px;font-weight:600;color:var(--mute);padding-top:6px}

/* result hero: the one memorable block of the finance page */
.fin-rh{background:radial-gradient(120% 140% at 0% 0%,#161c4a 0%,#0b1030 60%);color:#fff;border-radius:20px;padding:18px 16px 0;overflow:hidden;display:flex;flex-direction:column;align-items:flex-start;min-width:0}
.fin-rh h1{font-size:13px;font-weight:500;color:#aab2de}
.fin-rh .big{font-size:clamp(32px,10vw,44px);font-weight:600;letter-spacing:-.04em;line-height:1.05;margin-top:6px;max-width:100%;overflow-wrap:anywhere}
.fin-rh .big.neg{color:#ff8a7d}
.fin-rh .delta{display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-size:13px;font-weight:600;padding:4px 10px;border-radius:99px;background:rgba(255,255,255,.12);color:#dfe3fa}
.fin-rh .delta.good{background:rgba(52,211,153,.16);color:#7be8bd}
.fin-rh .delta.bad{background:rgba(255,138,125,.16);color:#ffb4ab}
.fin-rh .tri{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:16px;width:100%}
.fin-rh .tri div{display:flex;flex-direction:column;gap:2px;padding-top:10px;border-top:1px solid rgba(255,255,255,.14);min-width:0}
.fin-rh .tri small{font-size:12px;color:#9aa3d4}
.fin-rh .tri strong{font-size:13.5px;font-weight:600;white-space:nowrap}
.fin-rh .area{margin:10px -16px 0;align-self:stretch}

/* panels */
.fin-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px;min-width:0}
.fin-card h2{font-size:15px;font-weight:600;letter-spacing:-.01em}
.fin-card .sub{font-size:12.5px;color:var(--mute);line-height:1.45}

/* KPI tiles with a sparkline */
.fin-top{display:flex;flex-direction:column;gap:12px}
.fin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.fin-grid>.fin-kpi:last-child:nth-child(odd){grid-column:1/-1}
.fin .fin-kpi{padding:13px 13px 8px;gap:2px;border-radius:16px;box-shadow:none}
.fin-kpi .k{font-size:12.5px;color:var(--mute);min-height:34px}
.fin-kpi .v{font-size:19px;font-weight:600;letter-spacing:-.02em;white-space:nowrap;margin-top:2px}
.fin-kpi .v.neg{color:var(--bad)}
.fin-kpi .h{font-size:12px;color:var(--mute)}
.fin-kpi .sp{margin:auto -4px 0;padding-top:6px}
.fin-trend{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;white-space:nowrap}
.fin-trend.good{color:var(--good)}
.fin-trend.bad{color:var(--bad)}
.fin-trend.flat{color:var(--mute)}

/* breakdowns */
.fin-duo{display:flex;flex-direction:column;gap:12px}
.fin-donut{display:flex;gap:16px;align-items:center}
.fin-ring{flex:0 0 150px;position:relative;width:150px;height:150px}
.fin-ring .ctr{position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:0 26px}
.fin-ring small{font-size:11.5px;color:var(--mute)}
.fin-ring b{font-size:13px;font-weight:600;letter-spacing:-.02em;line-height:1.2}
.fin-donut ul{list-style:none;margin:0;padding:0;display:grid;gap:12px;flex:1;min-width:0}
.fin-donut li{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:2px 8px;align-items:baseline;font-size:13.5px}
.fin-donut li i{width:10px;height:10px;border-radius:3px;align-self:center}
.fin-donut li b{font-weight:600}
.fin-donut li span{grid-column:2/-1;color:var(--mute);font-size:12px}
.fin-insight{margin-top:6px;padding:12px 14px;border-radius:12px;background:#f4f3ff;color:#2d2a7a;font-size:13px;line-height:1.5}
.fin-bars{display:grid}
.fin-bars .r{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.fin-bars .n{font-size:14px;font-weight:500;overflow-wrap:anywhere}
.fin-bars .b{position:relative;height:26px;background:#eef0f7;border-radius:7px;overflow:hidden}
.fin-bars .b i{position:absolute;left:0;top:0;bottom:0;background:#c9c5f5;border-radius:7px}
.fin-bars .b i.top{background:linear-gradient(90deg,#4338ca,#7c74e8)}
.fin-bars .b b{position:absolute;right:8px;top:0;bottom:0;display:flex;align-items:center;font-size:12.5px;font-weight:600;color:var(--ink)}

.fin-chart{display:flex;flex-direction:column;gap:10px}
.fin-chart svg{width:100%;height:auto;display:block;touch-action:manipulation}
.fin-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--mute)}
.fin-legend i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:0}
.fin-seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:6px}
.fin-seg button{min-height:44px;border-radius:10px;border:1px solid var(--line);background:#fff;font:inherit;font-size:13.5px;font-weight:600;color:var(--navy2);cursor:pointer}
.fin-seg button[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:#fff}
.fin-tip{background:var(--ink);color:#fff;border-radius:12px;padding:12px 14px;font-size:13.5px;display:flex;flex-direction:column;gap:4px}
.fin-tip div{display:flex;justify-content:space-between;gap:12px}
.fin-tip span:first-child{color:#b9c0dc}

.fin-row{display:flex;justify-content:space-between;gap:12px;align-items:baseline;padding:11px 0;border-bottom:1px solid var(--line);font-size:14.5px}
.fin-row:last-child{border-bottom:0}
.fin-row span:first-child{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;color:#2a3350}
.fin-row .n{flex:0 0 auto;font-weight:600;text-align:right;white-space:nowrap}
.fin-row.total{font-weight:700;border-top:1.5px solid var(--ink);border-bottom:0;margin-top:2px;padding-top:12px}
.fin-row.total span:first-child{color:var(--ink)}
.fin-row .n.neg{color:var(--bad)}

.fin-badge{display:inline-flex;align-items:center;gap:4px;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:600;white-space:nowrap}
.fin-badge.good{background:var(--good-bg);color:var(--good)}
.fin-badge.bad{background:var(--bad-bg);color:var(--bad)}
.fin-badge.warn{background:var(--warn-bg);color:var(--warn)}
.fin-badge.info{background:var(--cyan-soft);color:var(--blue)}
.fin-badge.brand{background:var(--cyan-soft);color:var(--blue)}
.fin-badge.mute{background:#eef0f6;color:var(--mute)}

.fin-tx{display:flex;flex-direction:column;gap:4px;padding:12px 0;border-bottom:1px solid var(--line)}
.fin-tx:last-child{border-bottom:0}
.fin-tx .top{display:flex;justify-content:space-between;gap:8px;align-items:center}
.fin-tx .id{font-weight:500;font-size:14px;overflow-wrap:anywhere}
.fin-tx .amt{font-weight:600;font-size:15px}
.fin-tx .meta{font-size:12.5px;color:var(--mute);display:flex;gap:10px;flex-wrap:wrap}
.fin-list{display:flex;flex-direction:column}
.fin-empty{text-align:center;padding:28px 12px;color:var(--mute);font-size:14px;border:1px dashed var(--line);border-radius:12px}
.fin-empty b{display:block;color:var(--ink);font-size:15px;margin-bottom:4px}
.fin-btn{min-height:48px;border-radius:12px;border:0;background:var(--blue);color:#fff;font:inherit;font-weight:600;font-size:15px;padding:0 18px;cursor:pointer;width:100%}
.fin-btn[disabled]{background:#e7e9f1;color:#8590a6;cursor:not-allowed}
.fin-btn.ghost{background:#eef0f6;color:var(--mute);cursor:not-allowed}
.fin-note{font-size:12.5px;color:var(--mute);line-height:1.45}
.fin-note.warn{color:var(--warn);background:var(--warn-bg);border-radius:10px;padding:8px 12px}
.fin-check{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line);font-size:14.5px}
.fin-check:last-child{border-bottom:0}
.fin-check .ic{flex:0 0 22px;height:22px;border-radius:999px;display:grid;place-items:center;font-size:13px;font-weight:700}
.fin-check .ic.ok{background:var(--good-bg);color:var(--good)}
.fin-check .ic.no{background:var(--bad-bg);color:var(--bad)}
.fin-check small{display:block;color:var(--mute);font-size:12.5px}
.fin-skel{background:linear-gradient(90deg,#e8ebf3 25%,#f4f5f9 37%,#e8ebf3 63%);background-size:400% 100%;animation:finpulse 1.4s ease infinite;border-radius:12px}
@keyframes finpulse{0%{background-position:100% 50%}100%{background-position:0 50%}}
@media (prefers-reduced-motion:reduce){.fin-skel{animation:none}}
.fin-jr{padding:12px 0;display:flex;flex-direction:column;gap:6px;border-bottom:1px solid var(--line)}
.fin-jr:last-child{border-bottom:0}
.fin-jr .hd{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--mute)}
.fin-jr .tt{font-weight:600;font-size:14.5px;overflow-wrap:anywhere}
.fin-jr .ln{display:grid;grid-template-columns:1fr auto auto;gap:10px;font-size:13.5px;padding:3px 0}
.fin-jr .ln span:nth-child(n+2){text-align:right;min-width:78px}

.fin-mod{display:flex;align-items:center;gap:14px;padding:13px 0;border-bottom:1px solid var(--line);min-height:62px}
.fin-mod:last-child{border-bottom:0}
.fin-ic{flex:0 0 40px;height:40px;border-radius:11px;background:var(--cyan-soft);color:var(--blue);display:grid;place-items:center}
.fin-mod .tx{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.fin-mod .t{font-weight:600;font-size:15px;color:var(--ink)}
.fin-mod .d{font-size:12.5px;color:var(--mute);line-height:1.4}
.fin-mod .chev{flex:0 0 auto;color:#9aa4ba}
.fin-person{display:flex;flex-direction:column;gap:8px;padding:13px 0;border-bottom:1px solid var(--line)}
.fin-person:last-of-type{border-bottom:0}
.fin-person .top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.fin-person .nm{font-weight:600;font-size:15px;overflow-wrap:anywhere}
.fin-person .ti{font-size:12.5px;color:var(--mute)}
.fin-tags{display:flex;flex-wrap:wrap;gap:6px}
.fin-rules{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}
.fin-rules li{display:flex;gap:10px;font-size:14px;line-height:1.5;color:#2a3350}
.fin-rules li::before{content:"";flex:0 0 5px;height:5px;border-radius:99px;background:var(--blue);margin-top:9px}

@media (min-width:720px){.fin{gap:16px}.fin-hero h1{font-size:30px}.fin-split{display:grid;grid-template-columns:3fr 2fr;gap:16px;align-items:start}.fin-duo{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}.fin-top{display:grid;grid-template-columns:7fr 5fr;gap:16px;align-items:stretch}.fin-rh{padding:22px 22px 0}.fin-rh .area{margin:10px -22px 0}}
`;
export const PREMIUM_CSS_EXTRA = `.fin .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}`;

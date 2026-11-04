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
font-family:var(--font-geist-sans),ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:transparent;padding:0;display:flex;flex-direction:column;gap:22px;font-variant-numeric:tabular-nums;line-height:1.45;min-width:0;max-width:100%;-webkit-font-smoothing:antialiased}
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

/* headline: the one memorable block of the finance page */
.fin-head{display:flex;flex-direction:column;gap:6px;padding-top:2px}
.fin-head h1{font-size:14px;font-weight:500;color:var(--mute)}
.fin-head .big{font-size:clamp(34px,11vw,44px);font-weight:600;letter-spacing:-.04em;line-height:1.05;color:var(--ink)}
.fin-head .big.neg{color:var(--bad)}
.fin-head .sub{font-size:14px;color:var(--mute);line-height:1.45}
.fin-head .sub b{font-weight:600}
.fin-head .sub b.good{color:var(--good)}
.fin-head .sub b.bad{color:var(--bad)}
.fin-bridge{margin-top:14px;display:flex;flex-direction:column;gap:10px}
.fin-bridge .bar{display:flex;gap:3px;height:14px}
.fin-bridge .bar i{display:block;height:100%;min-width:6px}
.fin-bridge .bar .in{background:var(--blue);border-radius:7px 3px 3px 7px}
.fin-bridge .bar .out{background:var(--ink);border-radius:3px 7px 7px 3px}
.fin-bridge .bar.empty{background:var(--line);border-radius:7px}
.fin-bridge .lg{display:flex;justify-content:space-between;gap:16px}
.fin-bridge .lg div{display:flex;flex-direction:column;gap:1px;min-width:0}
.fin-bridge .lg div:last-child{text-align:right}
.fin-bridge .lg small{font-size:12.5px;color:var(--mute)}
.fin-bridge .lg strong{font-size:14.5px;font-weight:600;white-space:nowrap}

/* sections: hairline + title, no box */
.fin-card{background:transparent;border:0;border-top:1px solid var(--line);border-radius:0;padding:18px 0 0;display:flex;flex-direction:column;gap:10px;min-width:0;box-shadow:none}
.fin-card h2{font-size:15px;font-weight:600;letter-spacing:-.01em}
.fin-card .sub{font-size:13px;color:var(--mute);line-height:1.45}

/* KPI list: label left, figure right, change under the figure */
.fin-grid{display:flex;flex-direction:column;gap:0}
.fin .fin-kpi{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"k v" "h t";column-gap:14px;row-gap:2px;align-items:start;background:transparent;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:13px 0;box-shadow:none}
.fin .fin-kpi:last-child{border-bottom:0}
.fin-kpi .k{grid-area:k;font-size:15px;font-weight:500;color:var(--ink)}
.fin-kpi .v{grid-area:v;justify-self:end;font-size:16px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;text-align:right}
.fin-kpi .v.neg{color:var(--bad)}
.fin-kpi .h{grid-area:h;font-size:12.5px;color:var(--mute)}
.fin-trend{grid-area:t;justify-self:end;display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:500;background:transparent;padding:0;border-radius:0;width:auto;white-space:nowrap}
.fin-trend.good{color:var(--good)}
.fin-trend.bad{color:var(--bad)}
.fin-trend.flat{color:var(--mute)}

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

@media (min-width:720px){.fin{gap:28px}.fin-hero h1{font-size:30px}.fin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:40px}.fin .fin-kpi:nth-last-child(2){border-bottom:0}.fin-split{display:grid;grid-template-columns:3fr 2fr;gap:36px}}
`;
export const PREMIUM_CSS_EXTRA = `.fin .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}`;

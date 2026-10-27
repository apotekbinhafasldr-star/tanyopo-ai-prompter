/**
 * Scoped theme for the premium finance screens (navy, cyan, LINOE blue). Everything is under
 * `.fin`, so no other screen of the app is affected. Light surface on purpose: figures are the
 * product here, so contrast and number hierarchy win over decoration.
 */
export const PREMIUM_CSS = `
.fin{--navy:#0b1f3a;--navy2:#12305a;--blue:#2563eb;--cyan:#0891b2;--cyan-soft:#e0f7fb;--bg:#f3f6fb;--card:#fff;--ink:#0b1f3a;--mute:#566780;--line:#dbe3ef;--good:#0b7a55;--good-bg:#e3f6ee;--bad:#b42323;--bad-bg:#fdeaea;--warn:#8a5a00;--warn-bg:#fff4d6;
font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:12px;font-variant-numeric:tabular-nums;line-height:1.4}
.fin *{box-sizing:border-box}
.fin a{color:inherit;text-decoration:none}
.fin h1,.fin h2,.fin h3,.fin p{margin:0}
.fin-hero{background:linear-gradient(135deg,var(--navy) 0%,var(--navy2) 70%,#14507f 100%);color:#fff;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:6px}
.fin-hero h1{font-size:20px;font-weight:700;letter-spacing:-.01em}
.fin-hero p{font-size:13px;color:#c9d8ee}
.fin-demo{display:flex;gap:8px;align-items:flex-start;background:var(--warn-bg);color:var(--warn);border:1px solid #f0d58a;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:600}
.fin-demo b{background:var(--warn);color:#fff;border-radius:6px;padding:1px 6px;font-size:11px;letter-spacing:.04em}
.fin-chips{display:flex;gap:6px;overflow-x:auto;padding:2px 0 4px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.fin-chips::-webkit-scrollbar{display:none}
.fin-chip{flex:0 0 auto;min-height:40px;display:inline-flex;align-items:center;gap:6px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);font-size:13px;font-weight:600;color:var(--navy2)}
.fin-chip[aria-current="true"]{background:var(--navy);border-color:var(--navy);color:#fff}
.fin-chip small{font-size:11px;opacity:.75}
.fin-label{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}
.fin-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.fin-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:8px;min-width:0}
.fin-card h2{font-size:15px;font-weight:700}
.fin-card .sub{font-size:12px;color:var(--mute)}
.fin-kpi{gap:4px}
.fin-kpi .k{font-size:12px;color:var(--mute);font-weight:600}
.fin-kpi .v{font-size:19px;font-weight:800;letter-spacing:-.02em;overflow-wrap:anywhere}
.fin-kpi .v.neg{color:var(--bad)}
.fin-kpi .h{font-size:11px;color:var(--mute)}
.fin-trend{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;border-radius:999px;padding:2px 8px;width:fit-content}
.fin-trend.good{background:var(--good-bg);color:var(--good)}
.fin-trend.bad{background:var(--bad-bg);color:var(--bad)}
.fin-trend.flat{background:var(--cyan-soft);color:var(--cyan)}
.fin-chart{display:flex;flex-direction:column;gap:10px}
.fin-chart svg{width:100%;height:auto;display:block;touch-action:manipulation}
.fin-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--mute)}
.fin-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.fin-seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:6px}
.fin-seg button{min-height:44px;border-radius:10px;border:1px solid var(--line);background:#fff;font:inherit;font-size:13px;font-weight:700;color:var(--navy2);cursor:pointer}
.fin-seg button[aria-pressed="true"]{background:var(--blue);border-color:var(--blue);color:#fff}
.fin-tip{background:var(--navy);color:#fff;border-radius:12px;padding:10px 12px;font-size:13px;display:flex;flex-direction:column;gap:4px}
.fin-tip div{display:flex;justify-content:space-between;gap:12px}
.fin-tip span:first-child{color:#bcd0ea}
.fin-row{display:flex;justify-content:space-between;gap:12px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px}
.fin-row:last-child{border-bottom:0}
.fin-row span:first-child{min-width:0;overflow-wrap:anywhere}
.fin-row .n{font-weight:700;text-align:right;white-space:nowrap}
.fin-row.total{font-weight:800;border-top:2px solid var(--navy);border-bottom:0;margin-top:4px}
.fin-row .n.neg{color:var(--bad)}
.fin-badge{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:700;white-space:nowrap}
.fin-badge.good{background:var(--good-bg);color:var(--good)}
.fin-badge.bad{background:var(--bad-bg);color:var(--bad)}
.fin-badge.warn{background:var(--warn-bg);color:var(--warn)}
.fin-badge.info{background:var(--cyan-soft);color:var(--cyan)}
.fin-tx{display:flex;flex-direction:column;gap:6px;border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.fin-tx .top{display:flex;justify-content:space-between;gap:8px;align-items:center}
.fin-tx .id{font-weight:700;font-size:13px;overflow-wrap:anywhere}
.fin-tx .amt{font-weight:800}
.fin-tx .meta{font-size:12px;color:var(--mute);display:flex;gap:10px;flex-wrap:wrap}
.fin-list{display:flex;flex-direction:column;gap:8px}
.fin-empty{text-align:center;padding:24px 12px;color:var(--mute);font-size:14px;border:1px dashed var(--line);border-radius:12px;background:#fff}
.fin-empty b{display:block;color:var(--ink);font-size:15px;margin-bottom:4px}
.fin-btn{min-height:48px;border-radius:12px;border:0;background:linear-gradient(135deg,var(--blue),var(--cyan));color:#fff;font:inherit;font-weight:800;font-size:15px;letter-spacing:.02em;padding:0 18px;cursor:pointer;width:100%}
.fin-btn[disabled]{background:#cfd8e6;color:#5d6b80;cursor:not-allowed}
.fin-note{font-size:12px;color:var(--mute)}
.fin-note.warn{color:var(--warn);background:var(--warn-bg);border-radius:10px;padding:8px 10px}
.fin-check{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}
.fin-check:last-child{border-bottom:0}
.fin-check .ic{flex:0 0 22px;height:22px;border-radius:999px;display:grid;place-items:center;font-size:13px;font-weight:800}
.fin-check .ic.ok{background:var(--good-bg);color:var(--good)}
.fin-check .ic.no{background:var(--bad-bg);color:var(--bad)}
.fin-check small{display:block;color:var(--mute);font-size:12px}
.fin-skel{background:linear-gradient(90deg,#e6ecf5 25%,#f3f6fb 37%,#e6ecf5 63%);background-size:400% 100%;animation:finpulse 1.4s ease infinite;border-radius:12px}
@keyframes finpulse{0%{background-position:100% 50%}100%{background-position:0 50%}}
@media (prefers-reduced-motion:reduce){.fin-skel{animation:none}}
.fin-jr{border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;background:#fff}
.fin-jr .hd{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--mute)}
.fin-jr .tt{font-weight:700;font-size:14px;overflow-wrap:anywhere}
.fin-jr .ln{display:grid;grid-template-columns:1fr auto auto;gap:10px;font-size:13px;padding:3px 0}
.fin-jr .ln span:nth-child(n+2){text-align:right;min-width:78px}
@media (min-width:720px){.fin{padding:20px;gap:16px}.fin-grid{grid-template-columns:repeat(3,1fr)}.fin-hero{padding:22px}.fin-hero h1{font-size:24px}.fin-kpi .v{font-size:22px}.fin-split{display:grid;grid-template-columns:3fr 2fr;gap:16px}}
`;
export const PREMIUM_CSS_EXTRA = `.fin .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}`;

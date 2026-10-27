"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import type { Blocker, GuideSource, GuideStep } from "@/lib/tax-guide";
import { canMarkDone } from "@/lib/tax-guide/readiness";

export const GUIDE_CSS = `
.fin-g-bar{height:10px;border-radius:999px;background:#dfe7f3;overflow:hidden}
.fin-g-bar>i{display:block;height:100%;background:linear-gradient(90deg,var(--blue),var(--cyan));border-radius:999px;transition:width .25s}
@media (prefers-reduced-motion:reduce){.fin-g-bar>i{transition:none}}
.fin-g-meta{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--mute);margin:6px 0 2px}
.fin-g-h{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px}
.fin-g-step h2{font-size:18px;margin:0 0 6px;overflow-wrap:anywhere}
.fin-g-todo{display:flex;flex-direction:column;gap:2px;margin:10px 0}
.fin-g-todo label{display:flex;gap:10px;align-items:flex-start;min-height:44px;padding:8px 6px;border-radius:10px;font-size:14px;cursor:pointer}
.fin-g-todo label:hover{background:#f1f5fb}
.fin-g-todo input{flex:0 0 22px;width:22px;height:22px;margin-top:1px;accent-color:var(--blue)}
.fin-g-links{display:flex;flex-direction:column;gap:8px;margin:8px 0}
.fin-g-links a,.fin-g-nav button{min-height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;font-weight:700;font-size:14px;text-align:center;padding:0 14px}
.fin-g-links a{border:1px solid var(--line);background:#fff;color:var(--navy2)}
.fin-g-nav{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.fin-g-nav button{border:1px solid var(--line);background:#fff;color:var(--navy2);font:inherit;font-weight:700;cursor:pointer}
.fin-g-nav button.pri{border:0;background:linear-gradient(135deg,var(--blue),var(--cyan));color:#fff}
.fin-g-nav button[disabled]{background:#e6ecf5;color:#7b8798;cursor:not-allowed;border-color:transparent}
.fin-g-list{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.fin-g-list button{width:100%;min-height:44px;display:flex;gap:10px;align-items:center;text-align:left;border:1px solid var(--line);background:#fff;border-radius:10px;font:inherit;font-size:13px;padding:6px 10px;cursor:pointer}
.fin-g-list button[aria-current="step"]{border-color:var(--blue);background:#eef5ff;font-weight:700}
.fin-g-list .no{flex:0 0 24px;height:24px;border-radius:999px;background:#e6ecf5;display:grid;place-items:center;font-size:12px;font-weight:800}
.fin-g-list .no.done{background:var(--good-bg);color:var(--good)}
.fin-g-src{font-size:12px;color:var(--mute);margin:6px 0 0}
.fin-g-src a{color:var(--blue);text-decoration:underline;overflow-wrap:anywhere}
`;

export interface GuideWizardProps {
  readonly kind: "PPH_BADAN" | "PPN";
  readonly year: string;
  readonly steps: readonly GuideStep[];
  readonly sources: readonly GuideSource[];
  readonly blockers: readonly Blocker[];
  readonly canExport: boolean;
  readonly demo: boolean;
  /** 1-based deep link (?langkah=). When present it wins over the remembered position. */
  readonly initialStep?: number;
}

const ACTOR = { APLIKASI: "Dicek aplikasi", FOUNDER: "Dilakukan Founder", AKUNTAN: "Dengan akuntan" } as const;
const VERIF = {
  TERVERIFIKASI: { text: "Sesuai sumber resmi", tone: "good" },
  SEBAGIAN: { text: "Sebagian terverifikasi", tone: "warn" },
  BELUM: { text: "Belum terverifikasi", tone: "bad" },
} as const;

interface Saved {
  readonly ticks: Record<string, boolean>;
  readonly index: number;
  readonly proofStatus: boolean;
  readonly proofBpe: boolean;
  readonly done: boolean;
}
const EMPTY: Saved = { ticks: {}, index: 0, proofStatus: false, proofBpe: false, done: false };

function subscribeStorage(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // storage blocked: the wizard simply starts fresh
  }
}
function writeStored(key: string, v: Saved): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
function parseSaved(raw: string | null, clamp: (i: number) => number): Saved {
  if (!raw) return EMPTY;
  try {
    const p = JSON.parse(raw) as Partial<Saved>;
    return {
      ticks: typeof p.ticks === "object" && p.ticks ? p.ticks : {},
      index: Number.isInteger(p.index) ? clamp(p.index as number) : 0,
      proofStatus: p.proofStatus === true,
      proofBpe: p.proofBpe === true,
      done: p.done === true,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Interactive checklist. Only booleans and a step index are remembered, in this browser only
 * (a per-viewer convenience): no document, no credential, no amount, nothing is sent to a server.
 */
export function GuideWizard({ kind, year, steps, sources, blockers, canExport, demo, initialStep }: GuideWizardProps) {
  const storageKey = `linoe-tax-guide:v1:${kind}:${year}`;
  const startIndex = initialStep ? Math.min(Math.max(initialStep, 1), steps.length) - 1 : 0;
  // The remembered state is an external store (this browser's localStorage): it is read through
  // useSyncExternalStore, so the server render and first client render agree (nothing remembered).
  const stored = useSyncExternalStore(subscribeStorage, () => readStored(storageKey), () => null);
  const [local, setLocal] = useState<Saved | null>(null);
  const clamp = useCallback((i: number) => Math.min(Math.max(i, 0), steps.length - 1), [steps.length]);
  const base = parseSaved(stored, clamp);
  const s: Saved = local ?? (initialStep ? { ...base, index: startIndex } : base);
  const setS = (fn: (p: Saved) => Saved) => {
    const nextState = fn(s);
    setLocal(nextState);
    writeStored(storageKey, nextState);
  };

  const step = steps[s.index];
  const tickKey = (id: string, i: number) => `${id}:${i}`;
  const stepDone = (st: GuideStep) => (st.isFinal ? s.done : st.todo.length > 0 && st.todo.every((_, i) => s.ticks[tickKey(st.id, i)] === true));
  const doneCount = steps.filter(stepDone).length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const stepBlockers = blockers.filter((b) => b.stepIds.includes(step.id));
  const ver = VERIF[step.verification];
  const stepSources = sources.filter((x) => step.sourceIds.includes(x.id));
  const go = (i: number) => setS((p) => ({ ...p, index: Math.min(Math.max(i, 0), steps.length - 1) }));

  return (
    <section className="fin-card fin-g-step" aria-label="Wizard pelaporan" data-testid="guide-wizard">
      <style>{GUIDE_CSS}</style>
      <div
        className="fin-g-bar"
        role="progressbar"
        aria-label="Kemajuan checklist"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        data-testid="guide-progress"
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="fin-g-meta">
        <span>Langkah {step.n} dari {steps.length}</span>
        <span>{doneCount} dari {steps.length} dicentang ({pct}%)</span>
      </div>

      <div className="fin-g-h">
        <span className="fin-badge info">{ACTOR[step.actor]}</span>
        <span className={`fin-badge ${ver.tone}`}>{ver.text}</span>
      </div>
      <h2>{step.n}. {step.title}</h2>
      <p className="sub">{step.why}</p>

      {stepBlockers.length > 0 ? (
        <div role="alert" className="fin-note warn" data-testid="step-blockers">
          {stepBlockers.map((b) => <div key={b.code}>• {b.text}</div>)}
        </div>
      ) : null}

      {step.todo.length > 0 ? (
        <div className="fin-g-todo">
          {step.todo.map((t, i) => (
            <label key={t}>
              <input
                type="checkbox"
                checked={s.ticks[tickKey(step.id, i)] === true}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setS((p) => ({ ...p, ticks: { ...p.ticks, [tickKey(step.id, i)]: on } }));
                }}
              />
              <span>{t}</span>
            </label>
          ))}
        </div>
      ) : null}

      {step.warning ? <p className="fin-note warn" data-testid="step-warning">{step.warning}</p> : null}

      {step.isPackage ? (
        <form method="post" action="/admin/finance/tax/coretax-package" style={{ margin: "10px 0" }}>
          <input type="hidden" name="year" value={year} />
          <button className="fin-btn" type="submit" disabled={!canExport} data-testid="guide-package-button">
            SIAPKAN PAKET CORETAX
          </button>
          {!canExport ? <p className="fin-note warn">Anda belum memiliki izin menyiapkan paket (izin: ekspor pajak).</p> : null}
          {demo ? <p className="fin-note">Mode DEMO: paket berisi data fiktif dan berlabel DEMO.</p> : null}
        </form>
      ) : null}

      {step.isFinal ? (
        <div className="fin-g-todo" data-testid="final-proof">
          <label>
            <input type="checkbox" checked={s.proofStatus} onChange={(e) => { const on = e.currentTarget.checked; setS((p) => ({ ...p, proofStatus: on, done: on && p.proofBpe ? p.done : false })); }} />
            <span>Saya melihat sendiri di Coretax bahwa status SPT adalah Dilaporkan.</span>
          </label>
          <label>
            <input type="checkbox" checked={s.proofBpe} onChange={(e) => { const on = e.currentTarget.checked; setS((p) => ({ ...p, proofBpe: on, done: on && p.proofStatus ? p.done : false })); }} />
            <span>Saya sudah mengunduh dan menyimpan Bukti Penerimaan Elektronik resmi.</span>
          </label>
          <button
            type="button"
            className="fin-btn"
            disabled={!canMarkDone({ statusDilaporkan: s.proofStatus, bpeChecked: s.proofBpe })}
            onClick={() => setS((p) => ({ ...p, done: true }))}
            data-testid="mark-done"
          >
            {s.done ? "Sudah ditandai (catatan lokal)" : "Tandai selesai (catatan lokal)"}
          </button>
        </div>
      ) : null}

      {step.links.length > 0 ? (
        <div className="fin-g-links">
          {step.links.map((l) =>
            l.kind === "official" ? (
              <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
            ) : (
              <a key={l.href} href={l.href}>{l.label}</a>
            ),
          )}
        </div>
      ) : null}

      {stepSources.length > 0 ? (
        <p className="fin-g-src" data-testid="step-sources">
          Sumber:{" "}
          {stepSources.map((x, i) => (
            <span key={x.id}>
              {i > 0 ? "; " : ""}
              <a href={x.url} target="_blank" rel="noopener noreferrer">{x.title}</a> ({x.pageDate}, dibaca {x.verifiedOn})
            </span>
          ))}
        </p>
      ) : (
        <p className="fin-g-src">Langkah ini tidak bergantung pada prosedur Coretax tertentu.</p>
      )}

      <div className="fin-g-nav">
        <button type="button" onClick={() => go(s.index - 1)} disabled={s.index === 0}>Sebelumnya</button>
        <button type="button" className="pri" onClick={() => go(s.index + 1)} disabled={s.index === steps.length - 1}>Lanjut</button>
      </div>

      <details style={{ marginTop: 14 }}>
        <summary className="fin-note" style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>Daftar semua langkah</summary>
        <ol className="fin-g-list">
          {steps.map((st, i) => (
            <li key={st.id}>
              <button type="button" aria-current={i === s.index ? "step" : undefined} onClick={() => go(i)}>
                <span className={`no${stepDone(st) ? " done" : ""}`} aria-hidden>{stepDone(st) ? "✓" : st.n}</span>
                <span>{st.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

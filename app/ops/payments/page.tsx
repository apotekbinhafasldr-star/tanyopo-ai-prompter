import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPaymentOperator } from "@/services/payment-operator";
import { getNotifyStatus, getSyncState, listPaymentAlerts, syncIfStale, type PaymentAlertRow } from "@/services/payment-alerts";
import {
  PAYMENT_ALERT_KIND_LABEL,
  PAYMENT_ALERT_NOTE_MIN,
  PAYMENT_ALERT_STATE_LABEL,
  isSyncStale,
  notifyHealth,
} from "@/lib/billing/payment-alerts";
import { formatCurrency } from "@/lib/utils/format";
import { getDokuWebhookHealth, listRecheckCandidates } from "@/services/payment-health";
import { ackAlertAction, resolveAlertAction, syncAlertsAction } from "./actions";
import { recheckPaymentAction } from "./recheck-actions";

export const metadata: Metadata = { title: "Antrean Pembayaran — LINOE", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  acked: "Ditandai sedang dicek.",
  resolved: "Alarm diselesaikan.",
  synced: "Sinkronisasi selesai.",
  sync_busy: "Sinkronisasi lain sedang berjalan. Coba lagi sebentar.",
  sync_failed: "Sinkronisasi gagal. Alarm tidak hilang; akan dihitung ulang pada percobaan berikutnya.",
  note: "Catatan tidak valid (resolve wajib minimal 5 karakter).",
  failed: "Aksi gagal atau status alarm sudah berubah. Muat ulang halaman.",
  invalid: "Permintaan tidak valid.",
  rate: "Terlalu banyak permintaan. Tunggu semenit.",
  denied: "Akses ditolak.",
  recheck_applied: "Gateway DOKU mengonfirmasi LUNAS; langganan diaktifkan lewat jalur verifikasi.",
  recheck_closed: "Gateway DOKU menyatakan pembayaran batal/kedaluwarsa/gagal; invoice ditutup.",
  recheck_still_pending: "Gateway DOKU masih menyatakan PENDING. Tidak ada yang diubah.",
  recheck_unknown: "Gateway DOKU menjawab status yang tidak dikenal. Tidak ada yang diubah; periksa di Back Office DOKU.",
  recheck_review: "Pembayaran tercatat untuk ditinjau manual; langganan tidak diaktifkan.",
  recheck_alarm: "Refund/chargeback tercatat sebagai alarm; langganan tidak berubah.",
  recheck_unverifiable: "Gateway tidak dapat diverifikasi sekarang. Tidak ada yang diubah; coba lagi nanti.",
  recheck_not_eligible: "Transaksi tidak memenuhi syarat (harus DOKU, PENDING, lebih dari 10 menit).",
  recheck_not_configured: "DOKU sandbox belum dikonfigurasi; verifikasi ulang tidak dijalankan.",
  recheck_failed: "Verifikasi ulang gagal. Tidak ada yang diubah.",
  recheck_invalid: "Permintaan tidak valid.",
};

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function money(a: PaymentAlertRow): string | null {
  const ev = (a.evidence ?? {}) as Record<string, unknown>;
  const amount = typeof ev.amount === "number" ? ev.amount : typeof ev.reported_amount === "number" ? ev.reported_amount : null;
  const currency = typeof ev.currency === "string" ? ev.currency : typeof ev.reported_currency === "string" ? ev.reported_currency : "IDR";
  return amount === null ? null : formatCurrency(amount, currency);
}

function when(iso: string | null): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
}

export default async function PaymentQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const operator = await getPaymentOperator();
  if (!operator) notFound(); // do not reveal that the page exists

  const params = await searchParams;
  const showDone = str(params.view) === "selesai";

  await syncIfStale(operator.admin);
  const [alerts, state, notify, health, candidates] = await Promise.all([
    listPaymentAlerts(operator.admin, { states: showDone ? ["RESOLVED"] : ["OPEN", "ACKED"], limit: 100 }),
    getSyncState(operator.admin),
    getNotifyStatus(operator.admin),
    getDokuWebhookHealth(operator.admin),
    listRecheckCandidates(operator.admin),
  ]);

  const tenantIds = [...new Set([...alerts.map((a) => a.tenant_id), ...(candidates ?? []).map((c) => c.tenant_id)])];
  const names = new Map<string, string>();
  if (tenantIds.length > 0) {
    const { data } = await operator.admin.from("tenants").select("id, nama_usaha").in("id", tenantIds);
    for (const t of data ?? []) names.set(t.id, t.nama_usaha);
  }

  const message = MESSAGES[str(params.r) ?? ""];
  const messageOk = str(params.ok) === "1";
  const stale = isSyncStale(state?.last_success_at ?? null);
  const failing = (state?.consecutive_failures ?? 0) > 0;
  const mailHealth = notifyHealth(notify.state);

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Antrean Pembayaran</h1>
        <p className="text-sm text-muted-foreground">
          Alarm hanya dicatat dan ditandai. Satu-satunya aksi pembayaran adalah "Verifikasi ulang" DOKU, yang hanya bertanya ke gateway; halaman ini tidak bisa mengaktifkan dari input operator, me-refund, atau mengedit pembayaran dan langganan.
        </p>
      </header>

      {message ? (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${messageOk ? "border-success text-success" : "border-danger text-danger"}`}>
          {message}
        </p>
      ) : null}

      <section className="rounded-md border border-border bg-surface p-3 text-sm">
        <p>
          Sinkronisasi terakhir berhasil: <strong>{when(state?.last_success_at ?? null)}</strong>
        </p>
        {stale || failing ? (
          <p className="mt-1 text-warning">
            {failing ? `Sinkronisasi gagal ${state?.consecutive_failures}x berturut-turut (${state?.last_error ?? "?"}).` : "Data mungkin belum terbaru."}{" "}
            Alarm yang sudah tercatat tidak hilang.
          </p>
        ) : null}
        <p className="mt-1">
          Pengirim email alarm:{" "}
          <strong>
            {mailHealth === "NEVER_RAN" ? "belum aktif" : mailHealth === "OK" ? "aktif" : mailHealth === "FAILING" ? "ada kegagalan" : "tidak berjalan"}
          </strong>
          {notify.state?.last_run_at ? ` (jalan terakhir ${when(notify.state.last_run_at)})` : ""}
        </p>
        {notify.state?.last_claim_result === "NO_RECIPIENT" ? (
          <p className="mt-1 text-warning">Tidak ada operator aktif dengan email terkonfirmasi: email alarm belum dikirim. Alarm tetap tercatat di antrean ini.</p>
        ) : null}
        {mailHealth === "STALE" || mailHealth === "FAILING" || notify.dead > 0 ? (
          <p className="mt-1 text-warning">
            Email alarm mungkin tidak terkirim{notify.dead > 0 ? ` (${notify.dead} kiriman menyerah)` : ""}. Pantau antrean ini langsung; alarm tidak hilang.
          </p>
        ) : null}
        <form action={syncAlertsAction} className="mt-2">
          <button type="submit" className="h-11 w-full rounded-md border border-border-strong px-4 text-sm font-medium">
            Sinkronkan sekarang
          </button>
        </form>
      </section>

      <section className="rounded-md border border-border bg-surface p-3 text-sm" aria-labelledby="doku-health">
        <h2 id="doku-health" className="font-medium">
          Kesehatan webhook DOKU (24 jam terakhir)
        </h2>
        {health.ok ? (
          <>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
              <dt>Status tak dikenal</dt>
              <dd className={health.unknown > 0 ? "font-semibold text-warning" : ""}>{health.unknown}</dd>
              <dt>Verifikasi gateway gagal</dt>
              <dd className={health.verificationFailed > 0 ? "font-semibold text-warning" : ""}>{health.verificationFailed}</dd>
              <dt>Gateway belum LUNAS (notifikasi mengklaim lunas)</dt>
              <dd>{health.notPaid}</dd>
              <dt>Transaksi gagal/tak dikenal berulang (3x atau lebih)</dt>
              <dd className={health.repeatedTransactions > 0 ? "font-semibold text-danger" : ""}>{health.repeatedTransactions}</dd>
              <dt>Kejadian tertua</dt>
              <dd>{when(health.oldestAt)}</dd>
            </dl>
            {health.truncated ? <p className="mt-1 text-warning">Data dipotong; angka di atas minimal segitu.</p> : null}
            {health.unknown + health.verificationFailed + health.notPaid === 0 ? (
              <p className="mt-1 text-muted-foreground">Tidak ada kejadian bermasalah dalam 24 jam terakhir.</p>
            ) : (
              <p className="mt-1 text-muted-foreground">Hanya hitungan; tidak ada data pembayaran yang ditampilkan.</p>
            )}
          </>
        ) : (
          <p className="mt-1 text-warning">Gagal membaca kesehatan webhook. Jangan anggap aman; muat ulang halaman.</p>
        )}
      </section>

      <section className="rounded-md border border-border bg-surface p-3 text-sm" aria-labelledby="doku-recheck">
        <h2 id="doku-recheck" className="font-medium">
          Verifikasi ulang pembayaran DOKU yang menggantung
        </h2>
        <p className="mt-1 text-muted-foreground">
          Transaksi DOKU berstatus PENDING lebih dari 10 menit. Tombol hanya menanyakan status ke DOKU; langganan aktif hanya jika DOKU sendiri
          menyatakan LUNAS dan nominalnya cocok.
        </p>
        {candidates === null ? (
          <p className="mt-2 text-warning">Gagal membaca daftar transaksi.</p>
        ) : candidates.length === 0 ? (
          <p className="mt-2">Tidak ada transaksi DOKU yang menggantung.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {candidates.map((c) => (
              <li key={c.id} className="space-y-1 rounded-md border border-border p-2">
                <p className="break-words">
                  {names.get(c.tenant_id) ?? c.tenant_id.slice(0, 8)} · {c.plan} · {formatCurrency(c.amount, c.currency)}
                </p>
                <p className="break-all font-mono text-xs">{c.id}</p>
                <p className="text-xs text-muted-foreground">Dibuat {when(c.created_at)}</p>
                <form action={recheckPaymentAction}>
                  <input type="hidden" name="transactionId" value={c.id} />
                  <button type="submit" className="h-11 w-full rounded-md border border-border-strong px-4 text-sm font-medium">
                    Verifikasi ulang
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-md border border-border bg-surface p-3 text-sm">
        <h2 className="font-medium">Ekspor rekonsiliasi (CSV)</h2>
        <p className="mt-1 text-muted-foreground">Transaksi LUNAS beserta invoice per rentang tanggal (WIB, maks. 92 hari). Hanya baca.</p>
        <form action="/ops/payments/export" method="get" className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-xs" htmlFor="export-from">
            Dari
            <input id="export-from" name="from" type="date" required className="mt-1 h-11 w-full rounded-md border border-border-strong px-2 text-sm" />
          </label>
          <label className="text-xs" htmlFor="export-to">
            Sampai
            <input id="export-to" name="to" type="date" required className="mt-1 h-11 w-full rounded-md border border-border-strong px-2 text-sm" />
          </label>
          <button type="submit" className="col-span-2 h-11 rounded-md border border-border-strong px-4 text-sm font-medium">
            Unduh CSV
          </button>
        </form>
      </section>

      <nav className="flex gap-2 text-sm" aria-label="Filter">
        <a href="/ops/payments" className={`flex-1 rounded-md border px-3 py-2 text-center ${showDone ? "border-border" : "border-brand font-medium"}`}>
          Aktif
        </a>
        <a href="/ops/payments?view=selesai" className={`flex-1 rounded-md border px-3 py-2 text-center ${showDone ? "border-brand font-medium" : "border-border"}`}>
          Selesai
        </a>
      </nav>

      {alerts.length === 0 ? (
        <p className="rounded-md border border-border bg-surface p-4 text-center text-sm text-muted-foreground">
          {showDone ? "Belum ada alarm selesai." : "Tidak ada alarm aktif."}
        </p>
      ) : (
        <ul className="space-y-3">
          {alerts.map((a) => (
            <li key={a.id} className="space-y-2 rounded-md border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.severity === "CRITICAL" ? "bg-danger-muted text-danger" : "bg-warning-muted text-warning"}`}>
                  {a.severity === "CRITICAL" ? "Kritis" : "Tinggi"}
                </span>
                <span className="text-sm font-semibold">{PAYMENT_ALERT_KIND_LABEL[a.kind]}</span>
                {a.reopened_count > 0 ? (
                  <span className="rounded-full bg-info-muted px-2 py-0.5 text-xs font-medium text-info">Dibuka ulang {a.reopened_count}×</span>
                ) : null}
                <span className="ml-auto text-xs text-muted-foreground">{PAYMENT_ALERT_STATE_LABEL[a.state]}</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Bisnis</dt>
                <dd className="break-words">{names.get(a.tenant_id) ?? a.tenant_id.slice(0, 8)}</dd>
                <dt className="text-muted-foreground">Transaksi</dt>
                <dd className="break-all font-mono text-xs">{a.transaction_id}</dd>
                {money(a) ? (
                  <>
                    <dt className="text-muted-foreground">Nominal</dt>
                    <dd>{money(a)}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Alasan</dt>
                <dd className="break-words">{a.reason ?? "-"}</dd>
                <dt className="text-muted-foreground">Terdeteksi</dt>
                <dd>{when(a.first_seen_at)}</dd>
                {a.repeat_count > 0 ? (
                  <>
                    <dt className="text-muted-foreground">Sinyal serupa</dt>
                    <dd>
                      Muncul lagi {a.repeat_count}× setelah selesai (kemungkinan kirim ulang). Terakhir {when(a.last_repeat_at)}.
                    </dd>
                  </>
                ) : null}
                {a.state === "RESOLVED" ? (
                  <>
                    <dt className="text-muted-foreground">Selesai</dt>
                    <dd>
                      {when(a.resolved_at)} ({a.resolution === "AUTO" ? "otomatis" : "operator"})
                      {a.resolution_note ? <span className="block break-words text-muted-foreground">{a.resolution_note}</span> : null}
                    </dd>
                  </>
                ) : null}
              </dl>
              {a.state !== "RESOLVED" ? (
                <div className="space-y-2">
                  {a.state === "OPEN" ? (
                    <form action={ackAlertAction}>
                      <input type="hidden" name="alertId" value={a.id} />
                      <button type="submit" className="h-11 w-full rounded-md border border-border-strong px-4 text-sm font-medium">
                        Tandai sedang dicek
                      </button>
                    </form>
                  ) : null}
                  <details>
                    <summary className="flex h-11 cursor-pointer items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground">
                      Selesaikan dengan catatan
                    </summary>
                    <form action={resolveAlertAction} className="mt-2 space-y-2">
                      <input type="hidden" name="alertId" value={a.id} />
                      <label className="block text-sm" htmlFor={`note-${a.id}`}>
                        Catatan (wajib, min. {PAYMENT_ALERT_NOTE_MIN} karakter)
                      </label>
                      <textarea
                        id={`note-${a.id}`}
                        name="note"
                        required
                        minLength={PAYMENT_ALERT_NOTE_MIN}
                        maxLength={1000}
                        rows={3}
                        className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base"
                      />
                      <button type="submit" className="h-11 w-full rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground">
                        Simpan & selesaikan
                      </button>
                    </form>
                  </details>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPaymentOperator } from "@/services/payment-operator";
import { getSyncState, listPaymentAlerts, syncIfStale, type PaymentAlertRow } from "@/services/payment-alerts";
import {
  PAYMENT_ALERT_KIND_LABEL,
  PAYMENT_ALERT_NOTE_MIN,
  PAYMENT_ALERT_STATE_LABEL,
  isSyncStale,
} from "@/lib/billing/payment-alerts";
import { formatCurrency } from "@/lib/utils/format";
import { ackAlertAction, resolveAlertAction, syncAlertsAction } from "./actions";

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
  const [alerts, state] = await Promise.all([
    listPaymentAlerts(operator.admin, { states: showDone ? ["RESOLVED"] : ["OPEN", "ACKED"], limit: 100 }),
    getSyncState(operator.admin),
  ]);

  const tenantIds = [...new Set(alerts.map((a) => a.tenant_id))];
  const names = new Map<string, string>();
  if (tenantIds.length > 0) {
    const { data } = await operator.admin.from("tenants").select("id, nama_usaha").in("id", tenantIds);
    for (const t of data ?? []) names.set(t.id, t.nama_usaha);
  }

  const message = MESSAGES[str(params.r) ?? ""];
  const messageOk = str(params.ok) === "1";
  const stale = isSyncStale(state?.last_success_at ?? null);
  const failing = (state?.consecutive_failures ?? 0) > 0;

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Antrean Pembayaran</h1>
        <p className="text-sm text-muted-foreground">
          Hanya mencatat dan menandai. Halaman ini tidak bisa mengaktifkan, me-refund, atau mengubah pembayaran dan langganan.
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
        <form action={syncAlertsAction} className="mt-2">
          <button type="submit" className="h-11 w-full rounded-md border border-border-strong px-4 text-sm font-medium">
            Sinkronkan sekarang
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

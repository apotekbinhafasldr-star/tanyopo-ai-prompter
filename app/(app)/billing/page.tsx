import type { Metadata } from "next";
import { CreditCard, Sparkles, TrendingUp, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import {
  getOrCreateSubscription,
  getTrialState,
  getMonthlyAiJobCount,
  getVerifiedAttributedValueThisMonth,
  listInvoices,
  TRIAL_DURATION_DAYS,
} from "@/services/billing";
import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
import { calculateSuccessFee } from "@/lib/billing/success-fee";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { PlanForm } from "@/features/billing/plan-form";
import { PricingCards } from "@/features/billing/pricing-cards";
import { FeatureComparison } from "@/features/billing/feature-comparison";

const INVOICE_STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  DRAFT: "neutral",
  OPEN: "warning",
  PAID: "success",
  VOID: "neutral",
  UNCOLLECTIBLE: "danger",
};

// Batch B7 — customer-facing labels only. Never rename the underlying
// DRAFT/OPEN/PAID/VOID/UNCOLLECTIBLE enum in the database for this.
const INVOICE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  OPEN: "Menunggu Pembayaran",
  PAID: "Lunas",
  VOID: "Dibatalkan",
  UNCOLLECTIBLE: "Tidak Tertagih",
};

export const metadata: Metadata = { title: "Paket & Langganan — LINOE" };

const PLAN_LABEL: Record<string, string> = {
  FREE: "Free",
  STARTER: "Starter",
  PRO: "Pro",
  BUSINESS: "Business",
  GROWTH: "Growth",
  AGENCY: "Agency",
  UMKMPRO_BUNDLE: "UMKMpro Bundle",
};

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "neutral" | "brand"> = {
  ACTIVE: "success",
  TRIALING: "brand",
  PAST_DUE: "warning",
  CANCELED: "danger",
};

// Batch B7 — customer-facing labels only (B7.8). The underlying
// ACTIVE/TRIALING/PAST_DUE/CANCELED enum in prompter_subscriptions.status
// is never renamed for this — this is presentation-layer only.
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Aktif",
  TRIALING: "Masa Coba Aktif",
  PAST_DUE: "Pembayaran Perlu Diperbarui",
  CANCELED: "Berakhir",
};

export default async function BillingPage() {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const [subscription, aiJobCount, verifiedAttributedValue, invoices] = await Promise.all([
    getOrCreateSubscription(supabase, session.tenantId),
    getMonthlyAiJobCount(supabase, session.tenantId),
    getVerifiedAttributedValueThisMonth(supabase, session.tenantId),
    listInvoices(supabase, session.tenantId),
  ]);

  const successFee = calculateSuccessFee({
    rateBasisPoints: subscription.success_fee_rate_bps,
    verifiedAttributedValue,
  });

  const trial = getTrialState(subscription);

  const paymentProvider = getPaymentProvider();
  const isOwner = session.role === "owner";

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Paket & Langganan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lihat paket, masa coba, dan penggunaan LINOE Anda.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <CreditCard className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Paket Saat Ini</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="brand">{PLAN_LABEL[subscription.plan] ?? subscription.plan}</Badge>
            {trial.isTrialing && trial.expired ? (
              // B7.2 — never show an expired trial "as if active": the
              // underlying status enum is still TRIALING (no real payment
              // event has ever moved it), but the badge itself must reflect
              // the real expired state, not the raw enum.
              <Badge variant="danger">Masa Coba Berakhir</Badge>
            ) : (
              <Badge variant={STATUS_VARIANT[subscription.status] ?? "neutral"}>
                {STATUS_LABEL[subscription.status] ?? subscription.status}
              </Badge>
            )}
          </div>
          {trial.isTrialing ? (
            <div
              className={
                trial.expired
                  ? "flex flex-col gap-1 rounded-[var(--radius-md)] border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
                  : "flex flex-col gap-1 rounded-[var(--radius-md)] border border-brand/30 bg-brand/5 p-3 text-sm text-foreground"
              }
            >
              {trial.expired ? (
                <p>
                  Masa trial {TRIAL_DURATION_DAYS} hari Anda telah berakhir. Pembayaran online belum tersedia,
                  jadi fitur AI dijeda sementara.
                </p>
              ) : (
                <>
                  <p>Sisa masa coba: {trial.daysRemaining} hari</p>
                  {subscription.current_period_end ? (
                    <p className="text-xs text-muted-foreground">
                      Berakhir pada {formatDate(subscription.current_period_end)}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Anda masih dapat menggunakan LINOE selama masa coba.
                  </p>
                </>
              )}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {subscription.billing_provider
              ? `Pemroses pembayaran: ${subscription.billing_provider}.`
              : "Pembayaran online belum tersedia. Untuk saat ini Anda tetap dapat menggunakan masa coba yang aktif. Pilihan berlangganan akan tersedia setelah pembayaran online diaktifkan."}
          </p>
          {paymentProvider.name === "none" ? (
            <details className="rounded-[var(--radius-md)] border border-border">
              <summary className="cursor-pointer p-3 text-xs font-medium text-muted-foreground">
                Pilih paket referensi (opsional)
              </summary>
              <div className="border-t border-border p-3">
                <p className="mb-3 text-xs text-muted-foreground">
                  Pilihan paket berbayar akan tersedia setelah sistem pembayaran aktif. Memilih di sini hanya
                  menyimpan preferensi paket untuk referensi — tidak ada tagihan atau perubahan akses.
                </p>
                <PlanForm currentPlan={subscription.plan} readOnly={!isOwner} />
              </div>
            </details>
          ) : (
            <PlanForm currentPlan={subscription.plan} readOnly={!isOwner} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-1 space-y-0">
          <CardTitle>Bandingkan Paket</CardTitle>
          <CardDescription>
            Harga dan fitur LINOE — pembayaran online segera tersedia, jadi memilih di sini tidak memproses
            pembayaran apa pun.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-4">
          <PricingCards currentPlan={subscription.plan} readOnly={!isOwner} />
          <details className="rounded-[var(--radius-md)] border border-border">
            <summary className="cursor-pointer p-3 text-xs font-medium text-muted-foreground">
              Bandingkan Fitur
            </summary>
            <div className="border-t border-border p-3">
              <FeatureComparison />
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Sparkles className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Penggunaan AI Bulan Ini</CardTitle>
          <CardDescription className="sr-only">Jumlah job AI nyata dari prompter_ai_jobs</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <p className="text-2xl font-semibold text-foreground">{aiJobCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Total permintaan AI (Marketing Blueprint, Promote Wizard, Content Studio, SEO, Analytics, Optimasi)
            sejak awal bulan ini, dihitung langsung dari log job AI.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Success Fee</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-4">
          <p className="text-xs text-muted-foreground">
            Dihitung hanya dari konversi yang terverifikasi dan teratribusi ke campaign (UMKMpro AI) — tidak
            pernah dari total pendapatan bisnis Anda.
          </p>
          <p className="text-sm text-foreground">
            Nilai konversi terverifikasi bulan ini:{" "}
            <span className="font-semibold">{formatCurrency(verifiedAttributedValue)}</span>
          </p>
          {successFee.status === "NOT_CONFIGURED" ? (
            <p className="text-xs text-muted-foreground">
              Success fee belum berlaku untuk akun Anda saat ini — tidak ada biaya yang dihitung atau ditagih.
            </p>
          ) : (
            <p className="text-sm text-foreground">
              Estimasi success fee bulan ini: <span className="font-semibold">{formatCurrency(successFee.amount)}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Receipt className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Tagihan</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {invoices.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Belum ada tagihan."
              description="Riwayat tagihan akan muncul di sini setelah pembayaran online tersedia dan transaksi berhasil dilakukan."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {invoices.map((invoice) => (
                <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm text-foreground">{invoice.description ?? invoice.provider ?? "Invoice"}</p>
                    <p className="text-xs text-muted-foreground">
                      {invoice.issued_at ? formatDate(invoice.issued_at) : formatDate(invoice.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-foreground">{formatCurrency(invoice.amount, invoice.currency)}</span>
                    <Badge variant={INVOICE_STATUS_VARIANT[invoice.status] ?? "neutral"}>
                      {INVOICE_STATUS_LABEL[invoice.status] ?? invoice.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

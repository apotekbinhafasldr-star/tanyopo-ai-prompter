import type { Metadata } from "next";
import { CreditCard, Sparkles, TrendingUp, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import {
  getOrCreateSubscription,
  getMonthlyAiJobCount,
  getVerifiedAttributedValueThisMonth,
  listInvoices,
} from "@/services/billing";
import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
import { calculateSuccessFee } from "@/lib/billing/success-fee";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { PlanForm } from "@/features/billing/plan-form";

const INVOICE_STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  DRAFT: "neutral",
  OPEN: "warning",
  PAID: "success",
  VOID: "neutral",
  UNCOLLECTIBLE: "danger",
};

export const metadata: Metadata = { title: "Billing — LINOE" };

const PLAN_LABEL: Record<string, string> = {
  FREE: "Free",
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

  const paymentProvider = getPaymentProvider();
  const isOwner = session.role === "owner";

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paket langganan, penggunaan AI, dan dasar perhitungan success fee — semua angka di sini nyata,
          tidak ada yang dikarang.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <CreditCard className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Paket Anda</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="flex items-center gap-3">
            <Badge variant="brand">{PLAN_LABEL[subscription.plan] ?? subscription.plan}</Badge>
            <Badge variant={STATUS_VARIANT[subscription.status] ?? "neutral"}>{subscription.status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {subscription.billing_provider
              ? `Pemroses pembayaran: ${subscription.billing_provider}.`
              : `Belum ada pemroses pembayaran yang terhubung (${paymentProvider.name === "none" ? "NOT_CONFIGURED" : paymentProvider.name}) — upgrade paket berbayar dan penagihan otomatis belum tersedia. Harga resmi setiap paket akan diumumkan sebelum fitur ini aktif.`}
          </p>
          <PlanForm currentPlan={subscription.plan} readOnly={!isOwner} />
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
              Tarif success fee belum dikonfigurasi — tidak ada biaya yang dihitung atau ditagih (NOT_CONFIGURED).
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
          <CardTitle>Invoice</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {invoices.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Belum ada invoice"
              description="Invoice akan muncul di sini setelah pemroses pembayaran terhubung dan mulai menerbitkan tagihan nyata."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {invoices.map((invoice) => (
                <li key={invoice.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm text-foreground">{invoice.description ?? invoice.provider ?? "Invoice"}</p>
                    <p className="text-xs text-muted-foreground">
                      {invoice.issued_at ? formatDate(invoice.issued_at) : formatDate(invoice.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-foreground">{formatCurrency(invoice.amount, invoice.currency)}</span>
                    <Badge variant={INVOICE_STATUS_VARIANT[invoice.status] ?? "neutral"}>{invoice.status}</Badge>
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

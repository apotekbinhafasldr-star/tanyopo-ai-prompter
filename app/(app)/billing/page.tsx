import type { Metadata } from "next";
import { CreditCard, Sparkles, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateSubscription, getMonthlyAiJobCount, getVerifiedAttributedValueThisMonth } from "@/services/billing";
import { calculateSuccessFee } from "@/lib/billing/success-fee";
import { formatCurrency } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Billing — Tanyopo AI Promoter" };

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

  const [subscription, aiJobCount, verifiedAttributedValue] = await Promise.all([
    getOrCreateSubscription(supabase, session.tenantId),
    getMonthlyAiJobCount(supabase, session.tenantId),
    getVerifiedAttributedValueThisMonth(supabase, session.tenantId),
  ]);

  const successFee = calculateSuccessFee({
    rateBasisPoints: subscription.success_fee_rate_bps,
    verifiedAttributedValue,
  });

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
              : "Belum ada pemroses pembayaran yang terhubung (NOT_CONFIGURED) — upgrade paket dan penagihan otomatis belum tersedia. Harga resmi setiap paket akan diumumkan sebelum fitur ini aktif."}
          </p>
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
    </div>
  );
}

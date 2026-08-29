import type { Metadata } from "next";
import { BarChart3, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { ConversionForm } from "@/features/analytics/conversion-form";

export const metadata: Metadata = { title: "Analytics — Tanyopo AI Promoter" };

const EVENT_LABEL: Record<string, string> = {
  LEAD: "Lead",
  SIGNUP: "Signup",
  ADD_TO_CART: "Add to Cart",
  CHECKOUT: "Checkout",
  PURCHASE: "Purchase",
  SUBSCRIPTION: "Subscription",
};

export default async function AnalyticsPage() {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const [{ data: metrics }, { data: conversions }, { data: campaigns }] = await Promise.all([
    supabase
      .from("prompter_marketing_metrics")
      .select("id")
      .eq("tenant_id", session.tenantId)
      .limit(1),
    supabase
      .from("prompter_conversions")
      .select("id, event_type, value, currency, customer_reference, occurred_at, master_campaign_id")
      .eq("tenant_id", session.tenantId)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("prompter_master_campaigns")
      .select("id, name")
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false }),
  ]);

  const campaignNameById = new Map((campaigns ?? []).map((c) => [c.id, c.name]));
  const totalConversionValue = (conversions ?? []).reduce((sum, c) => sum + (c.value ?? 0), 0);
  const hasRealMetrics = (metrics ?? []).length > 0;

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Spend dan performa iklan aktif setelah channel terhubung (Phase 3). Konversi bisa dicatat manual
          sejak sekarang.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <BarChart3 className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Spend &amp; Performa Iklan</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {hasRealMetrics ? (
            <p className="text-sm text-muted-foreground">Data metrik tersedia.</p>
          ) : (
            <EmptyState
              icon={BarChart3}
              title="Belum ada data iklan"
              description="Spend, impressions, klik, dan ROAS akan muncul di sini setelah channel terhubung dan campaign berjalan nyata."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle>Konversi</CardTitle>
          </div>
          {conversions && conversions.length > 0 ? (
            <Badge variant="brand">{formatCurrency(totalConversionValue)} tercatat</Badge>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-6 pt-4">
          <ConversionForm campaigns={campaigns ?? []} />

          {!conversions || conversions.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title="Belum ada konversi tercatat"
              description="Catat penjualan atau lead yang Anda tahu berasal dari campaign menggunakan form di atas."
            />
          ) : (
            <div className="flex flex-col divide-y divide-border rounded-[var(--radius-lg)] border border-border">
              {conversions.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {EVENT_LABEL[c.event_type] ?? c.event_type}
                      {c.customer_reference ? ` — ${c.customer_reference}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(c.occurred_at)}
                      {c.master_campaign_id ? ` · ${campaignNameById.get(c.master_campaign_id) ?? ""}` : ""}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    {c.value ? formatCurrency(c.value, c.currency) : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

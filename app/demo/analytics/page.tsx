import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireDemoSession } from "@/lib/demo/is-demo-request";
import { DEMO_METRICS, DEMO_PRODUCTS, demoProfit, demoRoas } from "@/lib/demo/dataset";

export default async function DemoAnalyticsPage() {
  await requireDemoSession();
  const product = DEMO_PRODUCTS[0];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Analytics &amp; ROAS (Demo)</h1>
        <Badge variant="outline">Data Simulasi</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        TRACK → UNDERSTAND → RECOMMEND → OPTIMIZE → MEASURE AGAIN — begitu cara LINOE membantu bisnis Anda
        mengurangi iklan yang boros dan menemukan campaign yang menghasilkan.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {DEMO_METRICS.map((metric) => {
          const estimatedUnits = Math.round(metric.orders * 0.9);
          return (
            <Card key={metric.channel}>
              <CardContent className="flex flex-col gap-2 p-5">
                <p className="text-sm font-semibold text-foreground">{metric.channel}</p>
                <dl className="grid grid-cols-2 gap-y-1 text-sm text-muted-foreground">
                  <dt>Impressions</dt>
                  <dd className="text-right text-foreground">{metric.impressions.toLocaleString("id-ID")}</dd>
                  <dt>Klik</dt>
                  <dd className="text-right text-foreground">{metric.clicks.toLocaleString("id-ID")}</dd>
                  <dt>Leads</dt>
                  <dd className="text-right text-foreground">{metric.leads.toLocaleString("id-ID")}</dd>
                  <dt>Order</dt>
                  <dd className="text-right text-foreground">{metric.orders.toLocaleString("id-ID")}</dd>
                  <dt>Ad Spend</dt>
                  <dd className="text-right text-foreground">Rp{metric.adSpend.toLocaleString("id-ID")}</dd>
                  <dt>Revenue</dt>
                  <dd className="text-right text-foreground">Rp{metric.revenue.toLocaleString("id-ID")}</dd>
                  <dt className="font-medium text-foreground">ROAS</dt>
                  <dd className="text-right font-medium text-brand">{demoRoas(metric)}x</dd>
                  <dt className="font-medium text-foreground">Estimasi Profit</dt>
                  <dd className="text-right font-medium text-foreground">
                    Rp{demoProfit(metric, product.hpp, estimatedUnits).toLocaleString("id-ID")}
                  </dd>
                </dl>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 p-5">
          <p className="text-sm font-semibold text-foreground">Rekomendasi AI (Simulasi)</p>
          <p className="text-sm text-muted-foreground">
            TikTok menghasilkan ROAS lebih tinggi dari Instagram pada data simulasi ini — pada akun nyata,
            LINOE akan merekomendasikan menggeser sebagian budget ke channel dengan ROAS lebih baik.
          </p>
        </CardContent>
      </Card>

      <Button asChild size="lg" className="self-start bg-gradient-to-r from-brand to-brand-2">
        <Link href="/register">
          Mulai Gratis dengan Data Anda Sendiri
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Button>
    </div>
  );
}

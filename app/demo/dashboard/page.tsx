import Link from "next/link";
import { ArrowRight, Package, PenSquare, Megaphone, LineChart } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireDemoSession } from "@/lib/demo/is-demo-request";
import { DEMO_ANALYTICS_SUMMARY } from "@/lib/demo/dataset";

const STEPS = [
  {
    href: "/demo/products",
    icon: Package,
    title: "1. Produk & Marketing Blueprint AI",
    description: "Lihat produk contoh dan hasilkan strategi marketing dengan AI.",
  },
  {
    href: "/demo/content",
    icon: PenSquare,
    title: "2. Content AI",
    description: "Buat caption media sosial secara instan.",
  },
  {
    href: "/demo/campaign",
    icon: Megaphone,
    title: "3. Campaign & Approval (Simulasi)",
    description: "Ajukan lalu luncurkan campaign — seluruhnya simulasi, tanpa biaya iklan nyata.",
  },
  {
    href: "/demo/analytics",
    icon: LineChart,
    title: "4. Analytics & ROAS (Simulasi)",
    description: "Pantau performa, ROAS, dan estimasi profit dari data simulasi.",
  },
];

export default async function DemoDashboardPage() {
  await requireDemoSession();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Selamat datang di Demo LINOE</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ikuti empat langkah ini untuk merasakan alur kerja LINOE sesungguhnya — semua data di bawah ini
          adalah simulasi.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Total Ad Spend (Simulasi)</CardDescription>
            <CardTitle className="text-xl">
              Rp{DEMO_ANALYTICS_SUMMARY.totalAdSpend.toLocaleString("id-ID")}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Total Revenue (Simulasi)</CardDescription>
            <CardTitle className="text-xl">
              Rp{DEMO_ANALYTICS_SUMMARY.totalRevenue.toLocaleString("id-ID")}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((step) => (
          <Link key={step.href} href={step.href}>
            <Card className="h-full transition hover:border-brand hover:shadow-[var(--shadow-glow)]">
              <CardContent className="flex items-start gap-4 p-6">
                <step.icon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                <div className="flex-1">
                  <CardTitle>{step.title}</CardTitle>
                  <CardDescription className="mt-1">{step.description}</CardDescription>
                </div>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

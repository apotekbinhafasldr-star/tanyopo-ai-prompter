import { FinanceDashboard } from "@/features/admin/premium/dashboard";
import { buildDashboardModel } from "@/lib/admin/dashboard-model";
import { buildDemoAccounting, DEMO_MONTHS, DEMO_TODAY, DEMO_YEAR } from "@/lib/admin/demo-accounting";
import { DEMO_LATE_AFTER_DAYS } from "@/lib/admin/demo-data";
import { parseFinanceFilters } from "@/lib/admin/filters";
import { requireAdminPage } from "@/services/platform-admin";

export default async function AdminFinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage("finance.view");
  const filters = parseFinanceFilters(await searchParams, DEMO_MONTHS);
  const demo = buildDemoAccounting();
  const model = buildDashboardModel({
    snapshot: demo.snapshot,
    ledger: demo.ledger,
    filters,
    monthKeys: DEMO_MONTHS,
    yearStart: `${DEMO_YEAR}-01-01`,
    today: DEMO_TODAY,
    lateAfterDays: DEMO_LATE_AFTER_DAYS,
    demo: true,
  });
  return <FinanceDashboard model={model} />;
}

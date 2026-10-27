import { ReportsView } from "@/features/admin/premium/reports";
import { OpenItemBook, reconcileBank } from "@/lib/accounting";
import { buildDemoAccounting, DEMO_TODAY, DEMO_YEAR } from "@/lib/admin/demo-accounting";
import { parseReportTab } from "@/lib/admin/filters";
import { requireAdminPage } from "@/services/platform-admin";

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage("accounting.view");
  const raw = await searchParams;
  const demo = buildDemoAccounting();
  const a = Array.isArray(raw.a) ? raw.a[0] : raw.a;
  const account = a && demo.ledger.chart.isPostable(a) && demo.ledger.totals().has(a) ? a : "1110";
  const bank = reconcileBank(demo.ledger, demo.bankStatement, { windowDays: 3 });
  return (
    <ReportsView
      tab={parseReportTab(raw)}
      ledger={demo.ledger}
      range={{ from: `${DEMO_YEAR}-01-01`, to: DEMO_TODAY }}
      account={account}
      bank={bank}
      openItems={new OpenItemBook("IDR")}
      demo
    />
  );
}

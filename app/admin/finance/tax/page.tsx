import { TaxCenter } from "@/features/admin/premium/tax-center";
import { reconcileBank } from "@/lib/accounting";
import { buildDashboardModel } from "@/lib/admin/dashboard-model";
import { buildDemoAccounting, buildDemoFiscal, DEMO_MONTHS, DEMO_TODAY, DEMO_YEAR } from "@/lib/admin/demo-accounting";
import { DEMO_LATE_AFTER_DAYS } from "@/lib/admin/demo-data";
import { can } from "@/lib/admin/permissions";
import { UNVERIFIED_TAX_CONFIG, turnoverRecap } from "@/lib/finance";
import { requireAdminPage } from "@/services/platform-admin";

export default async function AdminTaxPage() {
  const principal = await requireAdminPage("tax.view");
  const demo = buildDemoAccounting();
  const model = buildDashboardModel({
    snapshot: demo.snapshot,
    ledger: demo.ledger,
    filters: { period: "ytd", status: "ALL" },
    monthKeys: DEMO_MONTHS,
    yearStart: `${DEMO_YEAR}-01-01`,
    today: DEMO_TODAY,
    lateAfterDays: DEMO_LATE_AFTER_DAYS,
    demo: true,
  });
  return (
    <TaxCenter
      recap={turnoverRecap(demo.snapshot, DEMO_YEAR, UNVERIFIED_TAX_CONFIG)}
      fiscal={buildDemoFiscal(demo.ledger)}
      taxPayments={[]}
      checks={model.checks}
      bank={reconcileBank(demo.ledger, demo.bankStatement, { windowDays: 3 })}
      canExport={can(principal, "tax.export")}
      demo
    />
  );
}

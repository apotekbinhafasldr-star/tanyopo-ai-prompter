import { TaxGuide } from "@/features/admin/premium/tax-guide";
import { reconcileBank } from "@/lib/accounting";
import { buildDashboardModel } from "@/lib/admin/dashboard-model";
import { buildDemoAccounting, buildDemoFiscal, DEMO_MONTHS, DEMO_TODAY, DEMO_YEAR } from "@/lib/admin/demo-accounting";
import { DEMO_LATE_AFTER_DAYS } from "@/lib/admin/demo-data";
import { can } from "@/lib/admin/permissions";
import { UNVERIFIED_TAX_CONFIG, turnoverRecap } from "@/lib/finance";
import { assessReadiness, parseGuideYear, parseReturnKind, parseStepParam, usableObligations } from "@/lib/tax-guide";
import { buildDemoOptimization } from "@/lib/admin/demo-optimization";
import { runOptimization } from "@/lib/tax-opt";
import { requireAdminPage } from "@/services/platform-admin";

/** Years offered. DEMO has one year; real years come from the books once the ledger is live. */
const YEARS = [DEMO_YEAR] as const;

export default async function AdminTaxGuidePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Server-side gate on every request: a missing permission is a 404, never a hidden button.
  const principal = await requireAdminPage("tax.view");
  const raw = await searchParams;
  const kind = parseReturnKind(raw.jenis);
  const year = parseGuideYear(raw.tahun, YEARS);

  const demo = buildDemoAccounting();
  const fiscal = buildDemoFiscal(demo.ledger);
  const recap = turnoverRecap(demo.snapshot, DEMO_YEAR, UNVERIFIED_TAX_CONFIG);
  const bank = reconcileBank(demo.ledger, demo.bankStatement, { windowDays: 3 });
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

  const readiness =
    kind === "PPH_BADAN" || kind === "PPN"
      ? assessReadiness({
          kind,
          demo: true,
          checks: model.checks.map((c) => ({ label: c.label, ok: c.ok })),
          bankFinal: bank.final,
          entityComplete: fiscal.entity.status === "COMPLETE",
          statementsApproved: false,
          taxRateVerified: fiscal.segment.tax.status === "COMPUTED",
          pendingAdjustments: fiscal.pendingAdjustments.length,
          pkpVerified: recap.configVerified,
          invoiceDataAvailable: false,
          optimizationOpenItems: runOptimization(buildDemoOptimization("nyata")).openItems.length,
        })
      : null;

  return (
    <TaxGuide
      kind={kind}
      year={year}
      years={YEARS}
      readiness={readiness}
      pkpVerified={recap.configVerified}
      otherObligations={usableObligations([]).map((o) => o.name)}
      canExport={can(principal, "tax.export") && can(principal, "accounting.view")}
      canOptimize={can(principal, "tax.optimization.view")}
      demo
      initialStep={parseStepParam(raw.langkah)}
    />
  );
}

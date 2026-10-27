import { TaxOptimization } from "@/features/admin/premium/tax-optimization";
import { buildDemoOptimization, parseScenario } from "@/lib/admin/demo-optimization";
import { formatRupiah } from "@/lib/admin/format";
import { can } from "@/lib/admin/permissions";
import { runOptimization } from "@/lib/tax-opt";
import { calculationHash, rulesVersion } from "@/lib/tax-opt/approval";
import { requireAdminPage } from "@/services/platform-admin";

export default async function AdminTaxOptimizationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Founder and staff with the special permission only. Missing permission is a 404.
  const principal = await requireAdminPage("tax.optimization.view");
  const raw = await searchParams;
  const scenario = parseScenario(raw.skenario);
  const input = buildDemoOptimization(scenario);
  const result = runOptimization(input);
  return (
    <TaxOptimization
      result={result}
      currency={input.currency}
      paidTotalText={formatRupiah(result.credits.paidVerified)}
      scenario={scenario}
      canApprove={can(principal, "tax.optimization.approve")}
      approval={{ calcHashShort: calculationHash({ input, result }).slice(0, 16), rulesVersion: rulesVersion() }}
      demo
    />
  );
}

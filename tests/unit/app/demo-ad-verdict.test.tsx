import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/demo/is-demo-request", () => ({ requireDemoSession: vi.fn(async () => undefined) }));

import DemoAnalyticsPage from "@/app/demo/analytics/page";
import { DEMO_METRICS, DEMO_PRODUCTS, DEMO_VERDICT_SCENARIOS, DEMO_CAMPAIGN } from "@/lib/demo/dataset";
import { evaluateAdPerformance } from "@/lib/ad-performance-verdict";

afterEach(() => cleanup());

describe("demo analytics — Ad Performance Verdict", () => {
  it("renders every verdict, labelled as simulated data, with disclaimer", async () => {
    render(await DemoAnalyticsPage());
    expect(screen.getByRole("heading", { name: /Ad Performance Verdict/ })).toBeInTheDocument();
    expect(screen.getAllByText("DATA SIMULASI / DEMO").length).toBeGreaterThanOrEqual(
      DEMO_METRICS.length + DEMO_VERDICT_SCENARIOS.length + 1,
    );
    for (const label of [
      "Kandidat pemenang awal",
      "Kandidat scaling",
      "Data belum cukup",
      "Lanjut uji",
      "Risiko stop-loss",
      "Margin tidak sehat",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // Every card uses the HPP-based wording and carries the limitation note.
    const cards = DEMO_METRICS.length + DEMO_VERDICT_SCENARIOS.length;
    expect(screen.getAllByText("Estimasi Break-even ROAS (berdasarkan HPP)")).toHaveLength(cards);
    expect(screen.getAllByText(/bukan titik impas laba bersih/)).toHaveLength(cards);
    expect(screen.queryByText("Break-even ROAS")).toBeNull();
    // Every scenario card is labelled as simulated.
    expect(screen.getAllByText("DATA SIMULASI / DEMO").length).toBeGreaterThanOrEqual(cards + 1);
    expect(screen.getByText(/bukan jaminan hasil iklan/)).toBeInTheDocument();
  });

  it("the seeded demo data yields the expected verdicts", () => {
    const product = DEMO_PRODUCTS[0];
    const verdict = (
      m: { adSpend: number; impressions: number; clicks: number; conversions: number; revenue: number },
      d: number,
      o?: { unitPrice?: number; hpp?: number },
    ) =>
      evaluateAdPerformance({
        spend: m.adSpend,
        impressions: m.impressions,
        clicks: m.clicks,
        conversions: m.conversions,
        revenue: m.revenue,
        hpp: o?.hpp ?? product.hpp,
        unitPrice: o?.unitPrice ?? product.price,
        daysObserved: d,
      }).verdict;
    const byChannel = Object.fromEntries(
      DEMO_METRICS.map((m) => [m.channel, verdict({ ...m, conversions: m.orders }, DEMO_CAMPAIGN.durationDays)]),
    );
    expect(byChannel).toEqual({ INSTAGRAM: "PEMENANG_AWAL", TIKTOK: "KANDIDAT_SCALING" });
    expect(DEMO_VERDICT_SCENARIOS.map((s) => verdict(s.metrics, s.daysObserved, s))).toEqual([
      "DATA_BELUM_CUKUP",
      "LANJUT_UJI",
      "STOP_LOSS",
      "MARGIN_TIDAK_SEHAT",
    ]);
  });

  it("Phase 2A safety: the engine, card and page import no database, platform, AI or approval code", () => {
    const FORBIDDEN_IMPORT = /supabase|connectors|launch-actions|optimization-actions|services\/|ai-jobs|approval|budget-guard/i;
    for (const file of ["lib/ad-performance-verdict.ts", "features/demo/ad-verdict-card.tsx", "app/demo/analytics/page.tsx"]) {
      const src = readFileSync(file, "utf8");
      const imports = src.split("\n").filter((l) => /^\s*(import|export) .* from /.test(l) || /^import "/.test(l));
      for (const line of imports) expect(line, `${file}: ${line}`).not.toMatch(FORBIDDEN_IMPORT);
      expect(src, file).not.toMatch(/"use server"|\bfetch\(/);
    }
  });
});

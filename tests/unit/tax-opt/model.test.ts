import { describe, expect, it } from "vitest";
import { buildDemoOptimization, parseScenario } from "@/lib/admin/demo-optimization";
import { figureView, runOptimization } from "@/lib/tax-opt";

describe("optimization model", () => {
  it("real demo state: nothing is computed, nothing ready", () => {
    const r = runOptimization(buildDemoOptimization("nyata"));
    expect(r.readyToUse).toBe(false);
    expect(r.simulation.lines.find((l) => l.id === "FINAL")!.figure.amount).toBeNull();
    expect(r.simulation.savingsTotal.state).toBe("BELUM_DAPAT_DIHITUNG");
    expect(r.openItems.length).toBeGreaterThan(0);
  });
  it("contoh scenario: numbers exist but demo keeps it not ready", () => {
    const r = runOptimization(buildDemoOptimization("contoh"));
    expect(r.simulation.lines.find((l) => l.id === "FINAL")!.figure.amount).not.toBeNull();
    expect(r.readyToUse).toBe(false);
    expect(r.openItems).toContain("Masih data DEMO.");
  });
  it("DEMO never shows TERVERIFIKASI, even in the complete fictional scenario", () => {
    const r = runOptimization(buildDemoOptimization("contoh"));
    for (const l of r.simulation.lines) expect(l.figure.state).not.toBe("TERVERIFIKASI");
    expect(r.simulation.savingsTotal.state).toBe("SIMULASI");
  });
  it("demo expenses: missing receipt flagged, nondeductible becomes separate adjustment only", () => {
    const r = runOptimization(buildDemoOptimization("contoh"));
    expect(r.findings.some((f) => f.text.includes("Iklan"))).toBe(true);
  });
  it("final tax credit never counted; double evidence flagged", () => {
    const r = runOptimization(buildDemoOptimization("contoh"));
    expect(r.credits.findings.find((f) => f.id === "DEMO-C3")!.status).toBe("BUKAN_KREDIT_PAJAK_FINAL");
    expect(r.credits.findings.find((f) => f.id === "DEMO-C2")!.status).toBe("DUGAAN_PEMBAYARAN_GANDA");
  });
  it("scenario parsing accepts only contoh", () => {
    expect(parseScenario("contoh")).toBe("contoh");
    expect(parseScenario("x")).toBe("nyata");
    expect(parseScenario(["contoh"])).toBe("nyata");
  });
  it("figure view hides amounts that are not computed", () => {
    const r = runOptimization(buildDemoOptimization("nyata"));
    expect(figureView(r.simulation.savingsTotal).text).toBeNull();
  });
});

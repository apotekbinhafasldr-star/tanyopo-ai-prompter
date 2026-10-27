import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MetaReadinessView, READINESS_DISCLAIMER } from "@/features/connections/meta-readiness-view";
import {
  evaluateMetaReadiness,
  unavailableMetaReadiness,
  type MetaAdAccountSnapshot,
} from "@/lib/connectors/meta-readiness";

const NOW = new Date("2026-10-27T10:00:00.000Z");
const GOOD: MetaAdAccountSnapshot = {
  accountStatus: 1,
  currency: "IDR",
  isPrepayAccount: false,
  hasFundingSource: true,
  minDailyBudgetRaw: 25000,
};

function render(result: ReturnType<typeof evaluateMetaReadiness>) {
  return renderToStaticMarkup(<MetaReadinessView result={result} />);
}

describe("MetaReadinessView", () => {
  it("shows READY with the limits of what was checked", () => {
    const html = render(evaluateMetaReadiness(GOOD, NOW));
    expect(html).toContain('data-state="READY"');
    expect(html).toContain("Siap");
    expect(html).toContain(READINESS_DISCLAIMER);
    expect(html).toContain("tidak membaca saldo");
    // Never promises delivery or funds.
    expect(html).not.toContain("dana cukup");
    expect(html).not.toContain("pasti tayang");
  });

  it("shows NOT_READY with the specific, actionable problem", () => {
    const html = render(evaluateMetaReadiness({ ...GOOD, currency: "USD" }, NOW));
    expect(html).toContain('data-state="NOT_READY"');
    expect(html).toContain("Belum siap");
    expect(html).toContain("USD");
    expect(html).toContain("hanya mendukung akun iklan bermata uang IDR");
  });

  it("shows UNKNOWN as uncertain, never as success", () => {
    const html = render(evaluateMetaReadiness({ ...GOOD, hasFundingSource: null }, NOW));
    expect(html).toContain('data-state="UNKNOWN"');
    expect(html).toContain("Belum bisa dipastikan");
    expect(html).not.toContain('data-state="READY"');
    expect(html).toContain("bg-warning-muted");
    expect(html).not.toContain("bg-success-muted");
  });

  it("explains the multiple-ad-accounts limitation instead of choosing one", () => {
    const html = render(unavailableMetaReadiness("MULTIPLE_AD_ACCOUNTS", NOW));
    expect(html).toContain('data-state="UNKNOWN"');
    expect(html).toContain("tidak memilih salah satunya");
  });

  it("explains an expired token and how to recover", () => {
    const html = render(unavailableMetaReadiness("TOKEN_EXPIRED", NOW));
    expect(html).toContain("Sambungkan Ulang");
  });

  it("labels min_daily_budget as an unconverted raw value", () => {
    const html = render(evaluateMetaReadiness(GOOD, NOW));
    expect(html).toContain("25000");
    expect(html).toContain("belum dikonversi");
  });

  it("omits min_daily_budget when it is not available", () => {
    const html = render(evaluateMetaReadiness({ ...GOOD, minDailyBudgetRaw: null }, NOW));
    expect(html).not.toContain("Budget harian minimum");
  });

  it("contains no identifiers or secrets", () => {
    const html = render(evaluateMetaReadiness(GOOD, NOW));
    expect(html).not.toMatch(/act_\d/);
    expect(html).not.toMatch(/token/i);
  });
});

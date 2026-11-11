import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_TIERS } from "@/lib/billing/plans";
import { BUDGET_WRITE_ENABLED_PLATFORMS } from "@/lib/campaigns/external-budget-guard";

// Guards the soft-launch docs against drifting from the numbers the product actually enforces.
const root = process.cwd();
const soft = readFileSync(path.join(root, "docs/SOFT_LAUNCH_10_TENANTS.md"), "utf8");
const legal = readFileSync(path.join(root, "docs/LEGAL_PSE_CHECKLIST.md"), "utf8");

describe("docs/SOFT_LAUNCH_10_TENANTS.md", () => {
  it("states the FREE trial limits from lib/billing/plans.ts", () => {
    const free = PLAN_TIERS.find((tier) => tier.id === "FREE");
    expect(free).toBeDefined();
    const { aiUsageAllowance, maxActiveProducts, maxActiveCampaigns, maxUsers } = free!.limits;
    expect(soft).toContain(
      `**14 hari**, **${aiUsageAllowance} penggunaan AI**, **${maxActiveProducts} produk aktif**, **${maxActiveCampaigns} kampanye aktif**, **${maxUsers} pengguna**`,
    );
  });

  it("only claims the S1 gate is closed while the allowlist really is empty", () => {
    expect(BUDGET_WRITE_ENABLED_PLATFORMS).toHaveLength(0);
    expect(soft).toContain("`BUDGET_WRITE_ENABLED_PLATFORMS` kosong");
  });

  it("keeps live payments, admin center and ad publishing off in the launch rules", () => {
    expect(soft).toContain("`PAYMENT_LIVE_ENABLED` kosong");
    expect(soft).toContain("`ADMIN_CENTER_ENABLED` kosong");
    expect(soft).toContain("tanpa publish iklan");
  });

  it("carries the 3 x 24 hour notification rule and the manual deletion procedure", () => {
    expect(soft).toContain("3 x 24 jam");
    expect(soft).toContain("Prosedur penghapusan data manual");
    expect(soft).toContain("Pemantauan minimum dari HP");
  });

  it("never makes a laptop or PC a prerequisite", () => {
    expect(soft).not.toMatch(/wajib (memakai|pakai|punya) (laptop|pc|komputer)/i);
  });
});

describe("docs/LEGAL_PSE_CHECKLIST.md", () => {
  it("separates verified from needs-confirmation and says it is not legal advice", () => {
    expect(legal).toContain("TERVERIFIKASI (resmi)");
    expect(legal).toContain("PERLU KONFIRMASI");
    expect(legal).toMatch(/bukan nasihat hukum/i);
  });

  it("dates every access to 2026-11-11 and cites the PP 71/2019 Pasal 6 source", () => {
    expect(legal).toContain("2026-11-11");
    expect(legal).toContain("https://jdih.komdigi.go.id/produk_hukum/view/id/695/");
    expect(legal).toContain("KBLI 73100");
  });

  it("states that nothing was filed", () => {
    expect(legal).toMatch(/Tidak ada pengajuan, pendaftaran, atau komunikasi ke otoritas/);
  });
});

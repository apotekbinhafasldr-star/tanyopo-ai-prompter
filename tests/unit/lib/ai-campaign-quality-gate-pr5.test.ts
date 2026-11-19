import { describe, expect, it } from "vitest";
import {
  blockingIssues,
  evaluateCampaignQuality,
  formatBlockingIssuesMessage,
  hasBlockingIssue,
} from "@/lib/ai/campaign-quality-gate";
import { KOPI_ROBUSTA_IMPROVED, KOPI_ROBUSTA_SIMULASI } from "@/tests/fixtures/ai/kopi-robusta-aceh-simulasi";
import type { CampaignProposal } from "@/schemas/ai/campaign-proposal";

/**
 * PR-5: FINANCIAL_CLAIM and SPECIAL_CATEGORY (both severity "block"), the blocking helpers, and the
 * guarantee that neither rule is excused by the product description.
 */

const ctx = {
  productName: KOPI_ROBUSTA_SIMULASI.productName,
  knownFacts: KOPI_ROBUSTA_SIMULASI.knownFacts,
  isSimulation: false,
};

/** The grounded fixture with candidate 2's hook replaced (candidates[0] and the active copy stay clean). */
function withHook(hook: string): CampaignProposal {
  const p: CampaignProposal = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED));
  p.candidates[1] = { ...p.candidates[1], hook };
  return p;
}

function codesFor(hook: string, knownFacts: string = ctx.knownFacts) {
  return evaluateCampaignQuality(withHook(hook), { ...ctx, knownFacts }).issues.map((i) => i.code);
}

describe("baseline", () => {
  it("the grounded fixture has no blocking issue", () => {
    const r = evaluateCampaignQuality(KOPI_ROBUSTA_IMPROVED, ctx);
    expect(hasBlockingIssue(r)).toBe(false);
    expect(blockingIssues(r)).toEqual([]);
    expect(formatBlockingIssuesMessage(r)).toBeNull();
  });
});

describe("FINANCIAL_CLAIM (block, claim_risk)", () => {
  it.each([
    // quick loans / credit
    "Pinjaman cepat cair hari ini",
    "PINJAMAN-CEPAT tanpa jaminan",
    "Kredit  cepat untuk usaha",
    "Dapatkan pinjol legal",
    "Fast loan approval",
    // investment
    "Investasi kopi untung besar",
    "Mulai berinvestasi sekarang",
    "Invest in your future",
    "Beli saham kopi",
    "Trading crypto",
    // get rich / passive income
    "Cepat kaya dengan kopi",
    "cepat-kaya!",
    "Get rich quick",
    "Passive income dari rumah",
    "Penghasilan pasif jutaan",
    "Jadi jutawan baru",
    "Financial freedom",
    // no-risk money promises
    "Modal kecil untung besar",
    "MODAL KECIL, UNTUNG BESAR!",
    "Modal minim cuan berlipat",
    "Small capital, big profit",
    "Balik modal cepat",
    "Pasti cuan setiap hari",
    "pasti profit",
    "Guaranteed profit",
    "Bebas riba tanpa risiko",
  ])("blocks %j", (hook) => {
    const r = evaluateCampaignQuality(withHook(hook), ctx);
    const issue = r.issues.find((i) => i.code === "FINANCIAL_CLAIM");
    expect(issue, hook).toBeDefined();
    expect(issue?.severity).toBe("block");
    expect(issue?.dimension).toBe("claim_risk");
    expect(hasBlockingIssue(r)).toBe(true);
    expect(r.status).toBe("FAIL");
    expect(r.dimensions.find((d) => d.id === "claim_risk")?.status).toBe("FAIL");
  });

  it.each([
    "Kopi kaya rasa dan aroma",
    "Kaya serat dan nutrisi",
    "Kredit foto: Dina",
    "Foto oleh tim kreatif, kredit untuk fotografer",
    "Investigasi rasa biji baru",
    "Tidak cepat basi dan kaya aroma",
    "Kopi pagi tanpa perut perih",
    "Beli satu gratis satu cuan",
  ])("does not block ordinary copy %j", (hook) => {
    expect(codesFor(hook)).not.toContain("FINANCIAL_CLAIM");
  });

  it("is NOT excused when the same words are in the product description", () => {
    const facts = "Kami menawarkan pinjaman cepat, passive income dan investasi kopi.";
    for (const hook of ["Pinjaman cepat untuk usaha kopi", "Passive income dari kopi", "Investasi kopi"]) {
      const r = evaluateCampaignQuality(withHook(hook), { ...ctx, knownFacts: facts });
      expect(r.issues.map((i) => i.code), hook).toContain("FINANCIAL_CLAIM");
      expect(hasBlockingIssue(r)).toBe(true);
    }
  });
});

describe("SPECIAL_CATEGORY (block, ad_policy)", () => {
  it.each([
    // credit / loans / leasing
    "Kartu kredit untuk pecinta kopi",
    "Kredit motor murah",
    "Ajukan pinjaman usaha",
    "Leasing mobil",
    "Home loan offer",
    "Mortgage rates",
    // employment
    "Lowongan kerja barista",
    "Kami membuka lowongan",
    "Open recruitment barista",
    "We're hiring baristas",
    "Now hiring",
    "Rekrutmen karyawan",
    // housing
    "KPR tanpa DP",
    "Cicilan KPR ringan",
    "Sewa rumah dekat kampus",
    "Apartemen disewakan",
    "Properti dijual",
    "Perumahan baru",
    "Apartment for rent",
    "Real estate listing",
    // social issues / elections / politics
    "Pilkada 2029 coblos nomor 2",
    "Kampanye politik kami",
    "Calon presiden pilihan",
    "Vote now for change",
    "Partai politik baru",
    "Pemilu",
  ])("blocks %j", (hook) => {
    const r = evaluateCampaignQuality(withHook(hook), ctx);
    const issue = r.issues.find((i) => i.code === "SPECIAL_CATEGORY");
    expect(issue, hook).toBeDefined();
    expect(issue?.severity).toBe("block");
    expect(issue?.dimension).toBe("ad_policy");
    expect(hasBlockingIssue(r)).toBe(true);
    expect(r.dimensions.find((d) => d.id === "ad_policy")?.status).toBe("FAIL");
  });

  it("explains that Meta requires special_ad_categories, LINOE does not support it yet, and Meta ads are blocked", () => {
    const issue = evaluateCampaignQuality(withHook("Lowongan kerja barista"), ctx).issues.find((i) => i.code === "SPECIAL_CATEGORY");
    expect(issue?.message).toContain("special_ad_categories");
    expect(issue?.message).toMatch(/Meta mewajibkan/);
    expect(issue?.message).toMatch(/LINOE belum mendukung/);
    expect(issue?.message).toMatch(/diblokir/);
  });

  it.each([
    "Kredit foto: Dina",
    "Sewa kamera untuk liburan",
    "Loker penyimpanan barang",
    "Properti foto studio",
    "Pinjam gelas gratis",
    "Home brew set",
    "Hiring photographer",
    "Kampanye promo akhir tahun",
    "Partai besar harga grosir",
    "Rumah kopi kami buka setiap hari",
  ])("does not block ordinary copy %j", (hook) => {
    expect(codesFor(hook)).not.toContain("SPECIAL_CATEGORY");
  });

  it("is NOT excused when the same words are in the product description", () => {
    const facts = "Kami membuka lowongan kerja barista, kredit motor dan sewa rumah.";
    for (const hook of ["Lowongan kerja barista", "Kredit motor", "Sewa rumah dekat kampus"]) {
      const r = evaluateCampaignQuality(withHook(hook), { ...ctx, knownFacts: facts });
      expect(r.issues.map((i) => i.code), hook).toContain("SPECIAL_CATEGORY");
      expect(hasBlockingIssue(r)).toBe(true);
    }
  });
});

describe("existing rules keep their behaviour", () => {
  it("MEDICAL_CLAIM is still a warning and is still excused by the product description", () => {
    const r = evaluateCampaignQuality(withHook("Menyembuhkan maag"), ctx);
    const issue = r.issues.find((i) => i.code === "MEDICAL_CLAIM");
    expect(issue?.severity).toBe("warn");
    expect(hasBlockingIssue(r)).toBe(false);
    expect(codesFor("Menyembuhkan maag", "Kopi robusta. Menyembuhkan maag, 200 gram.")).not.toContain("MEDICAL_CLAIM");
  });

  it("a proof term in the product description is still excused (UNVERIFIED_PROOF)", () => {
    expect(codesFor("Kopi terlaris di kota", "Kopi terlaris di kota, 200 gram")).not.toContain("UNVERIFIED_PROOF");
  });
});

describe("the copy that is actually launched is checked too", () => {
  it("blocks a financial claim that exists only in the active (top-level) headline, e.g. after an owner edit", () => {
    const p: CampaignProposal = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED));
    p.headline = "Passive income dari kopi";
    const r = evaluateCampaignQuality(p, ctx);
    expect(r.issues.find((i) => i.code === "FINANCIAL_CLAIM")?.message).toMatch(/Judul aktif/);
    expect(hasBlockingIssue(r)).toBe(true);
  });

  it("blocks a special category that exists only in the active hook and CTA", () => {
    const p: CampaignProposal = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED));
    p.hook = "Lowongan kerja barista";
    expect(hasBlockingIssue(evaluateCampaignQuality(p, ctx))).toBe(true);
    const q: CampaignProposal = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED));
    q.cta = "Ajukan kredit motor";
    expect(hasBlockingIssue(evaluateCampaignQuality(q, ctx))).toBe(true);
  });

  it("reports nothing extra when the active copy equals candidates[0]", () => {
    expect(evaluateCampaignQuality(KOPI_ROBUSTA_IMPROVED, ctx).issues).toEqual([]);
  });
});

describe("blocking helpers", () => {
  it("hasBlockingIssue is false for warnings only and true for any block", () => {
    const warnOnly = evaluateCampaignQuality(withHook("Stok terbatas, terlaris di kotanya"), ctx);
    expect(warnOnly.issues.length).toBeGreaterThan(0);
    expect(hasBlockingIssue(warnOnly)).toBe(false);
    expect(blockingIssues(warnOnly)).toEqual([]);

    const blocked = evaluateCampaignQuality(withHook("Pasti cuan"), ctx);
    expect(hasBlockingIssue(blocked)).toBe(true);
    expect(blockingIssues(blocked).every((i) => i.severity === "block")).toBe(true);
  });

  it("formatBlockingIssuesMessage is actionable Indonesian: what, the excerpt, revise or regenerate, submit again", () => {
    const msg = formatBlockingIssuesMessage(evaluateCampaignQuality(withHook("Passive income dari rumah"), ctx));
    expect(msg).toMatch(/belum bisa diajukan/i);
    expect(msg).toContain("Passive income");
    expect(msg).toMatch(/Revisi copy/);
    expect(msg).toMatch(/buat ulang strategi/);
    expect(msg).toMatch(/ajukan lagi/);
    expect(msg).toMatch(/Tidak ada pengajuan yang dibuat/);
  });

  it("formatBlockingIssuesMessage lists at most three issues and counts the rest", () => {
    const p: CampaignProposal = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED));
    p.candidates[1] = {
      ...p.candidates[1],
      hook: "Passive income dari kopi",
      headline: "Pinjaman cepat untuk usaha",
      primary_text: `${p.candidates[1].primary_text} Lowongan kerja barista. Sewa rumah dekat kampus. Cepat kaya, investasi aman.`,
    };
    const r = evaluateCampaignQuality(p, ctx);
    expect(blockingIssues(r).length).toBeGreaterThan(3);
    const msg = formatBlockingIssuesMessage(r) ?? "";
    expect(msg).toMatch(/3\)/);
    expect(msg).not.toMatch(/4\)/);
    expect(msg).toMatch(/Masih ada \d+ masalah lain/);
  });
});

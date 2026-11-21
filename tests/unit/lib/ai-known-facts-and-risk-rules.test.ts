import { describe, expect, it } from "vitest";
import { evaluateCampaignQuality, hasBlockingIssue } from "@/lib/ai/campaign-quality-gate";
import { buildKnownFacts, priceRenderings } from "@/lib/ai/known-facts";
import { KOPI_ROBUSTA_IMPROVED, KOPI_ROBUSTA_SIMULASI, KOPI_ROBUSTA_WEAK } from "@/tests/fixtures/ai/kopi-robusta-aceh-simulasi";
import type { CampaignProposal } from "@/schemas/ai/campaign-proposal";

// Isolated fixture product (mirrors the AI smoke product); not shared with other suites.
const PRODUCT = {
  name: "Kopi Susu Aren Contoh",
  category: "Minuman",
  description: "Minuman kopi susu gula aren dalam botol 250 ml, dijual lewat toko online.",
  price: 18000,
  currency: "IDR",
};
const baseCtx = { productName: PRODUCT.name, copyScope: "active" as const };

/** Improved fixture with the active copy's primary_text replaced. */
function withText(primary_text: string): CampaignProposal {
  const p: CampaignProposal = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED));
  p.primary_text = primary_text;
  return p;
}
const codes = (text: string, facts = buildKnownFacts(PRODUCT)) =>
  evaluateCampaignQuality(withText(text), { ...baseCtx, knownFacts: facts }).issues.map((i) => i.code);

describe("buildKnownFacts / priceRenderings", () => {
  it("renders an IDR price several ways", () => {
    const r = priceRenderings(18000, "IDR");
    for (const v of ["18000", "18.000", "Rp18.000", "Rp 18.000", "Rp18rb", "Rp 18rb", "Rp18k"]) expect(r).toContain(v);
  });
  it("accepts a numeric string and ignores null/zero/garbage", () => {
    expect(priceRenderings("18000.00")).toContain("Rp18.000");
    expect(priceRenderings(null)).toEqual([]);
    expect(priceRenderings(0)).toEqual([]);
    expect(priceRenderings("abc")).toEqual([]);
  });
  it("includes name, category, description and price; empty for null", () => {
    const f = buildKnownFacts(PRODUCT);
    for (const v of [PRODUCT.name, "Minuman", "250 ml", "Rp18.000"]) expect(f).toContain(v);
    expect(buildKnownFacts(null)).toBe("");
  });
  it("only contains what it is given (no AI text can leak in)", () => {
    expect(buildKnownFacts({ name: "X" })).toBe("X");
  });
});

describe("UNSUPPORTED_SPEC with trusted facts", () => {
  it.each(["Rp18.000", "Rp 18.000", "Rp18rb", "Rp 18rb"])("price %s is a known fact (also at sentence end)", (rp) => {
    expect(codes(`Minuman kopi susu aren botol 250 ml cuma ${rp}. Cek detailnya dulu sebelum memilih.`)).not.toContain("UNSUPPORTED_SPEC");
  });
  it("still flags a price that is NOT the product price", () => {
    expect(codes("Kopi susu aren botol 250 ml cuma Rp9.000 hari ini untuk Anda yang suka manis.")).toContain("UNSUPPORTED_SPEC");
  });
  it("old behaviour (description only) raised it; new facts do not", () => {
    const text = "Kopi susu aren botol 250 ml hanya Rp18.000 untuk Anda yang suka manis.";
    expect(codes(text, PRODUCT.description)).toContain("UNSUPPORTED_SPEC");
    expect(codes(text)).not.toContain("UNSUPPORTED_SPEC");
  });
  it("a discount is a fact only when the owner supplies it", () => {
    const text = "Kopi susu aren botol 250 ml, diskon 20% untuk Anda yang suka manis.";
    expect(codes(text)).toContain("UNSUPPORTED_SPEC");
    expect(codes(text, buildKnownFacts(PRODUCT, ["Diskon 20%"]))).not.toContain("UNSUPPORTED_SPEC");
  });
  it("an invented shelf life stays flagged", () => {
    expect(codes("Kopi susu aren botol 250 ml, tahan 3 hari di kulkas untuk Anda yang suka manis.")).toContain("UNSUPPORTED_SPEC");
  });
});

describe("phone / URL widening (block)", () => {
  it.each([
    "Hubungi 0812-3456-7890", "Hubungi +62 812 3456 7890", "Hubungi +62812-3456-7890", "Hubungi 62812 3456 7890",
    "Hubungi 0812.3456.7890", "Hubungi 081234567890", "Chat wa.me/6281234567890", "Order di bit.ly/kopi-aren",
    "Cek linktr.ee/kopi", "Kunjungi kopi.co.id", "Kunjungi kopiaren.com", "Kunjungi kopiaren.me",
  ])("blocks: %s", (t) => {
    const c = codes(`${t} untuk Anda yang suka kopi susu aren botol 250 ml.`);
    expect(c.some((x) => x === "PHONE_IN_COPY" || x === "URL_IN_COPY")).toBe(true);
  });
  it.each(["Isi 250 ml untuk Anda yang suka kopi susu aren.", "Harga Rp18.000 per botol 250 ml, kopi susu aren.", "Dibuat tahun 2024 dengan gula aren, isi 250 ml."])(
    "no false positive: %s",
    (t) => {
      const c = codes(t);
      expect(c).not.toContain("PHONE_IN_COPY");
      expect(c).not.toContain("URL_IN_COPY");
    },
  );
});

describe("new high-risk claim rules", () => {
  const BLOCK: [string, string][] = [
    ["INCOME_CLAIM", "Penghasilan Rp 5 juta per bulan dari rumah"],
    ["INCOME_CLAIM", "Raih penghasilan 10 juta/bulan dengan kopi ini"],
    ["BEFORE_AFTER_PERSONAL", "Lihat foto sebelum dan sesudah berat badan Anda"],
    ["BEFORE_AFTER_PERSONAL", "Before after kulit wajah jerawat"],
    ["PERSONAL_ATTRIBUTE", "Kamu sedang menderita diabetes? Minum ini"],
    ["PERSONAL_ATTRIBUTE", "Anda masih gemuk dan malu?"],
    ["WEIGHT_LOSS_CLAIM", "Turun 5 kg dalam seminggu"],
    ["MEDICAL_CURE", "Menyembuhkan diabetes dan kolesterol"],
    ["MEDICAL_CURE", "Obat kanker alami"],
    ["GAMBLING", "Slot gacor malam ini"],
    ["GUARANTEED_RESULT", "Dijamin laris di pasaran"],
  ];
  it.each(BLOCK)("%s blocks: %s", (code, t) => {
    const r = evaluateCampaignQuality(withText(`${t}. Kopi susu aren botol 250 ml.`), { ...baseCtx, knownFacts: buildKnownFacts(PRODUCT) });
    expect(r.issues.find((i) => i.code === code)?.severity).toBe("block");
    expect(hasBlockingIssue(r)).toBe(true);
  });
  it("block rules are NOT excused by the product description", () => {
    const facts = buildKnownFacts({ ...PRODUCT, description: "Turun 5 kg dalam seminggu, slot gacor" });
    expect(codes("Turun 5 kg dalam seminggu. Kopi susu aren botol 250 ml.", facts)).toContain("WEIGHT_LOSS_CLAIM");
    expect(codes("Slot gacor. Kopi susu aren botol 250 ml.", facts)).toContain("GAMBLING");
  });
  const WARN: [string, string][] = [
    ["GUARANTEED_QUALITY", "Dijamin segar setiap hari"],
    ["MEDICAL_CLAIM", "Membantu menyembuhkan lelah"],
    ["BEFORE_AFTER", "Sebelum dan sesudah memakai pembersih lantai"],
    ["CLINICAL_CLAIM", "Terbukti klinis dan detox alami"],
    ["SUPERLATIVE_CLAIM", "Paling murah di kota, #1 pilihan"],
    ["MONEY_BACK_GUARANTEE", "Garansi uang kembali"],
    ["ALCOHOL", "Wine pilihan untuk malam santai"],
  ];
  it.each(WARN)("%s warns (not blocks): %s", (code, t) => {
    const r = evaluateCampaignQuality(withText(`${t}. Kopi susu aren botol 250 ml.`), { ...baseCtx, knownFacts: buildKnownFacts(PRODUCT) });
    expect(r.issues.find((i) => i.code === code)?.severity).toBe("warn");
    expect(r.issues.filter((i) => i.code === code && i.severity === "block")).toEqual([]);
  });
  it("'dijamin segar' is a warn, never a block; 'dijamin' + outcome word is still a block", () => {
    const seg = evaluateCampaignQuality(withText("Dijamin segar setiap hari. Kopi susu aren botol 250 ml."), { ...baseCtx, knownFacts: buildKnownFacts(PRODUCT) });
    expect(seg.issues.map((i) => i.code)).not.toContain("GUARANTEED_RESULT");
    expect(hasBlockingIssue(seg)).toBe(false);
    expect(codes("Dijamin laris. Kopi susu aren botol 250 ml.")).toContain("GUARANTEED_RESULT");
  });
  it("'bebas alkohol' and ordinary copy do not fire", () => {
    expect(codes("Kopi susu aren bebas alkohol, botol 250 ml, cocok untuk Anda yang suka manis.")).not.toContain("ALCOHOL");
  });
});

describe("review fixes: facts never excuse result promises; price copy is not income", () => {
  const poisoned = "Dijamin laris manis. Omzet naik 3 kali. Dijamin sembuh total. Dijamin segar.\n" + buildKnownFacts(PRODUCT);
  it("result promises stay BLOCK even if the same words are in the facts", () => {
    expect(codes("Dijamin laris manis untuk usahamu.", poisoned)).toContain("GUARANTEED_RESULT");
    expect(codes("Dijamin sembuh total dalam seminggu.", poisoned)).toContain("GUARANTEED_RESULT");
    expect(codes("Omzet naik 3 kali lipat.", poisoned)).toContain("NUMERIC_RESULT_PROMISE");
    expect(codes("Obat ajaib, menyembuhkan diabetes.", "menyembuhkan diabetes")).toContain("MEDICAL_CURE");
  });
  it("dijamin segar stays WARN, not BLOCK", () => {
    const c = codes("Dijamin segar setiap hari.");
    expect(c).toContain("GUARANTEED_QUALITY");
    expect(c).not.toContain("GUARANTEED_RESULT");
  });
  it("ordinary price / subscription / rent copy is not an income claim", () => {
    for (const t of ["Langganan Rp99.000 per bulan.", "Kost Rp 1,5 juta per bulan, dekat kampus.", "Untung banget, cuma Rp18.000!", "Cicilan 1 juta per bulan."]) {
      expect(codes(t)).not.toContain("INCOME_CLAIM");
    }
  });
  it("CTA price copy with 'Dapatkan/Raih ... per bulan' is not an income claim", () => {
    for (const t of ["Dapatkan langganan Rp99.000 per bulan.", "Dapatkan kamar kost Rp1,5 juta per bulan.", "Raih paket hemat Rp300 ribu per bulan.", "Dapat 2 porsi Rp25.000 per hari ini saja."]) {
      expect(codes(t)).not.toContain("INCOME_CLAIM");
    }
  });
  it("more income / growth promises block", () => {
    for (const t of ["Dapat Rp500 ribu per hari dari rumah.", "Komisi Rp2 juta per order.", "Penghasilan jutaan rupiah tiap bulan."]) expect(codes(t)).toContain("INCOME_CLAIM");
    expect(codes("Omzet melonjak 300%.")).toContain("NUMERIC_RESULT_PROMISE");
  });
  it("benign product guarantees are WARN, not block", () => {
    for (const t of ["Dijamin awet bertahun-tahun.", "Dijamin aman untuk bayi."]) expect(codes(t)).not.toContain("GUARANTEED_RESULT");
  });
  it("final QA gaps: quality word + result claim blocks; adjacent earn-amount-period blocks", () => {
    for (const t of ["Dijamin asli sembuh total.", "Dijamin halal laris manis.", "Dijamin segar dan cuan besar."]) expect(codes(t)).toContain("GUARANTEED_RESULT");
    for (const t of ["Dapat 5 jt perbulan.", "Dapat 5jt per bulan dari rumah.", "Bisa dapat 3 juta sehari.", "Dapatkan 10 juta/bulan."]) expect(codes(t)).toContain("INCOME_CLAIM");
    expect(codes("Dijamin segar setiap hari.")).not.toContain("GUARANTEED_RESULT");
    expect(codes("Dijamin segar setiap hari.")).toContain("GUARANTEED_QUALITY");
  });
  it("QA round 3: more income wording blocks; benign 'dijamin lancar/untung-untungan' does not", () => {
    for (const t of ["Dapatkan Rp5.000.000/bulan tanpa modal.", "Hasilkan Rp5.000.000 per bulan.", "Dapat 5 jt per bln.", "Dapat 5 juta setiap bulan.", "Dapet 5 jt perbulan."]) expect(codes(t)).toContain("INCOME_CLAIM");
    for (const t of ["Dijamin segar, bukan untung-untungan."]) expect(codes(t)).not.toContain("GUARANTEED_RESULT");
  });
  it("tenant description is not proof of a medical/financial claim", () => {
    const f = buildKnownFacts({ ...PRODUCT, description: "Menyembuhkan maag. Penghasilan Rp10 juta sebulan." });
    expect(codes("Menyembuhkan maag.", f)).toContain("MEDICAL_CLAIM");
    expect(codes("Penghasilan Rp10 juta sebulan.", f)).toContain("INCOME_CLAIM");
  });
  it("real income claims remain BLOCK", () => {
    for (const t of ["Penghasilan Rp10 juta sebulan dari rumah.", "Dapat 5 juta per bulan tanpa modal.", "Untung Rp2 juta sehari!"]) {
      expect(codes(t)).toContain("INCOME_CLAIM");
    }
  });
  it("'turun harga' is not weight loss; real weight-loss claims still block", () => {
    expect(codes("Turun harga 5 kg paket hemat.")).not.toContain("WEIGHT_LOSS_CLAIM");
    expect(codes("Turun 5 kg dalam seminggu.")).toContain("WEIGHT_LOSS_CLAIM");
  });
  it("non-string currency does not throw", () => {
    expect(() => priceRenderings(18000, 123 as unknown as string)).not.toThrow();
    expect(priceRenderings(18000, 123 as unknown as string)).toContain("Rp18.000");
  });
});

describe("regression: existing fixtures unchanged", () => {
  const ctx = { productName: KOPI_ROBUSTA_SIMULASI.productName, knownFacts: KOPI_ROBUSTA_SIMULASI.knownFacts, isSimulation: true };
  it("IMPROVED still PASS 100, WEAK still FAIL", () => {
    const imp = evaluateCampaignQuality(KOPI_ROBUSTA_IMPROVED, ctx);
    expect(imp.issues).toEqual([]);
    expect(imp.status).toBe("PASS");
    expect(imp.score).toBe(100);
    expect(evaluateCampaignQuality(KOPI_ROBUSTA_WEAK, ctx).status).toBe("FAIL");
  });
});

import { describe, expect, it } from "vitest";
import { evaluateCampaignQuality } from "@/lib/ai/campaign-quality-gate";
import type { CampaignProposal } from "@/schemas/ai/campaign-proposal";

function proposal(over: Partial<CampaignProposal> = {}): CampaignProposal {
  const base: CampaignProposal = {
    customer_pain: "Sulit menemukan kopi yang tidak terlalu asam untuk dinikmati di rumah.",
    desired_outcome: "Secangkir kopi yang halus dan seimbang setiap pagi.",
    value_proposition: "Kopi Arabika Gayo sangrai medium dengan rasa halus dan asam rendah.",
    positioning: "Kopi Gayo untuk penikmat pagi yang tidak suka asam.",
    audience_summary: "Pekerja kantoran yang menyeduh kopi sendiri di rumah.",
    marketing_angle: "Rasa halus tanpa asam berlebih.",
    candidates: [
      {
        hook: "Kopi pagi tanpa perut perih",
        headline: "Kopi Arabika Gayo, halus di lambung",
        cta: "Pesan sekarang",
        primary_text:
          "Banyak kopi terasa terlalu asam di pagi hari. Kopi Arabika Gayo sangrai medium ini dibuat lebih halus, jadi pagi Anda tetap nyaman. Coba satu kemasan.",
        rationale: "Menjawab keluhan asam.",
      },
      {
        hook: "Seduh di rumah, rasa seperti kedai",
        headline: "Biji pilihan dari dataran tinggi Gayo",
        cta: "Lihat pilihan rasa",
        primary_text:
          "Tidak perlu antre di kedai. Biji Gayo disangrai segar sehingga aroma lebih kuat saat diseduh di dapur sendiri. Pilih ukuran gilingan sesuai alat seduh Anda.",
        rationale: "Sudut kenyamanan.",
      },
      {
        hook: "Hadiah kecil untuk penyuka kopi",
        headline: "Kemasan rapi, siap dihadiahkan",
        cta: "Kirim sebagai hadiah",
        primary_text:
          "Mencari hadiah sederhana yang berguna? Kemasan kopi Gayo ini rapi dan mudah dikirim, cocok untuk rekan kerja atau keluarga yang gemar menyeduh kopi.",
        rationale: "Sudut hadiah.",
      },
    ],
    hook: "Kopi pagi tanpa perut perih",
    headline: "Kopi Arabika Gayo, halus di lambung",
    primary_text:
      "Banyak kopi terasa terlalu asam di pagi hari. Kopi Arabika Gayo sangrai medium ini dibuat lebih halus, jadi pagi Anda tetap nyaman. Coba satu kemasan.",
    cta: "Pesan sekarang",
    creative_concept: "Foto close-up cangkir kopi di meja kerja pagi hari.",
    budget_allocation: [
      { channel: "INSTAGRAM", percentage: 60, reason: "Visual produk kuat." },
      { channel: "FACEBOOK", percentage: 40, reason: "Audiens dewasa." },
    ],
    excluded_channels: [],
    recommended_channels: ["INSTAGRAM", "FACEBOOK"],
  };
  return { ...base, ...over };
}

const ctx = { productName: "Kopi Arabika Gayo", knownFacts: "Kopi Arabika Gayo sangrai medium, 200 gram." };

function codes(p: CampaignProposal, c = ctx) {
  return evaluateCampaignQuality(p, c).issues.map((i) => i.code);
}

describe("evaluateCampaignQuality", () => {
  it("passes a grounded, varied proposal with no rule firing", () => {
    const r = evaluateCampaignQuality(proposal(), ctx);
    expect(r.issues).toEqual([]);
    expect(r.status).toBe("PASS");
    expect(r.dimensions.every((d) => d.status === "PASS")).toBe(true);
  });

  it("FAILs a guaranteed-result promise and reports the excerpt", () => {
    const p = proposal();
    p.candidates[0] = { ...p.candidates[0], primary_text: `${p.candidates[0].primary_text} Penjualan dijamin laris minggu ini.` };
    const r = evaluateCampaignQuality(p, ctx);
    expect(r.status).toBe("FAIL");
    const issue = r.issues.find((i) => i.code === "GUARANTEED_RESULT");
    expect(issue?.severity).toBe("block");
    expect(issue?.excerpt?.toLowerCase()).toContain("dijamin");
    expect(r.dimensions.find((d) => d.id === "claim_risk")?.status).toBe("FAIL");
  });

  it("FAILs a numeric sales-result promise", () => {
    const p = proposal();
    p.candidates[1] = { ...p.candidates[1], hook: "Omzet naik 300% dalam sebulan" };
    expect(codes(p)).toContain("NUMERIC_RESULT_PROMISE");
  });

  it("FAILs a URL or phone number written into the copy", () => {
    const withUrl = proposal({ primary_text: "Pesan di www.tokokopi.com sekarang untuk pengiriman cepat ke seluruh kota Anda." });
    expect(codes(withUrl)).toContain("URL_IN_COPY");
    const p = proposal();
    p.candidates[2] = { ...p.candidates[2], primary_text: `${p.candidates[2].primary_text} Hubungi 0812-3456-7890.` };
    expect(codes(p)).toContain("PHONE_IN_COPY");
    expect(evaluateCampaignQuality(p, ctx).status).toBe("FAIL");
  });

  it("asks for REVIEW (not FAIL) on false urgency and unverified social proof", () => {
    const p = proposal();
    p.candidates[0] = { ...p.candidates[0], hook: "Stok terbatas, terlaris di kotanya" };
    const r = evaluateCampaignQuality(p, ctx);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["FALSE_URGENCY", "UNVERIFIED_PROOF"]));
    expect(r.status).toBe("REVIEW");
  });

  it("does not flag a proof term the user wrote in the product facts", () => {
    const p = proposal();
    p.candidates[0] = { ...p.candidates[0], hook: "Kopi bersertifikat organik" };
    expect(codes(p, { productName: ctx.productName, knownFacts: "Kopi organik bersertifikat organik, 200 gram" })).not.toContain(
      "UNVERIFIED_PROOF",
    );
    expect(codes(p, { productName: ctx.productName, knownFacts: "" })).toContain("UNVERIFIED_PROOF");
  });

  it("flags medical claims as REVIEW", () => {
    const p = proposal();
    p.candidates[1] = { ...p.candidates[1], primary_text: `${p.candidates[1].primary_text} Menyembuhkan maag kronis.` };
    expect(codes(p)).toContain("MEDICAL_CLAIM");
  });

  it("flags three candidates that are rewordings of one angle", () => {
    const c = proposal().candidates[0];
    const p = proposal({ candidates: [c, { ...c, headline: "Kopi Gayo halus" }, { ...c, headline: "Kopi Gayo nyaman" }] });
    expect(codes(p)).toContain("CANDIDATES_TOO_SIMILAR");
    expect(evaluateCampaignQuality(p, ctx).dimensions.find((d) => d.id === "differentiation")?.status).toBe("REVIEW");
  });

  it("flags weak or empty CTAs and thin copy", () => {
    const p = proposal();
    p.candidates[0] = { ...p.candidates[0], cta: "Klik di sini", primary_text: "Kopi enak." };
    const found = codes(p);
    expect(found).toContain("WEAK_CTA");
    expect(found).toContain("THIN_BODY_COPY");
  });

  it("flags generic filler and a proposal that never mentions the product", () => {
    const p = proposal();
    p.candidates = p.candidates.map((c) => ({ ...c, hook: "Solusi terbaik untuk hidup Anda", headline: "Kualitas terbaik", primary_text: c.primary_text.replace(/kopi|Kopi|Gayo|Arabika/g, "barang") }));
    p.value_proposition = "Barang yang membantu kebutuhan harian Anda dengan cara yang praktis dan mudah.";
    p.positioning = "Barang harian.";
    const found = codes(p);
    expect(found).toContain("GENERIC_FILLER");
    expect(found).toContain("PRODUCT_NOT_MENTIONED");
  });

  it("flags a budget split that does not add up to about 100%", () => {
    const p = proposal({ budget_allocation: [{ channel: "INSTAGRAM", percentage: 30, reason: "x" }] });
    expect(codes(p)).toContain("ALLOCATION_NOT_100");
  });

  it("reports one issue per rule+excerpt even when all three candidates repeat it", () => {
    const p = proposal();
    p.candidates = p.candidates.map((c) => ({ ...c, hook: "Dijamin laris" })) as CampaignProposal["candidates"];
    expect(evaluateCampaignQuality(p, ctx).issues.filter((i) => i.code === "GUARANTEED_RESULT")).toHaveLength(1);
  });

  it("is deterministic and side-effect free", () => {
    const p = proposal();
    const snapshot = JSON.stringify(p);
    expect(evaluateCampaignQuality(p, ctx)).toEqual(evaluateCampaignQuality(p, ctx));
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

import { describe, expect, it } from "vitest";
import { buildCampaignProposalPrompt, buildProposalAdditionsPrompt } from "@/lib/ai/prompts";
import { PROPOSAL_OBJECTIVE_VALUES } from "@/schemas/ai/proposal-objectives";

/**
 * PR-5 prompt: key sentences only. These are string checks on the instruction text, not a test of what a model does.
 */
const product = { name: "Kopi", product_type: "PHYSICAL", price: 1000, currency: "IDR", description: "Kopi robusta 200 gram" } as never;
const inputs = {
  objective: "WEBSITE_TRAFFIC",
  channels: ["FACEBOOK"],
  targetCountry: null,
  targetRegion: null,
  targetCity: null,
  audienceNotes: null,
  dailyBudget: 1,
  totalBudget: null,
  currency: "IDR",
};

const prompt = buildCampaignProposalPrompt(product, inputs);

describe("campaign proposal prompt (PR-5 additions)", () => {
  it("is part of the single proposal prompt (no second prompt/call is built)", () => {
    expect(prompt).toContain(buildProposalAdditionsPrompt());
  });

  it("restricts objective_recommendation to the given list, and lists exactly those values", () => {
    expect(prompt).toMatch(/objective_recommendation — pilih HANYA dari daftar ini/);
    for (const value of PROPOSAL_OBJECTIVE_VALUES) expect(prompt).toContain(value);
    expect(prompt).toMatch(/tidak mengubah tujuan campaign/);
    expect(prompt).toMatch(/tidak berarti objective itu sudah didukung untuk peluncuran/);
  });

  it("forbids inventing Meta interest/behavior IDs and asks for plain-text interests only", () => {
    expect(prompt).toMatch(/Jangan membuat ID minat, ID perilaku, atau ID targeting Meta/);
    expect(prompt).toMatch(/interest_suggestions_text berisi kata kunci minat berupa TEKS biasa saja/);
  });

  it("forbids invented performance numbers, market research, audience size, minimum budget", () => {
    expect(prompt).toMatch(/Jangan mengarang angka performa/);
    expect(prompt).toMatch(/hasil riset pasar, ukuran audiens, atau minimum budget/);
  });

  it("forbids promising ROI, guaranteed results and 'pasti winning'", () => {
    expect(prompt).toMatch(/Jangan menjanjikan ROI, hasil pasti, atau kata 'pasti winning'/);
  });

  it("tells the model to put absent facts in missing_facts instead of inventing them", () => {
    expect(prompt).toMatch(/missing_facts/);
    expect(prompt).toMatch(/jangan menebak atau mengarangnya di copy/);
  });

  it("forbids financial, health and special-category claims, and says what to do for such products", () => {
    expect(prompt).toMatch(/Jangan menghasilkan klaim finansial/);
    expect(prompt).toMatch(/klaim kesehatan\/pengobatan/);
    expect(prompt).toMatch(/kategori khusus/);
    expect(prompt).toMatch(/tulis copy yang netral dan informatif/);
  });

  it("the test plan carries no performance numbers or promised results", () => {
    expect(prompt).toMatch(/Tanpa angka performa dan tanpa janji hasil/);
  });

  it("contains no instruction that would ASK for the forbidden things", () => {
    // Every mention of these terms must sit inside a prohibition ("Jangan ...") or the explicit allow-list line.
    const additions = buildProposalAdditionsPrompt();
    expect(additions).not.toMatch(/\b(?:tentukan|hitung|berikan|sebutkan|buat)\s+(?:minimum budget|ID minat|angka CTR|riset pasar)/i);
    expect(additions).not.toMatch(/(?:pasti winning|ROI) (?:yang|akan)\b/i);
    expect(additions).not.toMatch(/gunakan ID/i);
  });

  it("is unchanged in the parts other tests rely on (no destination block when none is given)", () => {
    expect(prompt).not.toMatch(/Tujuan pembelian/);
    expect(buildCampaignProposalPrompt(product, inputs)).toBe(buildCampaignProposalPrompt(product, inputs, undefined));
  });
});

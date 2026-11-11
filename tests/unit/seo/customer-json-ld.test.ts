import { describe, expect, it } from "vitest";
import {
  buildCustomerFaqJsonLd,
  buildCustomerJsonLdExport,
  buildCustomerProductJsonLd,
  MAX_EXPORT_FAQ_ITEMS,
} from "@/lib/seo/customer-json-ld";
import {
  buildVerifiedFacts,
  sanitizeAiSearchReadiness,
  type StoredAiSearchReadiness,
} from "@/lib/seo/ai-search-readiness";
import type { AiSearchReadinessAi } from "@/schemas/ai/ai-search-readiness";

const facts = buildVerifiedFacts({
  brand: { brand_name: "Kopi Nusa", default_location: "Bandung", whatsapp_number: "08123456789" },
  product: {
    name: "Kopi Robusta 200gr",
    description: "Biji kopi robusta sangrai medium",
    category: "Makanan & Minuman",
    price: 55000,
    currency: "IDR",
  },
});

function ai(over: Partial<AiSearchReadinessAi> = {}): AiSearchReadinessAi {
  return {
    customer_questions: [
      { question: "Berapa harga Kopi Robusta 200gr?", short_answer: "Harganya IDR 55000.", owner_input_needed: null },
      { question: "Dari mana kopinya?", short_answer: null, owner_input_needed: "Isi asal biji kopi." },
      { question: "Bagaimana cara pesan?", short_answer: "Pesan lewat WhatsApp 08123456789.", owner_input_needed: null },
    ],
    entity_context: "Kopi Nusa adalah bisnis kopi di Bandung.",
    content_recommendations: [{ title: "FAQ kopi", format: "FAQ", reason: "Menjawab pertanyaan pelanggan." }],
    missing_facts: [],
    ...over,
  };
}

const stored = (over: Partial<AiSearchReadinessAi> = {}, f = facts): StoredAiSearchReadiness =>
  sanitizeAiSearchReadiness(ai(over), f);

describe("buildCustomerFaqJsonLd", () => {
  it("memuat hanya pertanyaan yang punya jawaban berdasar fakta (null dilewati)", () => {
    const faq = buildCustomerFaqJsonLd(stored());
    expect(faq?.["@context"]).toBe("https://schema.org");
    expect(faq?.["@type"]).toBe("FAQPage");
    expect(faq?.mainEntity.map((q) => q.name)).toEqual(["Berapa harga Kopi Robusta 200gr?", "Bagaimana cara pesan?"]);
    for (const q of faq!.mainEntity) {
      expect(q["@type"]).toBe("Question");
      expect(q.acceptedAnswer["@type"]).toBe("Answer");
      expect(q.acceptedAnswer.text.length).toBeGreaterThan(0);
    }
  });

  it("mengembalikan null bila tidak ada jawaban sama sekali", () => {
    const s = stored({
      customer_questions: [
        { question: "A?", short_answer: null, owner_input_needed: "x" },
        { question: "B?", short_answer: null, owner_input_needed: "x" },
        { question: "C?", short_answer: null, owner_input_needed: "x" },
      ],
    });
    expect(buildCustomerFaqJsonLd(s)).toBeNull();
  });

  it("memeriksa ulang data tersimpan: jawaban dengan angka di luar fakta tidak diekspor", () => {
    const s = stored();
    s.customer_questions[0].short_answer = "Harganya IDR 99999.";
    const faq = buildCustomerFaqJsonLd(s);
    expect(faq?.mainEntity.map((q) => q.name)).toEqual(["Bagaimana cara pesan?"]);
  });

  it("memeriksa ulang data tersimpan: klaim jaminan/ranking tidak diekspor", () => {
    const s = stored();
    s.customer_questions[1].short_answer = "Kopi terbaik dan dijamin nomor 1.";
    const faq = buildCustomerFaqJsonLd(s);
    expect(JSON.stringify(faq)).not.toMatch(/terbaik|dijamin|nomor 1/i);
  });

  it("tanpa fakta terverifikasi tidak mengekspor apa pun", () => {
    const s = stored({}, []);
    s.customer_questions = [{ question: "Q?", short_answer: "Jawaban apa saja.", owner_input_needed: null }];
    expect(buildCustomerFaqJsonLd(s)).toBeNull();
  });

  it("membatasi jumlah butir dan merapikan spasi", () => {
    const s = stored();
    s.customer_questions = Array.from({ length: 25 }, (_, i) => ({
      question: `  Pertanyaan\n ${i}?  `,
      short_answer: "Harganya IDR 55000.",
      owner_input_needed: null,
    }));
    const faq = buildCustomerFaqJsonLd(s)!;
    expect(faq.mainEntity).toHaveLength(MAX_EXPORT_FAQ_ITEMS);
    expect(faq.mainEntity[0].name).toBe("Pertanyaan 0?");
  });

  it("tidak mengekspor baris dengan fakta publik LINOE (status SEGERA/TARGET)", () => {
    const linoeFacts = buildVerifiedFacts({
      brand: { brand_name: "LINOE", website_url: "https://tanyopo-ai-prompter.netlify.app" },
    });
    const s = stored(
      {
        customer_questions: [
          { question: "Siapa target?", short_answer: "UMKM.", owner_input_needed: null },
          { question: "A?", short_answer: null, owner_input_needed: "x" },
          { question: "B?", short_answer: null, owner_input_needed: "x" },
        ],
      },
      linoeFacts,
    );
    expect(buildCustomerFaqJsonLd(s)).toBeNull();
    expect(buildCustomerProductJsonLd(s)).toBeNull();
  });
});

describe("buildCustomerProductJsonLd", () => {
  it("memetakan nama, deskripsi, kategori, dan harga milik tenant tanpa klaim tambahan", () => {
    const p = buildCustomerProductJsonLd(stored());
    expect(p).toEqual({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Kopi Robusta 200gr",
      description: "Biji kopi robusta sangrai medium",
      category: "Makanan & Minuman",
      offers: { "@type": "Offer", price: "55000", priceCurrency: "IDR" },
    });
    for (const k of ["aggregateRating", "review", "brand", "sku", "gtin", "image"]) expect(p).not.toHaveProperty(k);
    expect(p?.offers).not.toHaveProperty("availability");
  });

  it("tanpa nama produk -> null (tidak mengarang)", () => {
    const f = buildVerifiedFacts({ brand: { brand_name: "Kopi Nusa" } });
    expect(buildCustomerProductJsonLd(stored({}, f))).toBeNull();
  });

  it("tanpa harga -> tidak ada offers", () => {
    const f = buildVerifiedFacts({ product: { name: "Kopi", price: null } });
    const p = buildCustomerProductJsonLd(stored({}, f));
    expect(p?.name).toBe("Kopi");
    expect(p).not.toHaveProperty("offers");
  });

  it("harga tidak valid (nol / format aneh) -> tidak ada offers", () => {
    const s = stored();
    s.verified_facts = s.verified_facts.map((f) => (f.key === "product_price" ? { ...f, value: "gratis" } : f));
    expect(buildCustomerProductJsonLd(s)).not.toHaveProperty("offers");
    s.verified_facts = s.verified_facts.map((f) => (f.key === "product_price" ? { ...f, value: "IDR 0" } : f));
    expect(buildCustomerProductJsonLd(s)).not.toHaveProperty("offers");
  });
});

describe("buildCustomerJsonLdExport", () => {
  it("menghasilkan JSON valid dalam tag script dan meng-escape karakter HTML", () => {
    const f = buildVerifiedFacts({
      product: { name: "Kopi </script><b>&", description: "Enak", price: 1000, currency: "IDR" },
    });
    const out = buildCustomerJsonLdExport(stored({}, f));
    expect(out.product).not.toBeNull();
    const snippet = out.product!.snippet;
    expect(snippet.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(snippet.endsWith("</script>")).toBe(true);
    // hanya satu tag penutup: yang kita tulis sendiri
    expect(snippet.match(/<\/script>/g)).toHaveLength(1);
    expect(JSON.parse(out.product!.json).name).toBe("Kopi </script><b>&");
  });

  it("faq: count sesuai jumlah butir dan JSON dapat di-parse", () => {
    const out = buildCustomerJsonLdExport(stored());
    expect(out.faq?.count).toBe(2);
    expect(JSON.parse(out.faq!.json)["@type"]).toBe("FAQPage");
  });

  it("kosong bila tidak ada yang bisa diekspor", () => {
    const f = buildVerifiedFacts({});
    const s = stored({}, f);
    s.customer_questions = [];
    expect(buildCustomerJsonLdExport(s)).toEqual({ faq: null, product: null });
  });
});

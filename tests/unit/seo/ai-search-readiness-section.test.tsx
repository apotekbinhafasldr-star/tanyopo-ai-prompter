import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AiSearchReadinessSection } from "@/features/seo/ai-search-readiness-section";
import { buildVerifiedFacts, sanitizeAiSearchReadiness } from "@/lib/seo/ai-search-readiness";

afterEach(cleanup);

describe("AiSearchReadinessSection", () => {
  it("data lama tanpa bagian ini: tampil ajakan buat ulang, tidak error", () => {
    render(<AiSearchReadinessSection stored={{ primary_keywords: ["a"] }} />);
    expect(screen.getByText(/belum dibuat/i)).toBeInTheDocument();
    render(<AiSearchReadinessSection stored={null} />);
  });
  it("selalu menampilkan penafian: tidak menjamin muncul di jawaban AI", () => {
    render(<AiSearchReadinessSection stored={null} />);
    expect(screen.getByText(/tidak menjamin/i)).toBeInTheDocument();
  });
  it("menampilkan jawaban berdasar fakta dan penanda 'perlu dilengkapi' bila null", () => {
    const facts = buildVerifiedFacts({ product: { name: "Kopi", price: 1000, currency: "IDR" } });
    const stored = sanitizeAiSearchReadiness(
      {
        customer_questions: [
          { question: "Harga?", short_answer: "IDR 1000.", owner_input_needed: null },
          { question: "Asal?", short_answer: null, owner_input_needed: "Isi asal." },
          { question: "Cara pesan?", short_answer: null, owner_input_needed: null },
        ],
        entity_context: "Kopi adalah produk.",
        content_recommendations: [{ title: "FAQ", format: "FAQ", reason: "r" }],
        missing_facts: [],
      },
      facts,
    );
    render(<AiSearchReadinessSection stored={{ ai_search_readiness: stored }} />);
    expect(screen.getByText("IDR 1000.")).toBeInTheDocument();
    expect(screen.getAllByText(/Belum bisa dijawab dari data Anda/)).toHaveLength(2);
  });
});

describe("AiSearchReadinessSection — status produk LINOE", () => {
  it("menampilkan lencana status untuk fakta LINOE dan tidak memuat 'Pilih produk' bila tidak ada", () => {
    const facts = buildVerifiedFacts({ brand: { brand_name: "LINOE", website_url: "https://tanyopo-ai-prompter.netlify.app" } });
    const stored = sanitizeAiSearchReadiness(
      {
        customer_questions: [
          { question: "Siapa target?", short_answer: "UMKM.", owner_input_needed: null },
          { question: "A?", short_answer: null, owner_input_needed: "x" },
          { question: "B?", short_answer: null, owner_input_needed: "x" },
        ],
        entity_context: "LINOE membantu promosi.",
        content_recommendations: [{ title: "FAQ", format: "FAQ", reason: "r" }],
        missing_facts: [],
      },
      facts,
    );
    render(<AiSearchReadinessSection stored={{ ai_search_readiness: stored }} />);
    expect(screen.getAllByText("Tersedia").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Segera / rencana").length).toBeGreaterThan(0);
    expect(screen.getByText(/Produk Tanyopo lain:/)).toBeInTheDocument();
    expect(screen.queryByText(/Pilih produk/)).toBeNull();
    expect(screen.queryByText("Perlu dilengkapi:")).toBeNull();
  });
});

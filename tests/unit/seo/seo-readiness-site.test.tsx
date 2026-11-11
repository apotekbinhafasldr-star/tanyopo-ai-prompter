import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { googleSiteVerification } from "@/lib/seo/search-console";
import { buildLandingJsonLd } from "@/lib/seo/json-ld";
import { PRODUCTION_ORIGIN } from "@/lib/seo/site-url";
import { JsonLdSnippet } from "@/features/seo/structured-data-export";
import { AiSearchReadinessSection } from "@/features/seo/ai-search-readiness-section";
import { buildVerifiedFacts, sanitizeAiSearchReadiness } from "@/lib/seo/ai-search-readiness";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Google Search Console meta-tag verification", () => {
  it("tidak menghasilkan apa pun bila env kosong atau tidak valid", () => {
    expect(googleSiteVerification({})).toBeUndefined();
    expect(googleSiteVerification({ NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: "" })).toBeUndefined();
    expect(googleSiteVerification({ NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: "pendek" })).toBeUndefined();
    expect(googleSiteVerification({ NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: 'abc"><script>alert(1)</script>xxxxxxxx' })).toBeUndefined();
  });
  it("menerima token berbentuk benar dan memangkas spasi", () => {
    const token = "AbC123_-AbC123_-AbC123_-AbC123_-";
    expect(googleSiteVerification({ NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: ` ${token} ` })).toBe(token);
  });
  it("root layout memakainya hanya secara kondisional dan tanpa token tertanam", () => {
    const src = readFileSync("app/layout.tsx", "utf8");
    expect(src).toContain("googleSiteVerification()");
    expect(src).not.toMatch(/verification:\s*\{\s*google:\s*["'`]/);
  });
});

describe("area aplikasi tidak diindeks", () => {
  it("layout (app) mengekspor robots noindex (source check)", () => {
    const src = readFileSync("app/(app)/layout.tsx", "utf8");
    expect(src).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  });
});

describe("JSON-LD landing: WebSite", () => {
  it("memuat satu WebSite jujur (tanpa SearchAction/rating) yang terhubung ke Organization", () => {
    const nodes = buildLandingJsonLd(PRODUCTION_ORIGIN)["@graph"] as unknown as Record<string, unknown>[];
    const sites = nodes.filter((n) => n["@type"] === "WebSite");
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBe("LINOE");
    expect(sites[0].url).toBe(PRODUCTION_ORIGIN);
    expect(sites[0].publisher).toEqual({ "@id": `${PRODUCTION_ORIGIN}/#organization` });
    for (const k of ["potentialAction", "aggregateRating", "review"]) expect(sites[0]).not.toHaveProperty(k);
  });
});

describe("JsonLdSnippet", () => {
  it("menyalin ke clipboard dan menampilkan 'Tersalin'", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<JsonLdSnippet label="Product" snippet="<script>x</script>" />);
    fireEvent.click(screen.getByRole("button", { name: /salin/i }));
    await waitFor(() => expect(screen.getByText("Tersalin")).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith("<script>x</script>");
  });
  it("bila clipboard gagal, beri petunjuk salin manual (tidak crash)", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<JsonLdSnippet label="Product" snippet="abc" />);
    fireEvent.click(screen.getByRole("button", { name: /salin/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/salin manual/i));
  });
});

describe("AiSearchReadinessSection: kartu ekspor JSON-LD", () => {
  const facts = buildVerifiedFacts({
    brand: { brand_name: "Kopi Nusa" },
    product: { name: "Kopi Robusta", price: 55000, currency: "IDR" },
  });
  const stored = sanitizeAiSearchReadiness(
    {
      customer_questions: [
        { question: "Berapa harganya?", short_answer: "Harganya IDR 55000.", owner_input_needed: null },
        { question: "Asal?", short_answer: null, owner_input_needed: "Isi asal." },
        { question: "Pesan?", short_answer: null, owner_input_needed: "Isi cara pesan." },
      ],
      entity_context: "Kopi Nusa menjual kopi.",
      content_recommendations: [{ title: "FAQ", format: "FAQ", reason: "r" }],
      missing_facts: [],
    },
    facts,
  );

  it("tampil dengan FAQPage dan Product, plus penafian jujur", () => {
    render(<AiSearchReadinessSection stored={{ ai_search_readiness: stored }} />);
    expect(screen.getByTestId("structured-data-export")).toBeInTheDocument();
    expect(screen.getByText(/FAQPage \(1 pertanyaan\)/)).toBeInTheDocument();
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByText(/tidak menampilkan hasil kaya/i)).toBeInTheDocument();
    expect(screen.getByText(/tidak menjamin ranking/i)).toBeInTheDocument();
  });

  it("tidak tampil bila belum ada yang bisa diekspor", () => {
    const empty = sanitizeAiSearchReadiness(
      {
        customer_questions: [
          { question: "A?", short_answer: null, owner_input_needed: "x" },
          { question: "B?", short_answer: null, owner_input_needed: "x" },
          { question: "C?", short_answer: null, owner_input_needed: "x" },
        ],
        entity_context: "",
        content_recommendations: [{ title: "FAQ", format: "FAQ", reason: "r" }],
        missing_facts: [],
      },
      [],
    );
    render(<AiSearchReadinessSection stored={{ ai_search_readiness: empty }} />);
    expect(screen.queryByTestId("structured-data-export")).toBeNull();
  });
});

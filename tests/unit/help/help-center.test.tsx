import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/marketing/marketing-header", () => ({ MarketingHeader: () => null }));

import HelpPage, { metadata } from "@/app/(help)/help/page";
import { HelpCenter } from "@/features/help/help-center";
import { HELP_ARTICLES, HELP_CATEGORIES, HELP_STATUS_LABEL, SUPPORT_MAILTO } from "@/features/help/help-content";
import { filterHelpArticles } from "@/features/help/help-search";
import { FAQS } from "@/features/marketing/faq-data";
import { LEGAL } from "@/features/legal/legal-meta";
import { PLAN_TIERS } from "@/lib/billing/plans";
import sitemap from "@/app/sitemap";

afterEach(() => cleanup());

const allText = () => HELP_ARTICLES.map((a) => `${a.question} ${a.answer}`).join("\n");

describe("Help Center content — reuses the existing sources of truth", () => {
  it("includes every landing FAQ question and answer verbatim (faq-data.ts)", () => {
    for (const f of FAQS) {
      const hit = HELP_ARTICLES.find((a) => a.question === f.q);
      expect(hit, f.q).toBeDefined();
      expect(hit?.answer).toBe(f.a);
    }
  });

  it("states each paid plan's official price and limits from plans.ts", () => {
    for (const p of PLAN_TIERS.filter((x) => x.id !== "FREE")) {
      const a = HELP_ARTICLES.find((x) => x.id === `paket-${p.id.toLowerCase()}`);
      expect(a, p.id).toBeDefined();
      expect(a!.answer).toContain(new Intl.NumberFormat("id-ID").format(p.priceIDR));
      if (p.limits.maxActiveProducts !== null) {
        expect(a!.answer).toContain(`Produk aktif: ${new Intl.NumberFormat("id-ID").format(p.limits.maxActiveProducts)}`);
      }
    }
    const trial = HELP_ARTICLES.find((a) => a.id === "trial-isi")!;
    expect(trial.answer).toContain("14 hari");
    expect(trial.answer).toContain(String(PLAN_TIERS.find((p) => p.id === "FREE")!.limits.aiUsageAllowance));
  });

  it("marks the unopened Agency plan as in development and its price as a target", () => {
    const a = HELP_ARTICLES.find((x) => x.id === "paket-agency")!;
    expect(a.status).toBe("IN_DEVELOPMENT");
    expect(a.answer).toContain("harga target");
    expect(a.answer).toContain("belum dibuka");
  });

  it("covers all ten required topics, each with at least one article", () => {
    expect(HELP_CATEGORIES.map((c) => c.id)).toEqual([
      "mulai", "trial", "paket", "akun", "koneksi", "iklan", "pembayaran", "refund", "privasi", "kontak",
    ]);
    for (const c of HELP_CATEGORIES) expect(HELP_ARTICLES.some((a) => a.category === c.id), c.id).toBe(true);
  });

  it("has unique article ids", () => {
    const ids = HELP_ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never claims live payment or live paid advertising", () => {
    const pay = HELP_ARTICLES.find((a) => a.id === "bayar-status")!;
    expect(pay.answer).toMatch(/Belum\./);
    expect(pay.answer).toContain("sandbox");
    expect(pay.status).toBe("IN_DEVELOPMENT");
    const ads = HELP_ARTICLES.find((a) => a.id === "iklan-publikasi")!;
    expect(ads.status).toBe("AWAITING_PLATFORM");
    expect(ads.answer).toMatch(/Belum\./);
    // No "live" claims anywhere.
    expect(allText()).not.toMatch(/pembayaran (online )?(sudah|telah) (aktif|tersedia)|iklan (sudah|telah) (tayang|berjalan)|otomatis menayangkan/i);
  });

  it("makes no SLA, retention, certification or server-location promise", () => {
    expect(allText()).not.toMatch(/24\s*jam|24\/7|1x24|dalam \d+\s*(hari|jam)|SLA|ISO\s?\d|SOC\s?2|retensi|server (di|berlokasi)|dijamin/i);
  });

  it("uses the statuses available, in development and awaiting platform approval", () => {
    expect(Object.values(HELP_STATUS_LABEL)).toEqual(["Sudah tersedia", "Dalam pengembangan", "Menunggu persetujuan platform"]);
    const used = new Set(HELP_ARTICLES.map((a) => a.status).filter(Boolean));
    expect(used).toEqual(new Set(["AVAILABLE", "IN_DEVELOPMENT", "AWAITING_PLATFORM"]));
  });

  it("contains no secret-looking values", () => {
    expect(allText()).not.toMatch(/sk-[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}|service_role|SUPABASE_|API_KEY|SECRET/);
  });
});

describe("Help Center search", () => {
  it("returns everything with an empty query and the 'semua' category", () => {
    expect(filterHelpArticles(HELP_ARTICLES, "", "semua")).toHaveLength(HELP_ARTICLES.length);
    expect(filterHelpArticles(HELP_ARTICLES, "   ", "semua")).toHaveLength(HELP_ARTICLES.length);
  });

  it("is case- and accent-insensitive and requires every word", () => {
    const refund = filterHelpArticles(HELP_ARTICLES, "REFUND", "semua");
    expect(refund.length).toBeGreaterThan(0);
    const narrowed = filterHelpArticles(HELP_ARTICLES, "refund trial", "semua");
    expect(narrowed.length).toBeLessThanOrEqual(refund.length);
    expect(filterHelpArticles(HELP_ARTICLES, "zzzxqj", "semua")).toEqual([]);
  });

  it("filters by category and combines it with the query", () => {
    const only = filterHelpArticles(HELP_ARTICLES, "", "refund");
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((a) => a.category === "refund")).toBe(true);
    expect(filterHelpArticles(HELP_ARTICLES, "tiktok", "refund")).toEqual([]);
  });

  it("finds plan prices by plan name", () => {
    expect(filterHelpArticles(HELP_ARTICLES, "growth", "semua").some((a) => a.id === "paket-growth")).toBe(true);
  });
});

describe("<HelpCenter />", () => {
  it("renders every article on first render (indexable, works before hydration)", () => {
    const { container } = render(<HelpCenter />);
    expect(container.querySelectorAll("details")).toHaveLength(HELP_ARTICLES.length);
  });

  it("has a labelled search box, category buttons with aria-pressed, and a polite result count", () => {
    render(<HelpCenter />);
    const input = screen.getByLabelText("Cari bantuan") as HTMLInputElement;
    expect(input.type).toBe("search");
    expect(input.maxLength).toBe(100);
    const nav = screen.getByRole("navigation", { name: "Kategori bantuan" });
    expect(within(nav).getAllByRole("button")).toHaveLength(HELP_CATEGORIES.length + 1);
    expect(within(nav).getByRole("button", { name: "Semua" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("narrows the list when typing and shows an empty state with a support button", () => {
    const { container } = render(<HelpCenter />);
    const input = screen.getByLabelText("Cari bantuan");
    fireEvent.change(input, { target: { value: "refund" } });
    const n = container.querySelectorAll("details").length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(HELP_ARTICLES.length);

    fireEvent.change(input, { target: { value: "zzzxqj" } });
    expect(container.querySelectorAll("details")).toHaveLength(0);
    expect(screen.getByText("Tidak menemukan jawabannya?")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Hubungi dukungan" }).length).toBeGreaterThan(0);
  });

  it("filters by category when a chip is pressed", () => {
    const { container } = render(<HelpCenter />);
    const nav = screen.getByRole("navigation", { name: "Kategori bantuan" });
    const chip = within(nav).getByRole("button", { name: "Refund & pembatalan" });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    const expected = HELP_ARTICLES.filter((a) => a.category === "refund").length;
    expect(container.querySelectorAll("details")).toHaveLength(expected);
  });

  it("shows status badges using the three honest labels", () => {
    render(<HelpCenter />);
    for (const label of Object.values(HELP_STATUS_LABEL)) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("support button is a mailto link to the official support email only", () => {
    render(<HelpCenter />);
    for (const a of screen.getAllByRole("link", { name: "Hubungi dukungan" })) {
      expect(a.getAttribute("href")).toBe(SUPPORT_MAILTO);
    }
    expect(SUPPORT_MAILTO.startsWith(`mailto:${LEGAL.contactEmail}`)).toBe(true);
    expect(LEGAL.contactEmail).toBe("tanyopofuturetechnology@gmail.com");
  });
});

describe("/help page", () => {
  it("has SEO metadata: title, description, canonical, OG/Twitter, indexable", () => {
    expect(String(metadata.title)).toContain("Pusat Bantuan");
    expect(String(metadata.description).length).toBeGreaterThan(50);
    expect(metadata.alternates?.canonical).toBe("/help");
    expect(metadata.openGraph?.url).toBe("/help");
    expect(metadata.twitter).toBeDefined();
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("has one h1 and FAQPage JSON-LD built from the same articles (no offers/ratings)", () => {
    const { container } = render(<HelpPage />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    const ld = container.querySelector('script[type="application/ld+json"]');
    expect(ld).not.toBeNull();
    const data = JSON.parse(ld!.textContent ?? "{}");
    expect(data["@type"]).toBe("FAQPage");
    expect(data.mainEntity).toHaveLength(HELP_ARTICLES.length);
    expect(JSON.stringify(data)).not.toMatch(/"offers"|aggregateRating|"review"/);
    expect(ld!.textContent).not.toContain("<");
  });

  it("is in the sitemap and public in proxy.ts, with no other protected path opened", () => {
    expect(sitemap().map((e) => e.url).some((u) => u.endsWith("/help"))).toBe(true);
    const proxySrc = readFileSync("proxy.ts", "utf8");
    const m = proxySrc.match(/const PUBLIC_PATHS = \[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const paths = m![1].split(",").map((s) => s.trim().replace(/"/g, ""));
    expect(paths).toContain("/help");
    expect(paths).toEqual(["/", "/login", "/register", "/forgot-password", "/privacy", "/terms", "/refund", "/data-deletion", "/help"]);
  });
});

describe("scope guard — the Help Center is static and AI-free", () => {
  const files = [
    "features/help/help-content.ts",
    "features/help/help-search.ts",
    "features/help/help-center.tsx",
    "app/(help)/help/page.tsx",
    "app/(help)/layout.tsx",
  ];
  it("imports no AI, database, server action, auth, billing-logic or connector code and makes no network call", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/@\/lib\/ai|@\/services|@\/lib\/supabase|@\/lib\/connectors|@\/features\/(billing|connections|auth)|"use server"|\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|process\.env/);
    }
  });
});

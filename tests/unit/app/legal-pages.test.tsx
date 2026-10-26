import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/actions", () => ({ registerAction: vi.fn() }));
vi.mock("@/features/marketing/marketing-header", () => ({ MarketingHeader: () => null }));

import PrivacyPage, { metadata as privacyMeta } from "@/app/(legal)/privacy/page";
import TermsPage, { metadata as termsMeta } from "@/app/(legal)/terms/page";
import DataDeletionPage, { metadata as deletionMeta } from "@/app/(legal)/data-deletion/page";
import RefundPage, { metadata as refundMeta } from "@/app/(legal)/refund/page";
import MarketingLayout from "@/app/(marketing)/layout";
import { RegisterForm } from "@/features/auth/register-form";
import { LegalLinks } from "@/features/legal/legal-links";
import { LegalHeader } from "@/features/legal/legal-header";
import LegalLayout from "@/app/(legal)/layout";
import DemoLayout from "@/app/demo/layout";
import { LEGAL } from "@/features/legal/legal-meta";
import { PLAN_TIERS } from "@/lib/billing/plans";

afterEach(() => cleanup());

const PAGES = [
  { name: "privacy", Page: PrivacyPage, meta: privacyMeta, path: "/privacy", h1: "Kebijakan Privasi" },
  { name: "terms", Page: TermsPage, meta: termsMeta, path: "/terms", h1: "Syarat & Ketentuan" },
  { name: "refund", Page: RefundPage, meta: refundMeta, path: "/refund", h1: "Kebijakan Refund" },
  { name: "data-deletion", Page: DataDeletionPage, meta: deletionMeta, path: "/data-deletion", h1: "Penghapusan Data Pengguna" },
];

function pageText(Page: () => React.ReactElement): string {
  const { container } = render(<Page />);
  return container.textContent ?? "";
}

describe.each(PAGES)("/$name legal page", ({ Page, meta, path, h1 }) => {
  it("renders a single H1 and the operator identity", () => {
    render(<Page />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(h1);
    expect(screen.getAllByText(/PT Tanyopo Future Technology/).length).toBeGreaterThan(0);
  });

  it("has SEO metadata with a canonical path and is indexable (not a draft)", () => {
    expect(meta.title).toMatch(/LINOE/);
    expect(meta.description).toBeTruthy();
    expect(meta.alternates?.canonical).toBe(path);
    expect(meta.robots).toMatchObject({ index: true, follow: true });
  });

  it("has no draft banner, placeholder or pending-decision marker", () => {
    const text = pageText(Page);
    expect(text).not.toMatch(/Draf\b/i);
    expect(text).not.toMatch(/Menunggu keputusan/i);
    expect(text).not.toMatch(/belum final/i);
    expect(text).not.toMatch(/\bTODO\b|\bTBD\b|\[.*?(isi|diisi).*?\]/i);
  });

  it("shows exactly the approved contact email and no other address", () => {
    const { container } = render(<Page />);
    const text = container.textContent ?? "";
    expect(text).toContain(LEGAL.contactEmail);
    // Once the approved address is removed, no other "@" address may remain.
    expect(text.split(LEGAL.contactEmail).join("")).not.toContain("@");
    const mailtos = Array.from(container.querySelectorAll('a[href^="mailto:"]')).map((a) => a.getAttribute("href"));
    expect(mailtos.length).toBeGreaterThan(0);
    for (const href of mailtos) expect(href).toBe(`mailto:${LEGAL.contactEmail}`);
  });

  it("promises no response time, 30-day completion, certification or guarantee", () => {
    const text = pageText(Page);
    expect(text).not.toMatch(/\b\d+\s*(x\s*24\s*jam|hari kerja)/i);
    expect(text).not.toMatch(/\b30\s*hari/i);
    expect(text).not.toMatch(/ISO\s*27001|SOC\s*2|end-to-end/i);
    expect(text).not.toMatch(/dijual/i);
    expect(text).not.toMatch(/(?<!tidak dapat )menjamin keamanan|keamanan (sempurna|mutlak) (terjamin|dijamin)/i);
  });

  it("links to the other three legal pages", () => {
    render(<Page />);
    for (const href of ["/privacy", "/terms", "/refund", "/data-deletion"].filter((p) => p !== path)) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });
});

describe("legal content accuracy", () => {
  it("terms state the real trial limits from the plan source of truth", () => {
    const free = PLAN_TIERS.find((t) => t.id === "FREE")!;
    const text = pageText(TermsPage);
    expect(text).toContain("masa uji coba 14 hari");
    expect(text).toContain(`${free.limits.aiUsageAllowance} penggunaan AI`);
    expect(text).toContain(`${free.limits.maxActiveProducts} produk aktif`);
    expect(text).toContain(`${free.limits.maxActiveCampaigns} kampanye aktif`);
    expect(text).toContain(`${free.limits.maxUsers} pengguna`);
  });

  it("terms do not promise ad results, refunds, or state production payment as on/off", () => {
    const text = pageText(TermsPage);
    expect(text).toMatch(/tidak\s+menjamin hasil iklan/);
    // Refunds are governed by the dedicated policy, linked from the terms; the terms alone promise none.
    expect(text).toContain("Kebijakan Refund");
    expect(text).not.toMatch(/tidak menjanjikan pengembalian dana/);
    expect(text).not.toMatch(/belum diaktifkan|sudah aktif|telah diaktifkan/i);
    expect(text).not.toMatch(/Rp\s?\d/);
  });

  it("terms state that online payment is sandbox-only, with the exact approved wording", () => {
    const text = pageText(TermsPage);
    expect(text).toContain(
      "Saat ini pembayaran daring di LINOE masih dalam tahap uji coba (sandbox). Belum ada penagihan atau pembayaran riil melalui LINOE. Ketentuan pembayaran akan diperbarui sebelum pembayaran riil diaktifkan.",
    );
    // Consistent with the rest of section 4: no live-payment implication.
    expect(text).not.toMatch(/ditampilkan sebelum Anda mengonfirmasi/);
    expect(text).not.toMatch(/Rp\s?\d/);
    // Privacy stays conditional on payments being available.
    expect(pageText(PrivacyPage)).toMatch(/Bila pembayaran daring tersedia/);
  });

  it("terms do not cap liability or exclude indirect damages", () => {
    const text = pageText(TermsPage);
    expect(text).not.toMatch(/kerugian tidak langsung|hilangnya keuntungan|terbatas pada kerugian/i);
    expect(text).toMatch(/tidak dapat dikecualikan/);
  });

  it("privacy discloses IP on auth sessions and does not claim IP is not stored", () => {
    const text = pageText(PrivacyPage);
    expect(text).toMatch(/alamat IP/);
    expect(text).not.toMatch(/tidak (menyimpan|mencatat) (alamat )?IP/i);
  });

  it("privacy sets no fixed retention period and does not claim tenant isolation", () => {
    const text = pageText(PrivacyPage);
    expect(text).toMatch(/belum menetapkan jangka retensi tetap/);
    expect(text).not.toMatch(/\b\d+\s*(hari|bulan|tahun)\b[^.]*(disimpan|retensi)/i);
    expect(text).not.toMatch(/pemisahan data|terisolasi/i);
  });

  it("privacy and deletion both say the shared login account is not automatically deleted", () => {
    expect(pageText(PrivacyPage)).toMatch(/tidak otomatis terhapus/);
    expect(pageText(DataDeletionPage)).toMatch(/tidak otomatis menghapusnya/);
  });

  it("privacy and deletion do not guarantee deletion at third parties", () => {
    expect(pageText(PrivacyPage)).toMatch(/tidak dapat menjamin/);
    expect(pageText(DataDeletionPage)).toMatch(/tidak dapat menjamin penghapusan/);
  });

  it("deletion page does not claim an automatic deletion feature exists", () => {
    const text = pageText(DataDeletionPage);
    expect(text).toMatch(/belum menyediakan tombol hapus akun otomatis/);
    expect(text).toMatch(/manual/);
  });

  it("deletion page separates the five handling stages in order", () => {
    const text = pageText(DataDeletionPage);
    const stages = [
      "Tahap 1: Penerimaan permintaan",
      "Tahap 2: Verifikasi identitas",
      "Tahap 3: Penilaian lingkup dan kewajiban hukum",
      "Tahap 4: Pelaksanaan",
      "Tahap 5: Pemberitahuan hasil",
    ];
    const positions = stages.map((s) => text.lastIndexOf(s));
    for (const pos of positions) expect(pos).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toMatch(/Setelah tindakan benar-benar dilakukan/);
  });

  it("deletion page distinguishes Owner and non-Owner requests", () => {
    const text = pageText(DataDeletionPage);
    expect(text).toMatch(/non-Owner/);
    expect(text).toMatch(/hanya\s+dihapus atas permintaan Owner/);
  });
});

describe("legal links", () => {
  it("LegalLinks points to all four pages", () => {
    render(<LegalLinks />);
    for (const href of ["/privacy", "/terms", "/refund", "/data-deletion"]) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });

  it("the registration form has an unchecked, required consent checkbox with Terms/Privacy links", () => {
    render(<RegisterForm />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(1);
    const box = boxes[0] as HTMLInputElement;
    expect(box.name).toBe("acceptLegal");
    expect(box.checked).toBe(false);
    expect(box.required).toBe(true);
    // Label is associated with the checkbox and carries the legal links.
    const label = document.querySelector('label[for="acceptLegal"]')!;
    expect(label).not.toBeNull();
    expect(label.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(label.querySelector('a[href="/privacy"]')).not.toBeNull();
    for (const href of ["/privacy", "/terms", "/data-deletion"]) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: /Daftar Gratis/ })).toBeInTheDocument();
  });

  it("the demo banner layout links to all four legal pages", () => {
    const src = readFileSync("app/demo/layout.tsx", "utf8");
    expect(src).toContain("LegalLinks");
    const { container } = render(<DemoLayout>{null}</DemoLayout>);
    for (const href of ["/privacy", "/terms", "/refund", "/data-deletion"]) {
      expect(container.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });

  it("the landing footer links to all four legal pages and names the same operator, location and email as the legal pages", () => {
    const src = readFileSync("app/(marketing)/layout.tsx", "utf8");
    expect(src).toContain("<LegalLinks");
    const { container } = render(<MarketingLayout>{null}</MarketingLayout>);
    const footer = container.querySelector("footer")!;
    for (const href of ["/privacy", "/terms", "/refund", "/data-deletion"]) {
      expect(footer.querySelector(`a[href="${href}"]`), href).not.toBeNull();
    }
    expect(footer.textContent).toContain(LEGAL.operator);
    expect(footer.textContent).toContain(LEGAL.location);
    expect(footer.textContent).toContain(LEGAL.contactEmail);
    expect(footer.textContent).not.toMatch(/Tanyopo Labs/);
    // Nothing invented: the only address is the approved email, no phone number.
    expect((footer.textContent ?? "").split(LEGAL.contactEmail).join("")).not.toContain("@");
    expect(footer.textContent).not.toMatch(/\+?62\d{8,}|\b08\d{8,}/);
  });

  it("proxy.ts lists the legal paths as public (readable without login)", () => {
    const src = readFileSync("proxy.ts", "utf8");
    const line = src.split("\n").find((l) => l.startsWith("const PUBLIC_PATHS"))!;
    for (const p of ["/privacy", "/terms", "/refund", "/data-deletion"]) expect(line).toContain(`"${p}"`);
    // Legal paths are not auth-only: a signed-in user may still read them.
    const authOnly = src.split("\n").find((l) => l.startsWith("const AUTH_ONLY_PATHS"))!;
    for (const p of ["/privacy", "/terms", "/refund", "/data-deletion"]) expect(authOnly).not.toContain(p);
  });
});

describe("legal layout (scoped header, landing untouched)", () => {
  it("LegalHeader is in normal flow (not fixed/sticky/transparent) with readable nav", () => {
    render(<LegalHeader />);
    const header = screen.getByRole("banner");
    expect(header.className).not.toMatch(/\b(fixed|sticky|absolute)\b/);
    expect(header.className).not.toMatch(/transparent/);
    // Secondary links use normal foreground colours (not white-on-transparent).
    for (const href of ["/", "/login"]) {
      expect(header.querySelector(`a[href="${href}"]`)?.className ?? "").not.toMatch(/text-white/);
    }
    for (const href of ["/", "/login", "/register"]) {
      expect(header.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });

  it("LegalLayout renders the header, the page content and a footer naming the legal operator", () => {
    render(
      <LegalLayout>
        <p>konten halaman</p>
      </LegalLayout>,
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByText("konten halaman")).toBeInTheDocument();
    const footer = screen.getByRole("contentinfo");
    expect(footer.textContent).toContain(LEGAL.operator);
    expect(footer.textContent).not.toMatch(/Tanyopo Labs/);
    for (const href of ["/privacy", "/terms", "/data-deletion"]) {
      expect(footer.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });

  it("the legal route group does not use the landing MarketingHeader, and landing layout is not in the legal group", () => {
    const legalLayout = readFileSync("app/(legal)/layout.tsx", "utf8");
    const legalHeader = readFileSync("features/legal/legal-header.tsx", "utf8");
    expect(legalLayout).not.toMatch(/import[^;]*MarketingHeader/);
    expect(legalHeader).not.toMatch(/import[^;]*MarketingHeader/);
    for (const name of ["privacy", "terms", "data-deletion"]) {
      expect(() => readFileSync(`app/(legal)/${name}/page.tsx`, "utf8")).not.toThrow();
      expect(() => readFileSync(`app/(marketing)/${name}/page.tsx`, "utf8")).toThrow();
    }
  });
});

describe("remediation guards", () => {
  const ALL = [PrivacyPage, TermsPage, DataDeletionPage];

  it("publishes no effective date until the Founder confirms one", () => {
    expect(LEGAL.effectiveDate).toBeUndefined();
    for (const Page of ALL) {
      const text = pageText(Page);
      expect(text).not.toMatch(/Berlaku sejak/);
      expect(text).not.toMatch(/(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}/i);
    }
  });

  it("shows the Founder-approved location", () => {
    expect(LEGAL.location).toBe("Ladang Rimba, Aceh Selatan, Indonesia");
  });

  it("no legal page promises a deletion SLA or an automatic deletion/anonymisation capability", () => {
    for (const Page of ALL) {
      const text = pageText(Page);
      expect(text).not.toMatch(/dalam\s+\d+\s*(hari|jam|minggu)/i);
      expect(text).not.toMatch(/otomatis\s+(dihapus|dianonimkan)/i);
    }
    expect(pageText(DataDeletionPage)).toMatch(/belum memiliki alat anonimisasi otomatis/);
  });

  it("states that automatic paid-ad publishing is not available and nothing is spent on the user's behalf", () => {
    for (const Page of [PrivacyPage, TermsPage]) {
      const text = pageText(Page);
      expect(text).toMatch(/Penayangan iklan\s+berbayar otomatis belum tersedia/);
      expect(text).toMatch(/tidak membelanjakan anggaran iklan atas nama\s+Anda/);
    }
  });

  it("privacy covers demo data, UMKMpro-synced data, invoices and the real IP / rate-limit handling", () => {
    const text = pageText(PrivacyPage);
    expect(text).toMatch(/Sesi demo/);
    expect(text).toMatch(/Data dari UMKMpro AI/);
    expect(text).toMatch(/invoice/);
    expect(text).toMatch(/membatasi jumlah\s+percobaan pendaftaran/);
    expect(text).toMatch(/tidak\s+kami simpan pada tabel data LINOE/);
  });

  it("deletion scope is LINOE-only and never claims shared accounts or other products are deleted", () => {
    const text = pageText(DataDeletionPage);
    expect(text).toMatch(/tidak menghapus workspace atau data produk Tanyopo lain/);
    expect(text).toMatch(/tidak otomatis menghapusnya/);
  });

  it("the paid-subscription cancellation line is conditional on paid plans existing", () => {
    expect(pageText(TermsPage)).toMatch(/Bila langganan berbayar tersedia, pembatalan/);
  });

  it("landing copy no longer claims automatic campaign execution or publication", () => {
    const files = [
      "features/marketing/sections/ide-ke-hasil.tsx",
      "features/marketing/sections/how-it-works.tsx",
      "features/marketing/sections/ai-team.tsx",
      "features/marketing/sections/trust.tsx",
      "features/marketing/sections/device-showcase.tsx",
      "features/marketing/sections/faq.tsx",
      "features/marketing/faq-data.ts",
      "features/marketing/components/tanyopo-intelligence-diagram.tsx",
      "app/(marketing)/page.tsx",
      "app/layout.tsx",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/dieksekusi otomatis|Buat & Jalankan|"Luncurkan"|jalankan iklan di|menjalankan campaign|peluncuran campaign|Eksekusi campaign|sebelum tayang/);
    }
    const hero = readFileSync("features/marketing/sections/hero.tsx", "utf8");
    expect(hero).toContain("menyiapkan campaign");
    expect(hero).toContain("sebelum dijalankan");
    expect(hero).not.toContain("sebelum tayang");
    // The hero image alt text must not claim automatic campaign execution either.
    expect(hero).not.toContain("menjalankan campaign");
  });
});

describe("/refund policy content", () => {
  const text = () => pageText(RefundPage);

  it("keeps the 14-day free trial and does not treat it as a replacement for refund rights", () => {
    expect(text()).toMatch(/14 hari/);
    expect(text()).toMatch(/tidak menggantikan atau mengurangi hak refund/);
  });

  it("says active subscription payments are generally not refunded for a change of mind, within the law", () => {
    expect(text()).toMatch(/umumnya tidak dikembalikan hanya karena Anda berubah pikiran/);
    expect(text()).toMatch(/sepanjang hal itu diperbolehkan oleh hukum/);
  });

  it("allows refund review for duplicate payments, billing errors and undelivered service", () => {
    expect(text()).toMatch(/Pembayaran ganda/);
    expect(text()).toMatch(/Kesalahan penagihan/);
    expect(text()).toMatch(/tidak diberikan sesuai ketentuan/);
  });

  it("lets customers cancel renewal, without automatically refunding the current period", () => {
    expect(text()).toMatch(/membatalkan perpanjangan langganan/);
    expect(text()).toMatch(/tidak otomatis mengembalikan pembayaran untuk periode yang sedang berjalan/);
  });

  it("keeps Indonesian consumer rights and sets no payout time or SLA", () => {
    expect(text()).toMatch(/tidak menghapus atau mengurangi hak Anda sebagai konsumen/);
    expect(text()).toMatch(/tidak menetapkan jangka waktu pencairan/);
    expect(text()).not.toMatch(/\b\d+\s*(jam|hari kerja|x\s*24)/i);
  });

  it("does not claim an automatic refund feature and states payment is still sandbox", () => {
    expect(text()).toMatch(/belum menyediakan fitur refund otomatis/);
    expect(text()).toMatch(/sandbox/);
    expect(text()).toMatch(/Belum ada penagihan atau pembayaran\s+riil/);
  });

  it("is consistent with the terms: same sandbox sentence, terms link to /refund", () => {
    render(<TermsPage />);
    expect(document.querySelector('a[href="/refund"]')).not.toBeNull();
  });
});

describe("plan transparency (presentation only)", () => {
  it("no plan lists an unavailable feature as active: every 'segera' item lives in comingSoonFeatures", () => {
    for (const tier of PLAN_TIERS) {
      for (const f of tier.coreFeatures) expect(f, `${tier.id}: ${f}`).not.toMatch(/segera|coming/i);
      expect(Array.isArray(tier.comingSoonFeatures)).toBe(true);
    }
    const pro = PLAN_TIERS.find((t) => t.id === "PRO")!;
    expect(pro.comingSoonFeatures).toContain("A/B testing & retargeting");
    expect(PLAN_TIERS.find((t) => t.id === "AGENCY")!.availability).toBe("COMING_SOON");
  });

  it("prices and quotas are unchanged", () => {
    const snapshot = Object.fromEntries(PLAN_TIERS.map((t) => [t.id, [t.priceIDR, t.limits.aiUsageAllowance, t.limits.maxActiveProducts, t.limits.maxActiveCampaigns, t.limits.maxUsers]]));
    expect(snapshot).toEqual({
      FREE: [0, 30, 3, 2, 1],
      STARTER: [99000, 150, 10, 5, 1],
      GROWTH: [199000, 500, 50, 20, 3],
      PRO: [399000, 1500, 200, 75, 5],
      BUSINESS: [799000, 4000, 500, 200, 10],
      AGENCY: [1499000, 10000, null, null, 20],
    });
  });

  it("the landing pricing section shows coming-soon features separately and states payment is not yet live", () => {
    const src = readFileSync("features/marketing/sections/pricing.tsx", "utf8");
    expect(src).toContain("comingSoonFeatures");
    expect(src).toContain("Segera hadir (belum tersedia)");
    expect(src).toContain("Pembayaran online belum aktif");
    expect(src).toContain('href="/refund"');
  });
});

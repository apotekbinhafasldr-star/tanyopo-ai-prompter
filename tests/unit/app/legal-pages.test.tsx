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

import PrivacyPage, { metadata as privacyMeta } from "@/app/(marketing)/privacy/page";
import TermsPage, { metadata as termsMeta } from "@/app/(marketing)/terms/page";
import DataDeletionPage, { metadata as deletionMeta } from "@/app/(marketing)/data-deletion/page";
import { RegisterForm } from "@/features/auth/register-form";
import { LegalLinks } from "@/features/legal/legal-links";
import { LEGAL } from "@/features/legal/legal-meta";
import { PLAN_TIERS } from "@/lib/billing/plans";

afterEach(() => cleanup());

const PAGES = [
  { name: "privacy", Page: PrivacyPage, meta: privacyMeta, path: "/privacy", h1: "Kebijakan Privasi" },
  { name: "terms", Page: TermsPage, meta: termsMeta, path: "/terms", h1: "Syarat & Ketentuan" },
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

  it("links to the other two legal pages", () => {
    render(<Page />);
    for (const href of ["/privacy", "/terms", "/data-deletion"].filter((p) => p !== path)) {
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
    expect(text).toMatch(/tidak menjanjikan pengembalian dana/);
    expect(text).not.toMatch(/belum diaktifkan|sudah aktif|telah diaktifkan/i);
    expect(text).not.toMatch(/Rp\s?\d/);
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
  it("LegalLinks points to all three pages", () => {
    render(<LegalLinks />);
    for (const href of ["/privacy", "/terms", "/data-deletion"]) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });

  it("the registration form shows consent text and links, and adds NO consent checkbox", () => {
    render(<RegisterForm />);
    expect(screen.getByText(/Dengan mendaftar, Anda menyetujui/)).toBeInTheDocument();
    for (const href of ["/privacy", "/terms", "/data-deletion"]) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Daftar Gratis/ })).toBeInTheDocument();
  });

  it("proxy.ts lists the legal paths as public (readable without login)", () => {
    const src = readFileSync("proxy.ts", "utf8");
    const line = src.split("\n").find((l) => l.startsWith("const PUBLIC_PATHS"))!;
    for (const p of ["/privacy", "/terms", "/data-deletion"]) expect(line).toContain(`"${p}"`);
    // Legal paths are not auth-only: a signed-in user may still read them.
    const authOnly = src.split("\n").find((l) => l.startsWith("const AUTH_ONLY_PATHS"))!;
    for (const p of ["/privacy", "/terms", "/data-deletion"]) expect(authOnly).not.toContain(p);
  });
});

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

afterEach(() => cleanup());

const PAGES = [
  { name: "privacy", Page: PrivacyPage, meta: privacyMeta, path: "/privacy", h1: "Kebijakan Privasi" },
  { name: "terms", Page: TermsPage, meta: termsMeta, path: "/terms", h1: "Syarat & Ketentuan" },
  { name: "data-deletion", Page: DataDeletionPage, meta: deletionMeta, path: "/data-deletion", h1: "Penghapusan Data Pengguna" },
];

describe.each(PAGES)("/$name legal page", ({ Page, meta, path, h1 }) => {
  it("renders a single H1, the operator identity and the draft notice", () => {
    render(<Page />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(h1);
    expect(screen.getAllByText(/PT Tanyopo Future Technology/).length).toBeGreaterThan(0);
    expect(screen.getByText("Draf — belum final")).toBeInTheDocument();
  });

  it("has SEO metadata with a canonical path and, while a draft, noindex", () => {
    expect(meta.title).toMatch(/LINOE/);
    expect(meta.description).toBeTruthy();
    expect(meta.alternates?.canonical).toBe(path);
    expect(meta.robots).toMatchObject({ index: false });
  });

  it("marks undecided items as pending decisions instead of inventing them", () => {
    render(<Page />);
    expect(screen.queryAllByText(/Menunggu keputusan perusahaan/).length).toBeGreaterThan(0);
  });

  it("does not invent a contact email or a deletion SLA", () => {
    const { container } = render(<Page />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/\b\d+\s*(x\s*24\s*jam|hari kerja)/i);
    expect(text).not.toMatch(/ISO\s*27001|SOC\s*2/i);
  });
});

describe("legal content accuracy", () => {
  it("states the real trial limits (14 days, 30 AI uses, 3 products, 2 campaigns, 1 user)", () => {
    render(<TermsPage />);
    expect(screen.getByText(/masa uji coba 14 hari/)).toBeInTheDocument();
    expect(screen.getByText(/30 penggunaan AI/)).toBeInTheDocument();
    expect(screen.getByText(/3 produk aktif, 2 campaign aktif, dan 1 pengguna/)).toBeInTheDocument();
  });

  it("does not promise ad results", () => {
    render(<TermsPage />);
    expect(screen.getByText(/tidak menjamin hasil bisnis tertentu/)).toBeInTheDocument();
  });

  it("does not claim an automatic deletion feature exists", () => {
    render(<DataDeletionPage />);
    expect(screen.getByText(/belum menyediakan tombol hapus akun otomatis/)).toBeInTheDocument();
  });
});

describe("legal links", () => {
  it("LegalLinks points to all three pages", () => {
    render(<LegalLinks />);
    for (const href of ["/privacy", "/terms", "/data-deletion"]) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });

  it("the registration form links to them and adds NO consent checkbox", () => {
    render(<RegisterForm />);
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

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { findForbidden } from "./forbidden-ui";

const { sectionProps, refreshMock } = vi.hoisted(() => ({ sectionProps: vi.fn(), refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }), usePathname: () => "/settings/privasi" }));
vi.mock("@/features/consent/consent-section", () => ({
  ConsentSection: (props: { includeConnections?: boolean; title?: string; intro?: string }) => {
    sectionProps(props);
    return <div data-testid="consent-section">{props.title}</div>;
  },
}));

import { PrivacyPage, MARKETING_NOTE_BODY, MARKETING_NOTE_TITLE, PAGE_INTRO, SCOPE_NOTE } from "@/features/privacy/privacy-page";
import { LegalDocsCard } from "@/features/privacy/legal-docs-card";
import { RightsSection, buildMailto, COPY_FAIL, COPY_OK, RIGHTS_BODY } from "@/features/privacy/rights-section";
import { PrivacyEntryCard } from "@/features/privacy/privacy-entry-card";
import { buildLegalDocRows, NO_RECORD_TEXT } from "@/features/privacy/legal-docs";
import { LEGAL } from "@/features/legal/legal-meta";
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from "@/features/legal/legal-versions";

const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf-8");

afterEach(() => {
  cleanup();
  sectionProps.mockReset();
  refreshMock.mockReset();
});

const rows = (extra: unknown = []) => buildLegalDocRows(extra, "Asia/Jakarta");

function page(role: string, over: Partial<{ legalLoadError: boolean; legalRows: ReturnType<typeof rows> }> = {}) {
  return render(<PrivacyPage role={role} timeZone="Asia/Jakarta" legalRows={over.legalRows ?? rows()} legalLoadError={over.legalLoadError ?? false} contactEmail={LEGAL.contactEmail} />);
}

describe("PrivacyPage: struktur dan peran", () => {
  it("satu h1, h2 untuk bagian, nav 'Bagian halaman' dengan tiga tautan dalam halaman >= 44px", () => {
    page("owner");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Privasi & Data Saya");
    expect(screen.getByRole("heading", { level: 2, name: "Dokumen hukum" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Permintaan terkait data Anda" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Bagian halaman" });
    const links = nav.querySelectorAll("a");
    expect(Array.from(links).map((a) => a.getAttribute("href"))).toEqual(["#persetujuan", "#dokumen", "#permintaan"]);
    links.forEach((a) => expect(a).toHaveClass("min-h-11"));
    expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument();
  });

  it("Owner: kartu koneksi dimuat (includeConnections true), judul dan catatan cakupan diteruskan; tanpa kartu catatan", () => {
    page("owner");
    expect(sectionProps).toHaveBeenCalledWith(expect.objectContaining({ includeConnections: true, title: "Persetujuan opsional", intro: SCOPE_NOTE }));
    expect(screen.queryByText(MARKETING_NOTE_TITLE)).toBeNull();
  });

  it("marketing: kartu catatan tanpa lencana 'Aktif'; kartu koneksi tidak dimuat", () => {
    page("marketing");
    expect(screen.getByText(MARKETING_NOTE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(MARKETING_NOTE_BODY)).toBeInTheDocument();
    expect(sectionProps).toHaveBeenCalledWith(expect.objectContaining({ includeConnections: false }));
    expect(screen.queryByText("Aktif")).toBeNull();
  });

  it.each(["kasir", "apoteker", "admin_gudang", "hr"])("peran %s: tanpa kartu koneksi dan tanpa kartu catatan marketing", (role) => {
    page(role);
    expect(sectionProps).toHaveBeenCalledWith(expect.objectContaining({ includeConnections: false }));
    expect(screen.queryByText(MARKETING_NOTE_TITLE)).toBeNull();
  });

  it("bebas pola terlarang pada semua peran dan keadaan galat dokumen", () => {
    for (const role of ["owner", "marketing", "kasir"]) {
      for (const legalLoadError of [false, true]) {
        const { unmount } = page(role, { legalLoadError });
        expect(findForbidden(document.body.textContent ?? ""), `${role}/${legalLoadError}`).toEqual([]);
        unmount();
      }
    }
  });

  it("kata 'disampaikan' tidak dipakai untuk Privacy sebelum Jalur 2", () => {
    page("owner", { legalRows: rows([{ doc_code: "PRIVACY_NOTICE", event: "DELIVERED", version: 1, occurred_at: "2026-12-03T10:00:00Z" }]) });
    expect(document.body.textContent).not.toMatch(/disampaikan/i);
  });
});

describe("dokumen hukum", () => {
  it("tanpa catatan: 'Belum ada catatan versi', bukan 'belum menerima'", () => {
    render(<LegalDocsCard rows={rows()} />);
    expect(screen.getAllByText(NO_RECORD_TEXT)).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/belum (menerima|menyetujui)/i);
  });

  it("Terms versi tercatat dengan tanggal; Privacy = pemberitahuan, bukan persetujuan", () => {
    render(
      <LegalDocsCard
        rows={rows([
          { doc_code: "TERMS", event: "ACCEPTED", version: TERMS_VERSION, occurred_at: "2026-12-03T10:00:00Z" },
          { doc_code: "PRIVACY_NOTICE", event: "DELIVERED", version: PRIVACY_NOTICE_VERSION, occurred_at: "2026-12-03T10:00:00Z" },
        ])}
      />,
    );
    expect(screen.getByText(`Anda menyetujui versi ${TERMS_VERSION} pada 3 Desember 2026.`)).toBeInTheDocument();
    expect(screen.getByText(`Pemberitahuan versi ${PRIVACY_NOTICE_VERSION} untuk akun Anda. Ini pemberitahuan, bukan persetujuan.`)).toBeInTheDocument();
    expect(screen.queryByText(/Ada versi terbaru/)).toBeNull();
  });

  it("versi tercatat lebih rendah dari versi berlaku: 'Ada versi terbaru (m). Baca sekarang.' tanpa tombol terima", () => {
    render(<LegalDocsCard rows={rows([{ doc_code: "TERMS", event: "ACCEPTED", version: 1, occurred_at: "2026-12-03T10:00:00Z" }])} />);
    expect(screen.getByText(`Ada versi terbaru (${TERMS_VERSION}). Baca sekarang.`)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("versi tertinggi yang dipakai; baris tak dikenal atau tak valid diabaikan", () => {
    const r = rows([
      { doc_code: "TERMS", event: "ACCEPTED", version: 1, occurred_at: "2026-01-03T10:00:00Z" },
      { doc_code: "TERMS", event: "ACCEPTED", version: TERMS_VERSION, occurred_at: "2026-12-03T10:00:00Z" },
      { doc_code: "TERMS", event: "DELIVERED", version: 99 },
      { doc_code: "LAIN", event: "ACCEPTED", version: 5 },
      { doc_code: "TERMS", event: "ACCEPTED", version: "x" },
      null,
    ]);
    expect(r[0].recordedVersion).toBe(TERMS_VERSION);
    expect(r[1].recordedVersion).toBeNull();
  });

  it("tautan Baca menyebut nama dokumen, tab baru, >= 44px", () => {
    render(<LegalDocsCard rows={rows()} />);
    const t = screen.getByRole("link", { name: /Baca Syarat & Ketentuan/ });
    expect(t).toHaveAttribute("href", "/terms");
    expect(t).toHaveAttribute("target", "_blank");
    expect(t).toHaveAttribute("rel", "noopener noreferrer");
    expect(t).toHaveClass("min-h-11");
    expect(screen.getByRole("link", { name: /Baca Kebijakan Privasi/ })).toHaveAttribute("href", "/privacy");
  });

  it("galat baca: role=alert 'bukan keadaan kosong' + tombol Muat ulang yang me-refresh", () => {
    render(<LegalDocsCard rows={[]} loadError />);
    expect(screen.getByRole("alert")).toHaveTextContent("Riwayat dokumen belum dapat dimuat.");
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang" }));
    expect(refreshMock).toHaveBeenCalled();
  });
});

describe("RightsSection (email/manual)", () => {
  it("teks tanpa durasi/SLA; alamat dari LEGAL.contactEmail; mailto benar tanpa data pribadi", () => {
    render(<RightsSection email={LEGAL.contactEmail} />);
    expect(screen.getByText(RIGHTS_BODY)).toBeInTheDocument();
    expect(screen.getByText(`Email: ${LEGAL.contactEmail}`)).toBeInTheDocument();
    const mail = screen.getByRole("link", { name: "Kirim email permintaan" });
    expect(mail).toHaveAttribute("href", buildMailto(LEGAL.contactEmail));
    expect(buildMailto(LEGAL.contactEmail)).toBe(
      `mailto:${LEGAL.contactEmail}?subject=Permintaan%20Data%20LINOE&body=${encodeURIComponent("Jenis permintaan (akses / koreksi / penghapusan / tarik persetujuan):")}`,
    );
    expect(findForbidden(document.body.textContent ?? "")).toEqual([]);
    expect(screen.getByRole("link", { name: "Hak Anda di Kebijakan Privasi" })).toHaveAttribute("href", "/privacy#hak");
    expect(screen.getByRole("link", { name: "Tata cara penghapusan data" })).toHaveAttribute("href", "/data-deletion");
  });

  it("salin: sukses dan gagal", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("x"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<RightsSection email={LEGAL.contactEmail} />);
    fireEvent.click(screen.getByRole("button", { name: "Salin alamat email" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(COPY_OK));
    expect(writeText).toHaveBeenCalledWith(LEGAL.contactEmail);
    fireEvent.click(screen.getByRole("button", { name: "Salin alamat email" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(COPY_FAIL));
  });
});

describe("kartu masuk dan gerbang rute", () => {
  it("kartu masuk menautkan ke /settings/privasi dengan target >= 44px", () => {
    const { container } = render(<PrivacyEntryCard />);
    expect(screen.getByRole("link", { name: /Privasi & Data Saya/ })).toHaveAttribute("href", "/settings/privasi");
    expect(container.querySelector(".min-h-11")).not.toBeNull();
  });

  it("rute: 404 saat UI MATI, sesi dengan onboarding belum selesai diizinkan, tiga sumber dimuat terpisah dengan try/catch", () => {
    const src = read("app/(app)/settings/privasi/page.tsx");
    expect(src).toContain("if (!isConsentUiEnabled()) notFound();");
    expect(src.indexOf("notFound()")).toBeLessThan(src.indexOf("requireSessionContext"));
    expect(src).toContain("allowIncompleteOnboarding: true");
    expect(src.match(/try \{/g)?.length).toBeGreaterThanOrEqual(2);
    expect(read("features/consent/consent-section.tsx")).toContain("catch");
  });

  it("Pengaturan: kartu masuk menggantikan ConsentSection, hanya saat UI hidup", () => {
    const page = read("app/(app)/settings/page.tsx");
    expect(page).toContain("isConsentUiEnabled() ? <PrivacyEntryCard />");
    expect(page).not.toContain("<ConsentSection");
  });

  it("layout meneruskan showPrivacyLink dari flag server; sidebar menampilkannya hanya bila true", () => {
    expect(read("app/(app)/layout.tsx")).toContain("showPrivacyLink={isConsentUiEnabled()}");
    const side = read("components/layout/sidebar.tsx");
    expect(side).toContain("{showPrivacyLink ? (");
    expect(side).toContain('showPrivacyLink = false');
  });

  it("tautan galat consent_required di Koneksi menuju /settings/privasi#persetujuan", () => {
    expect(read("app/(app)/connections/page.tsx")).toContain('href="/settings/privasi#persetujuan"');
  });
});

describe("teks halaman: tanpa pola terlarang dan tanpa 'berlaku sejak'", () => {
  it("konstanta teks bebas pola terlarang", () => {
    for (const t of [PAGE_INTRO, SCOPE_NOTE, MARKETING_NOTE_TITLE, MARKETING_NOTE_BODY, RIGHTS_BODY, COPY_OK, COPY_FAIL, NO_RECORD_TEXT]) expect(findForbidden(t), t).toEqual([]);
  });
});

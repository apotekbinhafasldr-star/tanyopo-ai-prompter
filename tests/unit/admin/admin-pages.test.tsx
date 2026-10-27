import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { permissionsOf, type AdminPrincipal, type Permission, type PlatformRole } from "@/lib/admin/permissions";

const hoisted = vi.hoisted(() => ({
  principal: null as AdminPrincipal | null,
  pathname: "/admin",
  calls: [] as string[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => hoisted.pathname,
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

// Mirrors the real gate: no principal, or a missing permission, is a 404. The real gate has its own tests.
vi.mock("@/services/platform-admin", () => ({
  requireAdminPage: vi.fn(async (permission: Permission) => {
    hoisted.calls.push(permission);
    if (!hoisted.principal || !hoisted.principal.permissions.has(permission)) throw new Error("NEXT_NOT_FOUND");
    return hoisted.principal;
  }),
  canSeeAdminCenterLink: vi.fn(async () => false),
}));

import AdminLayout from "@/app/admin/layout";
import AdminOverviewPage from "@/app/admin/page";
import AdminFinancePage from "@/app/admin/finance/page";
import AdminTaxPage from "@/app/admin/finance/tax/page";
import AdminStaffPage from "@/app/admin/staff/page";
import AdminReportsPage from "@/app/admin/finance/reports/page";
import AdminTaxGuidePage from "@/app/admin/finance/tax/guide/page";
import AdminTaxOptimizationPage from "@/app/admin/finance/tax/optimization/page";

/** Text a reader sees: the scoped <style> block is not content. */
const visibleText = (el: HTMLElement): string => {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("style").forEach((n) => n.remove());
  return clone.textContent ?? "";
};
const SP = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });

function as(role: PlatformRole, permissions: string[] = []) {
  hoisted.principal = { userId: "actor", role, permissions: permissionsOf({ role, permissions }) };
}

const PAGES: Array<[string, () => Promise<React.ReactElement>, Permission]> = [
  ["overview", () => AdminOverviewPage(), "admin.overview"],
  ["finance", () => AdminFinancePage(SP()), "finance.view"],
  ["reports", () => AdminReportsPage(SP()), "accounting.view"],
  ["tax", () => AdminTaxPage(), "tax.view"],
  ["tax guide", () => AdminTaxGuidePage(SP({ jenis: "pph-badan" })), "tax.view"],
  ["tax optimization", () => AdminTaxOptimizationPage(SP()), "tax.optimization.view"],
  ["staff", () => AdminStaffPage(), "staff.view"],
];

beforeEach(() => {
  hoisted.principal = null;
  hoisted.pathname = "/admin";
  hoisted.calls = [];
});
afterEach(() => cleanup());

describe("server rejects non-admins on every page (and on the layout)", () => {
  it.each(PAGES)("%s page renders nothing for a customer / signed-out visitor", async (_n, page) => {
    hoisted.principal = null;
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the layout rejects a non-admin before rendering any child", async () => {
    await expect(AdminLayout({ children: <p>secret child</p> })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("each page asks for its own permission, not just the layout's", async () => {
    as("SUPER_ADMIN");
    for (const [, page, permission] of PAGES) {
      hoisted.calls = [];
      await page();
      expect(hoisted.calls).toContain(permission);
    }
  });

  it("an employee without the permission is rejected by that page only", async () => {
    as("STAFF", ["finance.view"]);
    await expect(AdminFinancePage(SP())).resolves.toBeTruthy();
    await expect(AdminReportsPage(SP())).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(AdminTaxPage()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(AdminTaxGuidePage(SP())).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(AdminTaxOptimizationPage(SP())).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(AdminStaffPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("demo data is labelled and nothing financial can be done", () => {
  it.each(PAGES)("%s page shows the DEMO banner", async (_n, page) => {
    as("SUPER_ADMIN");
    render(await page());
    expect(screen.getByTestId("demo-banner")).toHaveTextContent("DATA DEMO");
  });

  it.each(PAGES.filter(([n]) => n !== "tax" && n !== "tax guide"))("%s page has no forms and no inputs; no action button is enabled", async (_n, page) => {
    as("SUPER_ADMIN");
    const { container } = render(await page());
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelectorAll("input, textarea, select")).toHaveLength(0);
    // The only enabled buttons are chart controls (view-only toggles).
    for (const b of container.querySelectorAll("button")) {
      if (!b.closest(".fin-chart")) expect(b).toBeDisabled();
    }
  });

  it("finance page shows KPI cards with a trend, the filters and the automatic checks", async () => {
    as("SUPER_ADMIN");
    render(await AdminFinancePage(SP({ period: "2026-11" })));
    expect(screen.getByText("Pendapatan diakui")).toBeInTheDocument();
    expect(screen.getByText("Pembayaran terverifikasi")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-revenue")).toHaveTextContent("vs bulan lalu");
    expect(screen.getByRole("navigation", { name: "Periode" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("Neraca seimbang")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Setujui refund/ })).not.toBeInTheDocument();
  });

  it("finance page ignores an invalid period or status instead of trusting the query string", async () => {
    as("SUPER_ADMIN");
    const { container } = render(await AdminFinancePage(SP({ period: "<script>", status: "DROP TABLE" })));
    expect(container.innerHTML).not.toContain("<script>");
    expect(screen.getAllByText(/November 2026/).length).toBeGreaterThan(0);
  });

  it("tax page never shows a tax rate or amount while the configuration is unverified", async () => {
    as("SUPER_ADMIN");
    const { container } = render(await AdminTaxPage());
    expect(screen.getAllByText(/Belum dikonfigurasi/).length).toBeGreaterThan(0);
    expect(visibleText(container)).not.toMatch(/\d\s?%/);
    expect(visibleText(container)).toMatch(/Segmen LINOE|segmen LINOE/);
    expect(visibleText(container)).toMatch(/bukan SPT/i);
  });

  it("tax page: the Coretax button is a POST form, enabled only with tax.export", async () => {
    as("SUPER_ADMIN");
    const first = render(await AdminTaxPage());
    const form = first.container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form?.getAttribute("method")?.toLowerCase()).toBe("post");
    expect(form?.getAttribute("action")).toBe("/admin/finance/tax/coretax-package");
    expect(screen.getByRole("button", { name: "SIAPKAN PAKET CORETAX" })).toBeEnabled();
    expect(first.container.querySelectorAll("input:not([type=hidden])")).toHaveLength(0);
    first.unmount();
    as("STAFF", ["tax.view"]);
    render(await AdminTaxPage());
    expect(screen.getByRole("button", { name: "SIAPKAN PAKET CORETAX" })).toBeDisabled();
    expect(screen.getByText(/belum memiliki izin/)).toBeInTheDocument();
  });

  it("tax page never claims auto-import and says what the package is not", async () => {
    as("SUPER_ADMIN");
    const { container } = render(await AdminTaxPage());
    const t = visibleText(container);
    expect(t).toMatch(/tidak otomatis dapat diimpor/);
    expect(t).toMatch(/tidak login, tidak mengirim SPT, dan tidak membayar pajak/);
    expect(t).not.toMatch(/impor otomatis ke Coretax|langsung ke Coretax/i);
  });

  it("staff page is read-only and states the no-self-promotion rules", async () => {
    as("SUPER_ADMIN");
    render(await AdminStaffPage());
    expect(screen.getByRole("button", { name: "Ubah akses staf" })).toBeDisabled();
    expect(screen.getByText(/mengangkat dirinya menjadi Super Admin/)).toBeInTheDocument();
    expect(screen.getByText(/Tidak ada alamat email yang diberi hak khusus/)).toBeInTheDocument();
  });

  it("overview only builds finance numbers for people who may see finance", async () => {
    as("STAFF", ["tax.view"]);
    render(await AdminOverviewPage());
    expect(screen.queryByText("Pendapatan diakui")).not.toBeInTheDocument();
    expect(screen.getByText("Pajak")).toBeInTheDocument();
    expect(screen.queryByText("Keuangan")).not.toBeInTheDocument();
  });
});

describe("no sensitive data leaks into any rendered page", () => {
  it("contains only DEMO identifiers, no emails, keys, secrets or real ids", async () => {
    as("SUPER_ADMIN");
    for (const [, page] of PAGES) {
      const { container, unmount } = render(await page());
      // Official public law download links (JDIH Kemenkeu) carry a document id; that is a source citation, not a private id.
      const text = container.innerHTML.replace(/https:\/\/jdih\.kemenkeu\.go\.id\/api\/download\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+/g, "[SUMBER-RESMI]");
      expect(text).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      expect(text).not.toMatch(/service_role|SUPABASE|secret|apikey|api_key|bearer/i);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      for (const m of text.matchAll(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g)) expect(m[0].startsWith("DEMO-") || m[0] === "SHA-256", m[0]).toBe(true);
      unmount();
    }
  });
});

describe("mobile-first layout and navigation", () => {
  async function renderLayout(path = "/admin") {
    hoisted.pathname = path;
    render(await AdminLayout({ children: <p>isi halaman</p> }));
  }

  it("renders a bottom tab bar on phones with every permitted section as a real link", async () => {
    as("SUPER_ADMIN");
    await renderLayout();
    const nav = screen.getByRole("navigation", { name: "Navigasi Admin Center" });
    expect(nav.className).toContain("fixed");
    expect(nav.className).toContain("bottom-0");
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/admin", "/admin/finance", "/admin/finance/reports", "/admin/finance/tax", "/admin/staff"]);
    for (const l of links) expect(l.className).toContain("min-h-14");
  });

  it("marks the current section and highlights the specific one for nested routes", async () => {
    as("SUPER_ADMIN");
    await renderLayout("/admin/finance/tax");
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/admin/finance/tax");
  });

  it("shows an employee only the sections they were granted", async () => {
    as("STAFF", ["finance.view"]);
    await renderLayout();
    const nav = screen.getByRole("navigation", { name: "Navigasi Admin Center" });
    expect(within(nav).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/admin", "/admin/finance"]);
  });

  it("shows the role, the page content and a way back to the customer app", async () => {
    as("SUPER_ADMIN");
    await renderLayout();
    expect(screen.getByText("Super Admin")).toBeInTheDocument();
    expect(screen.getByText("isi halaman")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Aplikasi|Kembali ke aplikasi/ })).toHaveAttribute("href", "/dashboard");
  });
});

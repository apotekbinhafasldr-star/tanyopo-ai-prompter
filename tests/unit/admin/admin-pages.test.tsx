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

function as(role: PlatformRole, permissions: string[] = []) {
  hoisted.principal = { userId: "actor", role, permissions: permissionsOf({ role, permissions }) };
}

const PAGES: Array<[string, () => Promise<React.ReactElement>, Permission]> = [
  ["overview", () => AdminOverviewPage(), "admin.overview"],
  ["finance", () => AdminFinancePage(), "finance.view"],
  ["tax", () => AdminTaxPage(), "tax.view"],
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
    await expect(AdminFinancePage()).resolves.toBeTruthy();
    await expect(AdminTaxPage()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(AdminStaffPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("demo data is labelled and nothing financial can be done", () => {
  it.each(PAGES)("%s page shows the DEMO banner", async (_n, page) => {
    as("SUPER_ADMIN");
    render(await page());
    expect(screen.getByTestId("demo-banner")).toHaveTextContent("DATA DEMO");
  });

  it.each(PAGES)("%s page has no forms and every button is disabled", async (_n, page) => {
    as("SUPER_ADMIN");
    const { container } = render(await page());
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelectorAll("input, textarea, select")).toHaveLength(0);
    for (const b of container.querySelectorAll("button")) expect(b).toBeDisabled();
  });

  it("finance page shows the four layers separately and the sample statuses", async () => {
    as("SUPER_ADMIN");
    render(await AdminFinancePage());
    expect(screen.getByText("Pembayaran terverifikasi")).toBeInTheDocument();
    expect(screen.getAllByText("Pendapatan diakui").length).toBeGreaterThan(0);
    expect(screen.getByText("Dana sudah settle")).toBeInTheDocument();
    expect(screen.getByText("Belum settle")).toBeInTheDocument();
    expect(screen.getAllByText("Settle terlambat").length).toBeGreaterThan(0);
    expect(screen.getByText("Selisih jumlah")).toBeInTheDocument();
    expect(screen.getByText("Invoice dibayar lebih dari sekali")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Setujui refund" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ekspor CSV" })).toBeDisabled();
  });

  it("tax page never shows a tax rate or amount while the configuration is unverified", async () => {
    as("SUPER_ADMIN");
    const { container } = render(await AdminTaxPage());
    expect(screen.getByText("Belum terverifikasi")).toBeInTheDocument();
    expect(screen.getAllByText(/Belum dikonfigurasi/).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/%/);
    expect(container.textContent).not.toMatch(/PPN:\s*Rp/);
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
      const text = container.innerHTML;
      expect(text).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      expect(text).not.toMatch(/service_role|SUPABASE|secret|apikey|api_key|bearer/i);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      for (const m of text.matchAll(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g)) expect(m[0].startsWith("DEMO-"), m[0]).toBe(true);
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
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/admin", "/admin/finance", "/admin/finance/tax", "/admin/staff"]);
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

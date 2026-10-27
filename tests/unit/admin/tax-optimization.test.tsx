import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { permissionsOf, type AdminPrincipal, type Permission } from "@/lib/admin/permissions";

const hoisted = vi.hoisted(() => ({ principal: null as AdminPrincipal | null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/finance/tax/optimization", notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/services/platform-admin", () => ({
  requireAdminPage: vi.fn(async (permission: Permission) => {
    if (!hoisted.principal || !hoisted.principal.permissions.has(permission)) throw new Error("NEXT_NOT_FOUND");
    return hoisted.principal;
  }),
  canSeeAdminCenterLink: vi.fn(async () => false),
}));

import Page from "@/app/admin/finance/tax/optimization/page";
const SP = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });
const as = (role: "SUPER_ADMIN" | "STAFF", permissions: string[] = []) => {
  hoisted.principal = { userId: "u", role, permissions: permissionsOf({ role, permissions }) };
};
afterEach(() => cleanup());

describe("Persetujuan Founder dan status verifikasi hukum", () => {
  it("DEMO data cannot be approved; card shows fingerprint, rules version and no form", async () => {
    as("SUPER_ADMIN");
    const { container } = render(await Page(SP()));
    const card = screen.getByTestId("approval-card");
    expect(card).toHaveTextContent("Tidak dapat disimpan: data masih DEMO");
    expect(card).toHaveTextContent(/Sidik perhitungan/);
    expect(card).toHaveTextContent(/taxopt-e1;law=2026-10-27/);
    expect(card).toHaveTextContent(/tidak dapat diubah/);
    expect(container.querySelector("form")).toBeNull();
  });
  it("blocked and DJP-only provisions are shown as such, never as verified", async () => {
    as("SUPER_ADMIN");
    render(await Page(SP()));
    expect(screen.getByTestId("provision-P5")).toHaveTextContent("BLOCKED");
    expect(screen.getByTestId("provision-P10")).toHaveTextContent("BLOCKED");
    expect(screen.getByTestId("provision-P8")).toHaveTextContent("SEKUNDER DJP");
    expect(screen.getByTestId("provision-P1")).toHaveTextContent("TERVERIFIKASI PRIMER");
    expect(screen.getByTestId("provision-summary")).toHaveTextContent(/BLOCKED \d+/);
  });
});

describe("Optimasi Pajak Legal page", () => {
  it("is a 404 for signed-out visitors and staff without the special permission", async () => {
    hoisted.principal = null;
    await expect(Page(SP())).rejects.toThrow("NEXT_NOT_FOUND");
    as("STAFF", ["tax.view", "tax.export", "accounting.view"]);
    await expect(Page(SP())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("staff with tax.optimization.view can see it but cannot approve", async () => {
    as("STAFF", ["tax.optimization.view"]);
    render(await Page(SP()));
    expect(screen.getByText(/akun ini tidak berhak menyetujui/)).toBeInTheDocument();
  });

  it("real demo state shows BELUM DAPAT DIHITUNG and no invented savings", async () => {
    as("SUPER_ADMIN");
    render(await Page(SP()));
    expect(screen.getByTestId("demo-banner")).toHaveTextContent("DATA DEMO");
    expect(screen.getAllByText("BELUM DAPAT DIHITUNG").length).toBeGreaterThan(0);
    expect(screen.getByText("BELUM SIAP")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-link")).toBeInTheDocument();
  });

  it("scenario contoh is labelled fictional and still not ready; unknown scenario values are ignored", async () => {
    as("SUPER_ADMIN");
    const { unmount } = render(await Page(SP({ skenario: "contoh" })));
    expect(screen.getByTestId("scenario-banner")).toHaveTextContent("fiktif");
    expect(screen.getByText("BELUM SIAP")).toBeInTheDocument();
    expect(screen.getAllByText("SIMULASI").length).toBeGreaterThan(0);
    unmount();
    render(await Page(SP({ skenario: "<script>" })));
    expect(screen.queryByTestId("scenario-banner")).not.toBeInTheDocument();
  });

  it("shows legal sources with regulation, validity, requirements and verification date; no forms", async () => {
    as("SUPER_ADMIN");
    const { container } = render(await Page(SP()));
    expect(screen.getAllByTestId("legal-source").length).toBeGreaterThan(3);
    expect(container.textContent).toContain("2026-10-27");
    expect(container.querySelectorAll("form, input, textarea, select")).toHaveLength(0);
  });

  it("notices are never concluded and show official paths", async () => {
    as("SUPER_ADMIN");
    render(await Page(SP()));
    expect(screen.getByTestId("notice")).toHaveTextContent(/Pengurangan|Pembetulan|Keberatan/i);
    expect(document.body.textContent).toMatch(/tidak menyimpulkan surat benar atau salah/);
  });
});

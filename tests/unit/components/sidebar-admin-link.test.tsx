import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("@/features/auth/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/components/brand/linoe-logo", () => ({ LinoeLogo: () => <span>LINOE</span> }));

const hoisted = vi.hoisted(() => ({ canSee: false }));
vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({
    businessName: "Toko Contoh",
    userName: "Pelanggan",
    role: "owner",
  })),
}));
vi.mock("@/services/platform-admin", () => ({ canSeeAdminCenterLink: vi.fn(async () => hoisted.canSee) }));

import { Sidebar } from "@/components/layout/sidebar";
import { AppShell } from "@/components/layout/app-shell";
import AppLayout from "@/app/(app)/layout";

afterEach(() => cleanup());

describe('"Admin Perusahaan" button visibility', () => {
  it("is not rendered by default (customers)", () => {
    render(<Sidebar businessName="T" userName="U" userRole="owner" />);
    expect(screen.queryByText("Admin Perusahaan")).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/admin"]')).toBeNull();
  });

  it("is not rendered when explicitly false", () => {
    render(<Sidebar businessName="T" userName="U" userRole="owner" showAdminLink={false} />);
    expect(screen.queryByText("Admin Perusahaan")).not.toBeInTheDocument();
  });

  it("is rendered, pointing at /admin, only when the server says so", () => {
    render(<Sidebar businessName="T" userName="U" userRole="owner" showAdminLink />);
    expect(screen.getByRole("link", { name: "Admin Perusahaan" })).toHaveAttribute("href", "/admin");
  });

  it("AppShell hides it unless told otherwise and forwards the flag", () => {
    const { rerender } = render(
      <AppShell businessName="T" userName="U" userRole="owner">
        <p>x</p>
      </AppShell>,
    );
    expect(screen.queryByText("Admin Perusahaan")).not.toBeInTheDocument();
    rerender(
      <AppShell businessName="T" userName="U" userRole="owner" showAdminLink>
        <p>x</p>
      </AppShell>,
    );
    expect(screen.getByText("Admin Perusahaan")).toBeInTheDocument();
  });

  it("the customer app layout passes the server's decision, and a tenant owner never gets the button", async () => {
    hoisted.canSee = false;
    const hidden = (await AppLayout({ children: null })) as { props: { showAdminLink: boolean } };
    expect(hidden.props.showAdminLink).toBe(false);
    hoisted.canSee = true;
    const shown = (await AppLayout({ children: null })) as { props: { showAdminLink: boolean } };
    expect(shown.props.showAdminLink).toBe(true);
  });
});

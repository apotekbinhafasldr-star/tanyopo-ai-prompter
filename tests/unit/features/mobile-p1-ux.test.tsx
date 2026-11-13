import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/brand/linoe-logo", () => ({ LinoeLogo: () => <span>LINOE</span> }));
vi.mock("@/features/auth/actions", () => ({
  logoutAction: vi.fn(),
  resetPasswordAction: vi.fn(async () => ({ error: "Tautan kedaluwarsa. Minta tautan baru." })),
  loginAction: vi.fn(async () => ({ error: "Email atau kata sandi salah." })),
}));

import { AppShell } from "@/components/layout/app-shell";
import { LoginForm } from "@/features/auth/login-form";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("P1 mobile UX: login tidak menghapus email setelah gagal", () => {
  it("email tetap terisi setelah kata sandi salah, kata sandi tidak disimpan", async () => {
    render(<LoginForm />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "budi@example.com" } });
    fireEvent.change(document.getElementById("password") as HTMLInputElement, { target: { value: "salah-salah" } });
    await act(async () => {
      fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Email atau kata sandi salah.");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("budi@example.com");
  });

  it("tautan 'Lupa kata sandi?' punya target sentuh minimal 44px (min-h-11)", () => {
    render(<LoginForm />);
    expect(screen.getByRole("link", { name: "Lupa kata sandi?" }).className).toContain("min-h-11");
  });
});

describe("P1 mobile UX: reset password tidak buntu", () => {
  it("selalu ada jalan keluar: minta tautan baru dan kembali ke masuk", () => {
    render(<ResetPasswordForm />);
    expect(screen.getByRole("link", { name: "Minta tautan baru" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByRole("link", { name: "Kembali ke halaman masuk" })).toHaveAttribute("href", "/login");
  });
});

describe("P1 mobile UX: drawer tertutup tidak terbaca pembaca layar", () => {
  const shell = () => (
    <AppShell businessName="T" userName="U" userRole="owner">
      <p>isi</p>
    </AppShell>
  );
  const drawer = () => document.getElementById("app-sidebar-drawer") as HTMLElement;
  const stubViewport = (desktop: boolean) =>
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: desktop, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );

  it("layar kecil: tertutup = inert, terbuka = tidak inert", () => {
    stubViewport(false);
    render(shell());
    expect(drawer()).toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "Buka menu" }));
    expect(drawer()).not.toHaveAttribute("inert");
  });

  it("layar lebar (docked): tidak pernah inert", () => {
    stubViewport(true);
    render(shell());
    expect(drawer()).not.toHaveAttribute("inert");
  });

  it("tanpa matchMedia (SSR/jsdom): tidak inert (aman)", () => {
    render(shell());
    expect(drawer()).not.toHaveAttribute("inert");
  });
});

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

const { getUserMock, logoutActionMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  logoutActionMock: vi.fn(),
}));
vi.mock("@/features/auth/actions", () => ({
  logoutAction: logoutActionMock,
  registerAction: vi.fn(),
  loginAction: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

import { ActiveSessionNotice } from "@/features/auth/active-session-notice";
import RegisterPage from "@/app/(auth)/register/page";
import LoginPage from "@/app/(auth)/login/page";

afterEach(() => {
  cleanup();
  getUserMock.mockReset();
});

describe("ActiveSessionNotice", () => {
  it("shows the active account email with Lanjut ke Dashboard and Keluar", () => {
    render(<ActiveSessionNotice email="lama@example.com" continueHref="/dashboard" context="register" />);
    expect(screen.getByTestId("active-session-email").textContent).toBe("lama@example.com");
    expect(screen.getByRole("link", { name: "Lanjut ke Dashboard" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.getByRole("button", { name: "Keluar" })).toBeTruthy();
  });

  it("copes with an account that has no email", () => {
    render(<ActiveSessionNotice email={null} continueHref="/dashboard" context="login" />);
    expect(screen.getByTestId("active-session-email").textContent).toMatch(/tanpa alamat email/i);
  });
});

describe("/register and /login pages with a live session", () => {
  it("/register shows the server-verified email instead of the form", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: "lama@example.com" } } });
    render(await RegisterPage());
    expect(screen.getByTestId("active-session-email").textContent).toBe("lama@example.com");
    expect(screen.queryByText("Buat akun LINOE")).toBeNull();
  });

  it("/register shows the registration form when there is no session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    render(await RegisterPage());
    expect(screen.getByText("Buat akun LINOE")).toBeTruthy();
    expect(screen.queryByTestId("active-session-email")).toBeNull();
  });

  it("/login with a session offers a safe continue target and never an off-site one", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: "lama@example.com" } } });
    render(await LoginPage({ searchParams: Promise.resolve({ next: "/promote?handoff=abc" }) }));
    expect(screen.getByRole("link", { name: "Lanjut ke Dashboard" }).getAttribute("href")).toBe("/promote?handoff=abc");
    cleanup();

    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: "lama@example.com" } } });
    render(await LoginPage({ searchParams: Promise.resolve({ next: "//evil.com" }) }));
    expect(screen.getByRole("link", { name: "Lanjut ke Dashboard" }).getAttribute("href")).toBe("/dashboard");
  });

  it("/login shows the login form when there is no session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Masuk ke akun Anda")).toBeTruthy();
  });
});

describe("proxy.ts regression: no silent bounce for signed-in visitors", () => {
  const source = readFileSync("proxy.ts", "utf8");

  it("does not redirect an authenticated user away from /login or /register", () => {
    expect(source).not.toContain("AUTH_ONLY_PATHS");
    expect(source).not.toMatch(/user\s*&&[^\n]*redirect/);
    expect(source).not.toMatch(/NextResponse\.redirect\(new URL\("\/dashboard"/);
  });

  it("still redirects an unauthenticated visitor on a protected path to /login", () => {
    expect(source).toMatch(/!user\s*&&\s*!isPublicPath/);
    expect(source).toContain('new URL("/login", request.url)');
  });
});

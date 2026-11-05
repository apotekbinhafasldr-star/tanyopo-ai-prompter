import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Integration: the REAL registerAction (only its I/O is mocked) feeds the REAL form, so the form can never again be
// tested against a hand-written state that differs from what the action returns (the PR #92 -> PR-93 bug).

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

const { signUpMock, getUserMock } = vi.hoisted(() => ({ signUpMock: vi.fn(), getUserMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { signUp: signUpMock, getUser: getUserMock } })),
}));

import { RegisterForm } from "@/features/auth/register-form";

function fill() {
  fireEvent.change(screen.getByLabelText("Nama Anda"), { target: { value: "Budi" } });
  fireEvent.change(screen.getByLabelText("Nama Bisnis"), { target: { value: "Toko Budi" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "lama@example.com" } });
  fireEvent.change(document.getElementById("password") as HTMLInputElement, { target: { value: "Rahasia-123" } });
  fireEvent.click(document.getElementById("acceptLegal") as HTMLInputElement);
}

async function submit() {
  await act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });
}

beforeEach(() => {
  signUpMock.mockReset();
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });
});
afterEach(() => cleanup());

describe("RegisterForm + real registerAction", () => {
  it("founder's sequence: existing email -> card -> 'Gunakan email lain' -> form with values, no success card", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });
    render(<RegisterForm />);
    fill();
    await submit();

    expect(screen.getByText("Email sudah terdaftar")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Gunakan email lain" }));

    expect(screen.getByText("Buat akun LINOE")).toBeTruthy();
    expect(screen.queryByText("Cek email Anda")).toBeNull();
    expect((screen.getByLabelText("Nama Anda") as HTMLInputElement).value).toBe("Budi");
    expect((screen.getByLabelText("Nama Bisnis") as HTMLInputElement).value).toBe("Toko Budi");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("lama@example.com");
    expect((document.getElementById("password") as HTMLInputElement).value).toBe("");
    expect(signUpMock).toHaveBeenCalledTimes(1);
  });

  it("a genuine new signup (identities present, no session) shows 'Cek email Anda'", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [{ id: "i1" }] }, session: null }, error: null });
    render(<RegisterForm />);
    fill();
    await submit();

    expect(screen.getByText("Cek email Anda")).toBeTruthy();
    expect(screen.queryByText("Email sudah terdaftar")).toBeNull();
  });
});

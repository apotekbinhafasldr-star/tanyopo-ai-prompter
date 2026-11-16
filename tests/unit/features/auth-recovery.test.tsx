import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { signInMock, resendMock, getUserMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  resendMock: vi.fn(),
  getUserMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { signInWithPassword: signInMock, resend: resendMock, getUser: getUserMock, signOut: vi.fn() },
  })),
}));

import { __resetRateLimitStateForTests } from "@/lib/rate-limit";
import * as authActions from "@/features/auth/actions";
import { loginAction } from "@/features/auth/actions";
import { mapLoginError } from "@/lib/auth/login-error";
import {
  CONFIRM_NOTICE_MESSAGES,
  UNCONFIRMED_LOGIN_MESSAGE,
  UNCONFIRMED_RESEND_MESSAGES,
  parseConfirmNotice,
} from "@/lib/auth/confirm-notice";
import { LoginForm } from "@/features/auth/login-form";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
const login = (email: string, password = "x12345678") => loginAction({ error: null }, form({ email, password }));
const NOT_CONFIRMED = { status: 400, code: "email_not_confirmed" };

beforeEach(() => {
  __resetRateLimitStateForTests();
  signInMock.mockReset();
  resendMock.mockReset();
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: null } });
  resendMock.mockResolvedValue({ error: null });
});
afterEach(() => cleanup());

describe("mapLoginError: kontrak error Supabase berbasis kode", () => {
  it("hanya code === 'email_not_confirmed' yang dianggap belum dikonfirmasi; teks pesan tidak dipakai", () => {
    expect(mapLoginError(NOT_CONFIRMED)).toEqual({ message: UNCONFIRMED_LOGIN_MESSAGE, unconfirmed: true });
    // pesan yang mirip tanpa kode TIDAK memicu apa pun (fail-closed)
    expect(mapLoginError({ status: 400, message: "Email not confirmed" } as { status: number }).unconfirmed).toBe(false);
    expect(mapLoginError({ status: 400, code: "invalid_credentials" })).toEqual({
      message: "Email atau kata sandi salah.",
      unconfirmed: false,
    });
    expect(mapLoginError({ status: 400 }).unconfirmed).toBe(false);
    expect(mapLoginError({ status: 500 }).message).toMatch(/Gagal masuk/);
  });
});

describe("parseConfirmNotice", () => {
  it("hanya menerima dua kode yang dikenal dan tidak pernah memantulkan input", () => {
    expect(parseConfirmNotice("link_expired")).toBe("link_expired");
    expect(parseConfirmNotice("link_invalid")).toBe("link_invalid");
    expect(parseConfirmNotice("<script>alert(1)</script>")).toBeNull();
    expect(parseConfirmNotice(undefined)).toBeNull();
  });
});

describe("loginAction: resend hanya setelah kata sandi benar + email_not_confirmed", () => {
  it("kata sandi benar tapi belum dikonfirmasi: satu resend, pesan 'terkirim', bukan error", async () => {
    signInMock.mockResolvedValue({ error: NOT_CONFIRMED });
    const r = await login("Budi@Example.com ");
    expect(r).toEqual({ error: null, info: UNCONFIRMED_RESEND_MESSAGES.sent });
    expect(resendMock).toHaveBeenCalledTimes(1);
    expect(resendMock).toHaveBeenCalledWith({ type: "signup", email: "budi@example.com" });
  });

  it("tanpa resend: kata sandi salah / akun tak dikenal / error lain / respons tanpa kode", async () => {
    for (const err of [
      { status: 400, code: "invalid_credentials" },
      { status: 400 },
      { status: 500, code: "unexpected_failure" },
      { status: 429, code: "over_request_rate_limit" },
      { status: 400, message: "Email not confirmed" },
    ]) {
      signInMock.mockResolvedValue({ error: err });
      const r = await login("x@example.com");
      expect(r.info).toBeUndefined();
      expect(r.error).toBeTruthy();
    }
    expect(resendMock).not.toHaveBeenCalled();
  });

  it("login berhasil: redirect dan tanpa resend", async () => {
    signInMock.mockResolvedValue({ error: null });
    await expect(login("ok@example.com")).rejects.toThrow(/REDIRECT:/);
    expect(resendMock).not.toHaveBeenCalled();
  });

  it("jawaban seragam untuk tak dikenal, sandi salah, dan terkonfirmasi-sandi-salah", async () => {
    signInMock.mockResolvedValue({ error: { status: 400, code: "invalid_credentials" } });
    const a = await login("tak-dikenal@example.com");
    const b = await login("terdaftar@example.com", "salah-sekali");
    expect(a).toEqual(b);
    expect(a).toEqual({ error: "Email atau kata sandi salah." });
  });

  it("cooldown 60 detik per alamat: percobaan kedua tidak memanggil resend lagi", async () => {
    signInMock.mockResolvedValue({ error: NOT_CONFIRMED });
    expect((await login("c@example.com")).info).toBe(UNCONFIRMED_RESEND_MESSAGES.sent);
    expect((await login("C@example.com")).info).toBe(UNCONFIRMED_RESEND_MESSAGES.wait);
    expect(resendMock).toHaveBeenCalledTimes(1);
    // alamat lain tidak terpengaruh
    expect((await login("d@example.com")).info).toBe(UNCONFIRMED_RESEND_MESSAGES.sent);
    expect(resendMock).toHaveBeenCalledTimes(2);
  });

  it("batas 5 per jam per alamat: resend otomatis tidak berulang tanpa batas", async () => {
    vi.useFakeTimers();
    try {
      signInMock.mockResolvedValue({ error: NOT_CONFIRMED });
      for (let i = 0; i < 5; i++) {
        expect((await login("jam@example.com")).info).toBe(UNCONFIRMED_RESEND_MESSAGES.sent);
        vi.advanceTimersByTime(61_000);
      }
      expect((await login("jam@example.com")).info).toBe(UNCONFIRMED_RESEND_MESSAGES.wait);
      expect(resendMock).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("penghitung tidak dibuat untuk percobaan tanpa bukti kata sandi (tidak ada pertumbuhan memori anonim)", async () => {
    signInMock.mockResolvedValue({ error: { status: 400, code: "invalid_credentials" } });
    for (let i = 0; i < 20; i++) await login(`acak${i}@example.com`);
    signInMock.mockResolvedValue({ error: NOT_CONFIRMED });
    // alamat yang sebelumnya salah-sandi masih punya jatah penuh
    expect((await login("acak0@example.com")).info).toBe(UNCONFIRMED_RESEND_MESSAGES.sent);
  });

  it("429 dari Supabase = tunggu; error resend lain atau exception = tidak pasti (tidak pernah klaim terkirim)", async () => {
    signInMock.mockResolvedValue({ error: NOT_CONFIRMED });
    resendMock.mockResolvedValue({ error: { status: 429, code: "over_email_send_rate_limit" } });
    expect((await login("e1@example.com")).info).toBe(UNCONFIRMED_RESEND_MESSAGES.wait);
    resendMock.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: 0 } });
    expect((await login("e2@example.com")).info).toBe(UNCONFIRMED_RESEND_MESSAGES.uncertain);
    resendMock.mockResolvedValue({ error: { status: 422, code: "unknown_failure" } });
    expect((await login("e3@example.com")).info).toBe(UNCONFIRMED_RESEND_MESSAGES.uncertain);
    resendMock.mockRejectedValue(new Error("boom"));
    expect((await login("e4@example.com")).info).toBe(UNCONFIRMED_RESEND_MESSAGES.uncertain);
  });

  it("signInWithPassword melempar exception: jawaban terkontrol, tanpa resend", async () => {
    signInMock.mockRejectedValue(new Error("network"));
    const r = await login("t@example.com");
    expect(r).toEqual({ error: "Gagal masuk. Silakan coba lagi." });
    expect(resendMock).not.toHaveBeenCalled();
  });

  it("bentuk respons dipatok untuk tiap hasil", async () => {
    signInMock.mockResolvedValue({ error: NOT_CONFIRMED });
    expect(await login("s1@example.com")).toEqual({ error: null, info: UNCONFIRMED_RESEND_MESSAGES.sent });
    expect(await login("s1@example.com")).toEqual({ error: null, info: UNCONFIRMED_RESEND_MESSAGES.wait });
    expect(await loginAction({ error: null }, form({ email: "bukan-email", password: "x" }))).toEqual({
      error: expect.any(String),
    });
  });
});

describe("tidak ada resend anonim", () => {
  it("modul actions tidak mengekspor action resend konfirmasi", () => {
    const exported = Object.keys(authActions);
    expect(exported.filter((name) => /resend/i.test(name))).toEqual([]);
  });

  it("berkas action resend anonim dan helper IP lama sudah dihapus", () => {
    const root = process.cwd();
    for (const rel of ["features/auth/recovery-actions.ts", "features/auth/resend-confirmation.tsx", "lib/auth/recovery-ip.ts"]) {
      expect(() => readFileSync(join(root, rel))).toThrow();
    }
  });

  it("satu-satunya pemanggil auth.resend({type:'signup'}) di features/auth selain jalur OTP berflag adalah loginAction", () => {
    const root = process.cwd();
    const actions = readFileSync(join(root, "features/auth/actions.ts"), "utf8");
    expect(actions.match(/auth\.resend\(/g)?.length).toBe(1);
    expect(actions).toContain("resendAfterVerifiedPassword");
    // fungsi pembantu tidak diekspor (file 'use server' hanya mengekspor action yang bisa dipanggil klien)
    expect(actions).not.toMatch(/export\s+(async\s+)?function\s+resendAfterVerifiedPassword/);
  });
});

describe("UI: LoginForm", () => {
  it("pemberitahuan tautan kedaluwarsa: instruksi masuk dengan email dan kata sandi + tautan lupa kata sandi (44px)", () => {
    render(<LoginForm notice="link_expired" />);
    expect(screen.getByText(CONFIRM_NOTICE_MESSAGES.link_expired)).toBeInTheDocument();
    expect(CONFIRM_NOTICE_MESSAGES.link_expired).toMatch(/email dan kata sandi/);
    const forgot = screen.getByRole("link", { name: /Lupa kata sandi\? Atur ulang di sini/ });
    expect(forgot).toHaveAttribute("href", "/forgot-password");
    expect(forgot.className).toContain("min-h-11");
    // tidak ada form kirim ulang anonim
    expect(screen.queryByLabelText("Email pendaftaran")).toBeNull();
    expect(screen.queryByRole("button", { name: /Kirim ulang/ })).toBeNull();
  });

  it("tautan tidak berlaku memakai instruksi yang sama", () => {
    render(<LoginForm notice="link_invalid" />);
    expect(screen.getByText(CONFIRM_NOTICE_MESSAGES.link_invalid)).toBeInTheDocument();
    expect(CONFIRM_NOTICE_MESSAGES.link_invalid).toMatch(/email dan kata sandi/);
  });

  it("tanpa notice tidak ada banner; region status selalu ada di DOM dan kosong", () => {
    render(<LoginForm />);
    expect(screen.queryByRole("link", { name: /Atur ulang di sini/ })).toBeNull();
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
  });

  it("kata sandi benar tapi belum dikonfirmasi: pesan 'terkirim' diumumkan lewat region status, bukan alert", async () => {
    signInMock.mockResolvedValue({ error: NOT_CONFIRMED });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ui@example.com" } });
    fireEvent.change(screen.getByLabelText("Kata Sandi"), { target: { value: "x12345678" } });
    await act(async () => {
      fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    });
    expect(screen.getByRole("status")).toHaveTextContent(UNCONFIRMED_RESEND_MESSAGES.sent);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(resendMock).toHaveBeenCalledTimes(1);
  });

  it("kata sandi salah: pesan error di role=alert, tidak ada status 'terkirim'", async () => {
    signInMock.mockResolvedValue({ error: { status: 400, code: "invalid_credentials" } });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ui2@example.com" } });
    fireEvent.change(screen.getByLabelText("Kata Sandi"), { target: { value: "salah12345" } });
    await act(async () => {
      fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Email atau kata sandi salah.");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(resendMock).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

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
import { loginAction } from "@/features/auth/actions";
import { resendConfirmationAction } from "@/features/auth/recovery-actions";
import { mapLoginError } from "@/lib/auth/login-error";
import {
  CONFIRM_NOTICE_MESSAGES,
  RESEND_CONFIRMATION_MESSAGES,
  UNCONFIRMED_LOGIN_MESSAGE,
  parseConfirmNotice,
} from "@/lib/auth/confirm-notice";
import { LoginForm } from "@/features/auth/login-form";
import { ResendConfirmation } from "@/features/auth/resend-confirmation";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  __resetRateLimitStateForTests();
  signInMock.mockReset();
  resendMock.mockReset();
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: null } });
  resendMock.mockResolvedValue({ error: null });
});
afterEach(() => cleanup());

describe("mapLoginError / loginAction: email belum dikonfirmasi", () => {
  it("email_not_confirmed memberi pesan khusus; 400 lain tetap 'salah'; selain itu generik", () => {
    expect(mapLoginError({ status: 400, code: "email_not_confirmed" })).toEqual({
      message: UNCONFIRMED_LOGIN_MESSAGE,
      unconfirmed: true,
    });
    expect(mapLoginError({ status: 400, code: "invalid_credentials" }).message).toMatch(/salah/i);
    expect(mapLoginError({ status: 400 }).unconfirmed).toBe(false);
    expect(mapLoginError({ status: 500 }).message).toMatch(/Gagal masuk/);
  });

  it("loginAction menyertakan unconfirmedEmail hanya untuk email_not_confirmed", async () => {
    signInMock.mockResolvedValue({ error: { status: 400, code: "email_not_confirmed" } });
    const unconfirmed = await loginAction({ error: null }, form({ email: "budi@example.com", password: "x12345678" }));
    expect(unconfirmed.error).toBe(UNCONFIRMED_LOGIN_MESSAGE);
    expect(unconfirmed.unconfirmedEmail).toBe("budi@example.com");

    signInMock.mockResolvedValue({ error: { status: 400, code: "invalid_credentials" } });
    const wrong = await loginAction({ error: null }, form({ email: "budi@example.com", password: "salah" }));
    expect(wrong.unconfirmedEmail).toBeUndefined();
    expect(wrong.error).toMatch(/salah/i);
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

describe("resendConfirmationAction", () => {
  it("jawaban sama untuk semua alamat: berhasil, tidak ditemukan, sudah terkonfirmasi (tanpa membocorkan akun)", async () => {
    const ok = await resendConfirmationAction({ outcome: "idle", message: null }, form({ email: "a@example.com" }));
    resendMock.mockResolvedValue({ error: { status: 400, code: "user_not_found" } });
    const missing = await resendConfirmationAction({ outcome: "idle", message: null }, form({ email: "b@example.com" }));
    resendMock.mockResolvedValue({ error: { status: 422, code: "email_exists" } });
    const confirmed = await resendConfirmationAction({ outcome: "idle", message: null }, form({ email: "c@example.com" }));

    for (const r of [ok, missing, confirmed]) {
      expect(r.outcome).toBe("sent");
      expect(r.message).toBe(RESEND_CONFIRMATION_MESSAGES.sent);
    }
    expect(resendMock).toHaveBeenCalledWith({ type: "signup", email: "c@example.com" });
  });

  it("cooldown 60 detik per alamat: permintaan kedua tidak sampai ke Supabase", async () => {
    await resendConfirmationAction({ outcome: "idle", message: null }, form({ email: "d@example.com" }));
    const second = await resendConfirmationAction({ outcome: "idle", message: null }, form({ email: "D@example.com" }));
    expect(second.outcome).toBe("wait");
    // alamat plus (d+1@...) memakai kunci cooldown yang sama dengan alamat dasarnya
    const plus = await resendConfirmationAction({ outcome: "idle", message: null }, form({ email: "d+1@example.com" }));
    expect(plus.outcome).toBe("wait");
    expect(resendMock).toHaveBeenCalledTimes(1);
  });

  it("batas per IP: maksimal 6 per jam untuk alamat berbeda", async () => {
    for (let i = 0; i < 6; i++) {
      const r = await resendConfirmationAction({ outcome: "idle", message: null }, form({ email: `u${i}@example.com` }));
      expect(r.outcome).toBe("sent");
    }
    const blocked = await resendConfirmationAction({ outcome: "idle", message: null }, form({ email: "u7@example.com" }));
    expect(blocked.outcome).toBe("wait");
    expect(resendMock).toHaveBeenCalledTimes(6);
  });

  it("429 dari Supabase = tunggu; gagal transport = tidak pasti; email salah format ditolak sebelum memanggil Supabase", async () => {
    resendMock.mockResolvedValue({ error: { status: 429, code: "over_email_send_rate_limit" } });
    expect((await resendConfirmationAction({ outcome: "idle", message: null }, form({ email: "e@example.com" }))).outcome).toBe("wait");

    resendMock.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: 0 } });
    const uncertain = await resendConfirmationAction({ outcome: "idle", message: null }, form({ email: "f@example.com" }));
    expect(uncertain.outcome).toBe("uncertain");
    expect(uncertain.sentAt).toBeTypeOf("number");

    resendMock.mockClear();
    const bad = await resendConfirmationAction({ outcome: "idle", message: null }, form({ email: "bukan-email" }));
    expect(bad.outcome).toBe("error");
    expect(resendMock).not.toHaveBeenCalled();
  });

  it("pengguna yang sudah masuk tidak bisa meminta tautan untuk akun lain", async () => {
    getUserMock.mockResolvedValue({ data: { user: { email: "me@example.com" } } });
    const r = await resendConfirmationAction({ outcome: "idle", message: null }, form({ email: "g@example.com" }));
    expect(r.outcome).toBe("error");
    expect(resendMock).not.toHaveBeenCalled();
  });
});

describe("UI: LoginForm dan ResendConfirmation", () => {
  it("menampilkan pemberitahuan tautan kedaluwarsa/tidak berlaku dengan form kirim ulang berlabel dan target 44px", () => {
    render(<LoginForm notice="link_expired" />);
    expect(screen.getByText(CONFIRM_NOTICE_MESSAGES.link_expired)).toBeInTheDocument();
    const email = screen.getByLabelText("Email pendaftaran");
    expect(email.className).toContain("h-11");
    expect(screen.getByRole("button", { name: "Kirim ulang tautan konfirmasi" }).className).toContain("min-h-11");
  });

  it("tanpa notice dan tanpa email belum terkonfirmasi, form kirim ulang tidak tampil", () => {
    render(<LoginForm />);
    expect(screen.queryByLabelText("Email pendaftaran")).toBeNull();
  });

  it("setelah permintaan diterima, tombol memulai hitung mundur dan pesan seragam muncul di region status", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ResendConfirmation defaultEmail="h@example.com" />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Kirim ulang tautan konfirmasi" }));
      });
      expect(screen.getByText(RESEND_CONFIRMATION_MESSAGES.sent)).toBeInTheDocument();
      const cooling = screen.getByRole("button", { name: /Kirim ulang tautan \(\d+ dtk\)/ });
      expect(cooling).toBeDisabled();
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByRole("button", { name: "Kirim ulang tautan konfirmasi" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});

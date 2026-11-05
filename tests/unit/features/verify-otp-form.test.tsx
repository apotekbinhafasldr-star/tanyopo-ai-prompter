import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

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

const { signUpMock, getUserMock, verifyOtpMock, resendMock } = vi.hoisted(() => ({
  signUpMock: vi.fn(),
  getUserMock: vi.fn(),
  verifyOtpMock: vi.fn(),
  resendMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { signUp: signUpMock, getUser: getUserMock, verifyOtp: verifyOtpMock, resend: resendMock },
  })),
}));

import { RegisterForm } from "@/features/auth/register-form";
import { VerifyOtpForm } from "@/features/auth/verify-otp-form";
import { OTP_MESSAGES } from "@/lib/auth/email-otp";

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function fillRegister() {
  fireEvent.change(screen.getByLabelText("Nama Anda"), { target: { value: "Budi" } });
  fireEvent.change(screen.getByLabelText("Nama Bisnis"), { target: { value: "Toko Budi" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "baru@example.com" } });
  fireEvent.change(document.getElementById("password") as HTMLInputElement, { target: { value: "Rahasia-123" } });
  fireEvent.click(document.getElementById("acceptLegal") as HTMLInputElement);
}

async function submitFirstForm() {
  await act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });
}

beforeEach(() => {
  signUpMock.mockReset();
  verifyOtpMock.mockReset();
  resendMock.mockReset();
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("VerifyOtpForm — mobile-first code screen", () => {
  it("shows the address, a numeric one-time-code field, and Verifikasi / Kembali ke login", () => {
    render(<VerifyOtpForm email="baru@example.com" onChangeEmail={() => {}} />);
    expect(screen.getByTestId("otp-email").textContent).toBe("baru@example.com");
    const input = screen.getByLabelText("Kode dari email") as HTMLInputElement;
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(screen.getByRole("button", { name: "Verifikasi" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali ke login" }).getAttribute("href")).toBe("/login");
  });

  it("does not hard-code a length: no maxLength of 6 or 8 on the field", () => {
    render(<VerifyOtpForm email="baru@example.com" onChangeEmail={() => {}} />);
    const max = Number((screen.getByLabelText("Kode dari email") as HTMLInputElement).getAttribute("maxlength"));
    expect(max).toBeGreaterThan(10);
  });

  it("never says the account is verified before the server has confirmed", () => {
    render(<VerifyOtpForm email="baru@example.com" onChangeEmail={() => {}} />);
    expect(document.body.textContent).not.toMatch(/berhasil|terverifikasi|sukses/i);
  });

  it("resend is disabled during the 60 second cooldown, with a visible countdown, then enabled", () => {
    vi.useFakeTimers();
    render(<VerifyOtpForm email="baru@example.com" onChangeEmail={() => {}} />);
    const button = () => screen.getByRole("button", { name: /Kirim ulang kode/ }) as HTMLButtonElement;

    expect(button().disabled).toBe(true);
    expect(button().textContent).toContain("60");

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(button().disabled).toBe(true);
    expect(button().textContent).toContain("30");

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe("Kirim ulang kode");
  });

  it("'Salah email? Ubah' calls back so the person can return to the form", () => {
    const onChange = vi.fn();
    render(<VerifyOtpForm email="baru@example.com" onChangeEmail={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Salah email? Ubah" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("RegisterForm + real actions — flag OFF (default)", () => {
  it("a new signup still shows the existing 'Cek email Anda' card, never the code screen", async () => {
    vi.stubEnv("EMAIL_OTP_ENABLED", "");
    signUpMock.mockResolvedValue({ data: { user: { identities: [{ id: "i" }] }, session: null }, error: null });
    render(<RegisterForm />);
    fillRegister();
    await submitFirstForm();

    expect(screen.getByText("Cek email Anda")).toBeTruthy();
    expect(screen.queryByText("Masukkan kode verifikasi")).toBeNull();
  });
});

describe("RegisterForm + real actions — flag ON", () => {
  beforeEach(() => vi.stubEnv("EMAIL_OTP_ENABLED", "true"));

  it("a new signup moves to the code screen for that address, and the password is nowhere on it", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [{ id: "i" }] }, session: null }, error: null });
    render(<RegisterForm />);
    fillRegister();
    await submitFirstForm();

    expect(screen.getByText("Masukkan kode verifikasi")).toBeTruthy();
    expect(screen.getByTestId("otp-email").textContent).toBe("baru@example.com");
    expect(screen.queryByText("Cek email Anda")).toBeNull();
    expect(document.body.innerHTML).not.toContain("Rahasia-123");
    for (const input of Array.from(document.querySelectorAll("input")) as HTMLInputElement[]) {
      expect(input.value).not.toBe("Rahasia-123");
    }
  });

  it("an existing email still gets the existing-account card, never the code screen", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });
    render(<RegisterForm />);
    fillRegister();
    await submitFirstForm();

    expect(screen.getByText("Email sudah terdaftar")).toBeTruthy();
    expect(screen.queryByText("Masukkan kode verifikasi")).toBeNull();
  });

  it("'Salah email? Ubah' returns to the form with nama, bisnis and email kept and the password empty", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [{ id: "i" }] }, session: null }, error: null });
    render(<RegisterForm />);
    fillRegister();
    await submitFirstForm();
    fireEvent.click(screen.getByRole("button", { name: "Salah email? Ubah" }));

    expect(screen.getByText("Buat akun LINOE")).toBeTruthy();
    expect((screen.getByLabelText("Nama Anda") as HTMLInputElement).value).toBe("Budi");
    expect((screen.getByLabelText("Nama Bisnis") as HTMLInputElement).value).toBe("Toko Budi");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("baru@example.com");
    expect((document.getElementById("password") as HTMLInputElement).value).toBe("");
  });

  it("a wrong code shows an error and no success text; Supabase was asked once with type signup", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [{ id: "i" }] }, session: null }, error: null });
    verifyOtpMock.mockResolvedValue({ data: { session: null, user: null }, error: { status: 403, code: "otp_expired" } });
    render(<RegisterForm />);
    fillRegister();
    await submitFirstForm();

    fireEvent.change(screen.getByLabelText("Kode dari email"), { target: { value: "00000000" } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("Kode dari email").closest("form")!);
    });
    await flush();

    expect(screen.getByRole("alert").textContent).toBe(OTP_MESSAGES.wrongOrExpired);
    expect(verifyOtpMock).toHaveBeenCalledTimes(1);
    expect(verifyOtpMock).toHaveBeenCalledWith({ email: "baru@example.com", token: "00000000", type: "signup" });
    expect(document.body.textContent).not.toMatch(/berhasil|terverifikasi/i);
  });

  it("resend: a successful resend shows the neutral confirmation and restarts the cooldown", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [{ id: "i" }] }, session: null }, error: null });
    resendMock.mockResolvedValue({ data: {}, error: null });
    vi.useFakeTimers();
    render(<RegisterForm />);
    fillRegister();
    await submitFirstForm();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const button = screen.getByRole("button", { name: "Kirim ulang kode" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await act(async () => {
      fireEvent.submit(button.closest("form")!);
    });

    expect(resendMock).toHaveBeenCalledTimes(1);
    expect(resendMock).toHaveBeenCalledWith({ type: "signup", email: "baru@example.com" });
    expect(screen.getByRole("status").textContent).toBe(OTP_MESSAGES.resendSent);
    const again = screen.getByRole("button", { name: /Kirim ulang kode/ }) as HTMLButtonElement;
    expect(again.disabled).toBe(true);
    expect(again.textContent).toContain("60");
  });
});

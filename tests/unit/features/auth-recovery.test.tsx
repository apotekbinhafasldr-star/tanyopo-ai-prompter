import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
const { headersMock } = vi.hoisted(() => ({ headersMock: vi.fn() }));
vi.mock("next/headers", () => ({ headers: headersMock }));
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
import { recoveryClientKey } from "@/lib/auth/recovery-ip";
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
  headersMock.mockReset();
  headersMock.mockImplementation(async () => new Headers());
  signInMock.mockReset();
  resendMock.mockReset();
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: null } });
  resendMock.mockResolvedValue({ error: null });
});
afterEach(() => cleanup());

const idle = { outcome: "idle", message: null } as const;
const withIp = (h: Record<string, string>) => headersMock.mockImplementation(async () => new Headers(h));

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
    // bentuk respons: sama persis (selain sentAt)
    expect({ ...ok, sentAt: 0 }).toEqual({ ...missing, sentAt: 0 });
    expect({ ...ok, sentAt: 0 }).toEqual({ ...confirmed, sentAt: 0 });
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
    withIp({ "x-nf-client-connection-ip": "203.0.113.7" });
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
      const button = screen.getByRole("button", { name: "Kirim ulang tautan konfirmasi" });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveTextContent(/\(\d+ detik\)/);
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(button).not.toHaveAttribute("aria-disabled");
      expect(button).not.toHaveTextContent("detik");
      expect(screen.getByText("Anda dapat meminta tautan konfirmasi lagi.")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});


describe("recoveryClientKey (IP tepercaya, tanpa x-forwarded-for)", () => {
  const key = (h: Record<string, string>) => recoveryClientKey(new Headers(h));
  it("menerima x-nf-client-connection-ip yang valid (IPv4 dan IPv6 /64)", () => {
    expect(key({ "x-nf-client-connection-ip": " 203.0.113.7 " })).toBe("203.0.113.7");
    expect(key({ "x-nf-client-connection-ip": "2001:DB8:1:2:aaaa:bbbb:cccc:dddd" })).toBe("2001:0db8:0001:0002");
    expect(key({ "x-nf-client-connection-ip": "2001:db8::1" })).toBe("2001:0db8:0000:0000");
    expect(key({ "x-nf-client-connection-ip": "::1" })).toBe("0000:0000:0000:0000");
    expect(key({ "x-nf-client-connection-ip": "::ffff:198.51.100.9" })).toBe("198.51.100.9");
  });
  it("IPv6 dalam satu /64 berbagi kunci; /64 lain berbeda", () => {
    const a = key({ "x-nf-client-connection-ip": "2001:db8:1:2::1" });
    expect(key({ "x-nf-client-connection-ip": "2001:db8:1:2:ffff::9" })).toBe(a);
    expect(key({ "x-nf-client-connection-ip": "2001:db8:1:3::1" })).not.toBe(a);
  });
  it("nilai tidak valid, kosong, terlalu panjang, atau ber-zona jatuh ke 'unidentified'", () => {
    for (const bad of ["", "   ", "not-an-ip", "999.1.1.1", "1.2.3.4, 5.6.7.8", "fe80::1%eth0", "1".repeat(60)]) {
      expect(key({ "x-nf-client-connection-ip": bad })).toBe("unidentified");
    }
    expect(key({})).toBe("unidentified");
  });
  it("x-forwarded-for (dan header lain) tidak pernah dipakai", () => {
    expect(key({ "x-forwarded-for": "198.51.100.1" })).toBe("unidentified");
    expect(key({ "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.2", "client-ip": "198.51.100.3" })).toBe("unidentified");
    expect(key({ "x-forwarded-for": "198.51.100.1", "x-nf-client-connection-ip": "203.0.113.7" })).toBe("203.0.113.7");
  });
});

describe("resendConfirmationAction: pemalsuan XFF dan bucket unidentified", () => {
  it("XFF berputar tanpa header Netlify tetap berbagi satu bucket (tidak ada bypass 6/jam)", async () => {
    let wait = 0;
    for (let i = 0; i < 40; i++) {
      withIp({ "x-forwarded-for": `198.51.100.${i + 1}` });
      const r = await resendConfirmationAction(idle, form({ email: `x${i}@example.com` }));
      if (r.outcome === "wait") wait++;
    }
    // bucket unidentified: 30 per jam, sisanya ditolak walau XFF berbeda-beda
    expect(resendMock).toHaveBeenCalledTimes(30);
    expect(wait).toBe(10);
  });

  it("bucket unidentified memberi lebih dari 6 pengguna sah per jam (tidak memblokir berlebihan)", async () => {
    for (let i = 0; i < 7; i++) {
      const r = await resendConfirmationAction(idle, form({ email: `sah${i}@example.com` }));
      expect(r.outcome).toBe("sent");
    }
  });

  it("XFF palsu bertuliskan IP korban tidak menghabiskan jatah korban", async () => {
    for (let i = 0; i < 6; i++) {
      withIp({ "x-nf-client-connection-ip": "203.0.113.50" });
      await resendConfirmationAction(idle, form({ email: `penyerang${i}@example.com` }));
    }
    withIp({ "x-nf-client-connection-ip": "203.0.113.99", "x-forwarded-for": "203.0.113.50" });
    const victim = await resendConfirmationAction(idle, form({ email: "korban@example.com" }));
    expect(victim.outcome).toBe("sent");
  });

  it("header Netlify valid: batas 6 per jam per IP; IP lain tidak terpengaruh", async () => {
    withIp({ "x-nf-client-connection-ip": "203.0.113.7" });
    for (let i = 0; i < 6; i++) {
      expect((await resendConfirmationAction(idle, form({ email: `v${i}@example.com` }))).outcome).toBe("sent");
    }
    expect((await resendConfirmationAction(idle, form({ email: "v9@example.com" }))).outcome).toBe("wait");
    withIp({ "x-nf-client-connection-ip": "203.0.113.8" });
    expect((await resendConfirmationAction(idle, form({ email: "w1@example.com" }))).outcome).toBe("sent");
  });

  it("header Netlify tidak valid dihitung sebagai unidentified, bukan bucket sendiri", async () => {
    for (let i = 0; i < 30; i++) {
      withIp({ "x-nf-client-connection-ip": `bukan-ip-${i}` });
      await resendConfirmationAction(idle, form({ email: `inv${i}@example.com` }));
    }
    withIp({ "x-nf-client-connection-ip": "bukan-ip-baru" });
    expect((await resendConfirmationAction(idle, form({ email: "inv99@example.com" }))).outcome).toBe("wait");
    expect(resendMock).toHaveBeenCalledTimes(30);
  });
});

describe("resendConfirmationAction: error, bentuk respons, normalisasi", () => {
  it("resend melempar exception: hasil 'uncertain' terkontrol", async () => {
    resendMock.mockRejectedValue(new Error("boom"));
    const r = await resendConfirmationAction(idle, form({ email: "t1@example.com" }));
    expect(r.outcome).toBe("uncertain");
    expect(r.message).toBe(RESEND_CONFIRMATION_MESSAGES.uncertain);
  });

  it("getUser melempar exception: tidak crash, lanjut sebagai belum masuk", async () => {
    getUserMock.mockRejectedValue(new Error("auth down"));
    const r = await resendConfirmationAction(idle, form({ email: "t2@example.com" }));
    expect(r.outcome).toBe("sent");
    expect(resendMock).toHaveBeenCalledTimes(1);
  });

  it("bentuk respons dipatok untuk tiap hasil", async () => {
    const sent = await resendConfirmationAction(idle, form({ email: "s1@example.com" }));
    expect(sent).toEqual({ outcome: "sent", message: RESEND_CONFIRMATION_MESSAGES.sent, sentAt: expect.any(Number) });
    const wait = await resendConfirmationAction(idle, form({ email: "s1@example.com" }));
    expect(wait).toEqual({ outcome: "wait", message: RESEND_CONFIRMATION_MESSAGES.wait });
    const bad = await resendConfirmationAction(idle, form({ email: "" }));
    expect(bad).toEqual({ outcome: "error", message: RESEND_CONFIRMATION_MESSAGES.invalidEmail });
    resendMock.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: 0 } });
    const unsure = await resendConfirmationAction(idle, form({ email: "s2@example.com" }));
    expect(unsure).toEqual({ outcome: "uncertain", message: RESEND_CONFIRMATION_MESSAGES.uncertain, sentAt: expect.any(Number) });
  });

  it("normalisasi: spasi, huruf besar, dan banyak +tag berbagi satu cooldown", async () => {
    await resendConfirmationAction(idle, form({ email: "  Norm@Example.com  " }));
    expect(resendMock).toHaveBeenCalledWith({ type: "signup", email: "norm@example.com" });
    for (const e of ["NORM@example.com", "norm+a@example.com", "norm+a+b@example.com"]) {
      expect((await resendConfirmationAction(idle, form({ email: e }))).outcome).toBe("wait");
    }
    expect(resendMock).toHaveBeenCalledTimes(1);
  });

  it("dua pengiriman bersamaan untuk alamat yang sama: hanya satu sampai ke Supabase", async () => {
    const [a, b] = await Promise.all([
      resendConfirmationAction(idle, form({ email: "par@example.com" })),
      resendConfirmationAction(idle, form({ email: "par@example.com" })),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(["sent", "wait"]);
    expect(resendMock).toHaveBeenCalledTimes(1);
  });
});

describe("UI: fokus, aria, dan guard submit", () => {
  it("fokus tetap pada tombol saat pending dan cooldown; tombol tidak pernah disabled native", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ResendConfirmation defaultEmail="fok@example.com" />);
      const button = screen.getByRole("button", { name: "Kirim ulang tautan konfirmasi" });
      button.focus();
      expect(document.activeElement).toBe(button);
      await act(async () => {
        fireEvent.click(button);
      });
      expect(screen.getByRole("button", { name: "Kirim ulang tautan konfirmasi" })).toBe(button); // tidak di-remount
      expect(document.activeElement).toBe(button);
      expect(button).not.toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByLabelText("Email pendaftaran")).toHaveValue("fok@example.com");
    } finally {
      vi.useRealTimers();
    }
  });

  it("klik saat cooldown tidak mengirim lagi (guard submit); label tombol statis", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ResendConfirmation defaultEmail="gd@example.com" />);
      const button = screen.getByRole("button", { name: "Kirim ulang tautan konfirmasi" });
      await act(async () => {
        fireEvent.click(button);
      });
      expect(resendMock).toHaveBeenCalledTimes(1);
      let allowed = true;
      await act(async () => {
        vi.advanceTimersByTime(5_000);
        allowed = fireEvent.click(button); // false = klik dibatalkan (preventDefault) sehingga form tidak terkirim
      });
      expect(allowed).toBe(false);
      expect(resendMock).toHaveBeenCalledTimes(1);
      // nama aksesibel tidak berubah tiap detik: hitung mundur hanya visual (aria-hidden)
      expect(screen.getByRole("button", { name: "Kirim ulang tautan konfirmasi" })).toBe(button);
      expect(button.querySelector("[aria-hidden]")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("error dihubungkan ke kolom: aria-invalid dan aria-describedby", async () => {
    render(<ResendConfirmation defaultEmail="bukan-email" />);
    const input = screen.getByLabelText("Email pendaftaran");
    expect(input).not.toHaveAttribute("aria-invalid");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kirim ulang tautan konfirmasi" }));
    });
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby") as string;
    expect(document.getElementById(describedBy)).toHaveTextContent(RESEND_CONFIRMATION_MESSAGES.invalidEmail);
  });

  it("tombol boleh membungkus teks dan tinggi minimum 44px (360px / teks 150%)", () => {
    render(<ResendConfirmation />);
    const cls = screen.getByRole("button", { name: "Kirim ulang tautan konfirmasi" }).className;
    expect(cls).toContain("whitespace-normal");
    expect(cls).toContain("min-h-11");
    expect(cls).toContain("h-auto");
  });
});

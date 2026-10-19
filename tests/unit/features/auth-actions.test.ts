import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

const { signInWithPasswordMock, signUpMock, signOutMock, resetPasswordForEmailMock, getUserMock, updateUserMock } =
  vi.hoisted(() => ({
    signInWithPasswordMock: vi.fn(),
    signUpMock: vi.fn(),
    signOutMock: vi.fn(async () => ({ error: null })),
    resetPasswordForEmailMock: vi.fn(async () => ({ error: null })),
    getUserMock: vi.fn(),
    updateUserMock: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signUp: signUpMock,
      signOut: signOutMock,
      resetPasswordForEmail: resetPasswordForEmailMock,
      getUser: getUserMock,
      updateUser: updateUserMock,
    },
  })),
}));

import {
  loginAction,
  registerAction,
  forgotPasswordAction,
  resetPasswordAction,
} from "@/features/auth/actions";

function registerFormData(overrides: Partial<Record<string, string>> = {}, accept: string | null = "on") {
  const fd = new FormData();
  if (accept !== null) fd.set("acceptLegal", accept);
  fd.set("nama", overrides.nama ?? "Budi");
  fd.set("namaUsaha", overrides.namaUsaha ?? "Toko Budi");
  fd.set("email", overrides.email ?? "budi@example.com");
  fd.set("password", overrides.password ?? "password123");
  return fd;
}

describe("registerAction — B12 signup confirmation redirect", () => {
  beforeEach(() => {
    signUpMock.mockReset();
  });

  it("never sends a query-string-carrying emailRedirectTo — the production Redirect URLs entry is a single exact-match /auth/callback with no wildcard, so anything appended would silently fail to match and fall back to the Site URL instead of taking effect", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });

    await registerAction({ error: null }, registerFormData());

    expect(signUpMock).toHaveBeenCalledTimes(1);
    const callArgs = signUpMock.mock.calls[0][0];
    expect(callArgs.options.emailRedirectTo).toBeUndefined();
  });

  it("still reports the existing-account case without ever exposing the redirect/session details to the caller", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });

    const result = await registerAction({ error: null }, registerFormData());

    expect(result.existingAccount).toBe(true);
    expect(result.error).toBeNull();
  });

  it("reports 'check your email' when confirmation is required (no session issued yet)", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });

    const result = await registerAction({ error: null }, registerFormData());

    expect(result.error).toBeNull();
    expect(result.info).toMatch(/cek email/i);
  });
});

describe("registerAction — explicit Terms/Privacy acceptance (server-side)", () => {
  beforeEach(() => {
    signUpMock.mockReset();
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["false", "false"],
    ["off", "off"],
    ["1", "1"],
  ])("rejects %s acceptance without reaching Supabase Auth", async (_label, value) => {
    const result = await registerAction({ error: null }, registerFormData({}, value));

    expect(result.error).toMatch(/Syarat & Ketentuan dan Kebijakan Privasi/);
    expect(result.info).toBeUndefined();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("does not consume the register rate limit for a rejected (unaccepted) attempt", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    (checkRateLimit as ReturnType<typeof vi.fn>).mockClear();

    await registerAction({ error: null }, registerFormData({}, null));

    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("keeps the rate limit in force for an accepted signup, before signUp", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    (checkRateLimit as ReturnType<typeof vi.fn>).mockReturnValueOnce({ allowed: false });

    const result = await registerAction({ error: null }, registerFormData());

    expect(result.error).toMatch(/Terlalu banyak percobaan/);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("writes no consent flag into auth metadata (consent evidence is out of scope for this PR)", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });

    await registerAction({ error: null }, registerFormData());

    const data = signUpMock.mock.calls[0][0].options.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(["jenis_usaha", "nama", "nama_usaha"]);
  });
});

describe("forgotPasswordAction — B12 regression: redirectTo must stay the bare allow-listed URL", () => {
  beforeEach(() => {
    resetPasswordForEmailMock.mockClear();
  });

  it("never appends a query string to redirectTo (would fail Supabase's exact-match Redirect URLs check)", async () => {
    const fd = new FormData();
    fd.set("email", "budi@example.com");

    const result = await forgotPasswordAction({ error: null }, fd);

    expect(resetPasswordForEmailMock).toHaveBeenCalledWith(
      "budi@example.com",
      expect.objectContaining({ redirectTo: "http://localhost:3000/auth/callback" }),
    );
    expect(result.error).toBeNull();
  });
});

describe("resetPasswordAction — unaffected by the B12 signup redirect change", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    updateUserMock.mockReset();
  });

  it("rejects when no recovery session exists", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const fd = new FormData();
    fd.set("password", "newpassword1");
    fd.set("confirmPassword", "newpassword1");

    const result = await resetPasswordAction({ error: null }, fd);

    expect(result.error).toMatch(/kedaluwarsa/i);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("updates the password and signs out on success", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    updateUserMock.mockResolvedValue({ error: null });
    const fd = new FormData();
    fd.set("password", "newpassword1");
    fd.set("confirmPassword", "newpassword1");

    await expect(resetPasswordAction({ error: null }, fd)).rejects.toThrow("REDIRECT:/login?reset=success");
    expect(signOutMock).toHaveBeenCalled();
  });
});

describe("loginAction — unaffected by the B12 signup redirect change", () => {
  it("maps a 400 error to a wrong-credentials message", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { status: 400 } });
    const fd = new FormData();
    fd.set("email", "budi@example.com");
    fd.set("password", "wrong");

    const result = await loginAction({ error: null }, fd);

    expect(result.error).toMatch(/salah/i);
  });
});

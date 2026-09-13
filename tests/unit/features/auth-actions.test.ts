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

function registerFormData(overrides: Partial<Record<string, string>> = {}) {
  const fd = new FormData();
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

  it("sends emailRedirectTo pointing at this app's own /auth/callback with ?next=/onboarding, never a bare Supabase default", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });

    await registerAction({ error: null }, registerFormData());

    expect(signUpMock).toHaveBeenCalledTimes(1);
    const callArgs = signUpMock.mock.calls[0][0];
    expect(callArgs.options.emailRedirectTo).toBe("http://localhost:3000/auth/callback?next=/onboarding");
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

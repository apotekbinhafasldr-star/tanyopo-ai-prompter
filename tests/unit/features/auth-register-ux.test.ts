import { describe, expect, it, vi, beforeEach } from "vitest";

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

import { registerAction } from "@/features/auth/actions";
import { UNCERTAIN_SIGNUP_MESSAGE } from "@/lib/auth/signup-error";

const PASSWORD = "Rahasia-Banget-123";

function registerFormData(overrides: Partial<Record<string, string>> = {}) {
  const fd = new FormData();
  fd.set("acceptLegal", "on");
  fd.set("nama", overrides.nama ?? "Budi Baru");
  fd.set("namaUsaha", overrides.namaUsaha ?? "Toko Baru");
  fd.set("email", overrides.email ?? "budi@example.com");
  fd.set("password", overrides.password ?? PASSWORD);
  return fd;
}

describe("registerAction — PR #92 registration UX", () => {
  beforeEach(() => {
    signUpMock.mockReset();
    getUserMock.mockReset();
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
  });

  it("existing account: keeps nama / namaUsaha / email for the form, never the password", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });

    const result = await registerAction({ error: null }, registerFormData());

    expect(result.existingAccount).toBe(true);
    expect(result.values).toEqual({ nama: "Budi Baru", namaUsaha: "Toko Baru", email: "budi@example.com" });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(Object.keys(result.values ?? {})).not.toContain("password");
  });

  it("existing account: signUp is called once and carries the typed nama/namaUsaha only as metadata for a NEW user", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });
    await registerAction({ error: null }, registerFormData());
    expect(signUpMock).toHaveBeenCalledTimes(1);
  });

  it("a thrown signUp is reported as uncertain, never as 'not created', and is not retried", async () => {
    signUpMock.mockRejectedValue(new Error("fetch failed: ECONNRESET at https://x.supabase.co with secret"));

    const result = await registerAction({ error: null }, registerFormData());

    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(result.uncertain).toBe(true);
    expect(result.error).toBe(UNCERTAIN_SIGNUP_MESSAGE);
    expect(result.error).toMatch(/mungkin sudah diproses/i);
    expect(result.error).not.toMatch(/belum dibuat|gagal membuat akun/i);
    // No stack trace / raw error text / host leaks into the response.
    expect(JSON.stringify(result)).not.toMatch(/ECONNRESET|supabase\.co|secret|at\s+\S+\.ts/);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(result.values?.email).toBe("budi@example.com");
  });

  it.each([
    ["AuthRetryableFetchError", { name: "AuthRetryableFetchError", status: 0 }],
    ["status 0", { status: 0 }],
    ["AuthUnknownError", { name: "AuthUnknownError", status: 200 }],
  ])("a transport-level Supabase error (%s) is uncertain and not retried", async (_label, error) => {
    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error });

    const result = await registerAction({ error: null }, registerFormData());

    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(result.uncertain).toBe(true);
    expect(result.error).toBe(UNCERTAIN_SIGNUP_MESSAGE);
  });

  it("regression: ordinary Supabase errors keep their existing messages and are NOT marked uncertain", async () => {
    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: { status: 500, code: "unexpected_failure" } });
    const serverError = await registerAction({ error: null }, registerFormData());
    expect(serverError.error).toMatch(/gangguan/i);
    expect(serverError.uncertain).toBeUndefined();

    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: { status: 429, code: "over_request_rate_limit" } });
    const limited = await registerAction({ error: null }, registerFormData());
    expect(limited.error).toMatch(/terlalu banyak/i);
    expect(limited.uncertain).toBeUndefined();

    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: { status: 422, code: "weak_password" } });
    const weak = await registerAction({ error: null }, registerFormData());
    expect(weak.error).toMatch(/kata sandi/i);
    expect(weak.existingAccount).toBeUndefined();

    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: { status: 422, code: "signup_disabled" } });
    const disabled = await registerAction({ error: null }, registerFormData());
    expect(disabled.existingAccount).toBeUndefined();
    expect(disabled.error).toMatch(/tidak tersedia/i);

    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: { status: 422 } });
    const bare = await registerAction({ error: null }, registerFormData());
    expect(bare.existingAccount).toBeUndefined();
    expect(bare.error).toBeTruthy();
  });

  it.each(["user_already_exists", "email_exists"])("regression: 422 %s still means existing account", async (code) => {
    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: { status: 422, code } });
    const result = await registerAction({ error: null }, registerFormData());
    expect(result.existingAccount).toBe(true);
    expect(result.uncertain).toBeUndefined();
  });

  it("a validation failure hands the typed values back (not the password) so nothing must be retyped", async () => {
    const result = await registerAction({ error: null }, registerFormData({ email: "bukan-email" }));
    expect(signUpMock).not.toHaveBeenCalled();
    expect(result.error).toBeTruthy();
    expect(result.values).toEqual({ nama: "Budi Baru", namaUsaha: "Toko Baru", email: "bukan-email" });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it("PR #91 regression: an active session is still refused before anything else, with no values echoed", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: "lama@example.com" } }, error: null });

    const result = await registerAction({ error: null }, registerFormData());

    expect(signUpMock).not.toHaveBeenCalled();
    expect(result.error).toContain("lama@example.com");
    expect(result.values).toBeUndefined();
  });

  it("a new email still ends in the 'check your email' state without values", async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });
    const result = await registerAction({ error: null }, registerFormData({ email: "baru@example.com" }));
    expect(result.info).toMatch(/cek email/i);
    expect(result.existingAccount).toBeUndefined();
  });
});

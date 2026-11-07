import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function fd() {
  const f = new FormData();
  f.set("acceptLegal", "on");
  f.set("nama", "Budi");
  f.set("namaUsaha", "Toko Budi");
  f.set("email", "budi@example.com");
  f.set("password", "Rahasia-Banget-123");
  return f;
}

beforeEach(() => {
  signUpMock.mockReset();
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("registerAction result shape by flag", () => {
  it("OFF: new signup -> info only (link flow), existing -> no otpAvailable", async () => {
    vi.stubEnv("EMAIL_OTP_ENABLED", "");
    signUpMock.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });
    const created = await registerAction({ error: null }, fd());
    expect(created.verifyEmail).toBeUndefined();
    expect(created.info).toMatch(/cek email/i);

    signUpMock.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });
    const existing = await registerAction({ error: null }, fd());
    expect(existing.existingAccount).toBe(true);
    expect(existing.otpAvailable).toBeUndefined();
  });

  it("ON: new signup -> verifyEmail; existing -> existingAccount + otpAvailable (still no verifyEmail)", async () => {
    vi.stubEnv("EMAIL_OTP_ENABLED", "true");
    signUpMock.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });
    const created = await registerAction({ error: null }, fd());
    expect(created.verifyEmail).toBe("budi@example.com");
    expect(created.info).toBeUndefined();

    signUpMock.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });
    const existing = await registerAction({ error: null }, fd());
    expect(existing.existingAccount).toBe(true);
    expect(existing.otpAvailable).toBe(true);
    expect(existing.verifyEmail).toBeUndefined();
  });

  it("neither result ever contains the password", async () => {
    vi.stubEnv("EMAIL_OTP_ENABLED", "true");
    signUpMock.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });
    expect(JSON.stringify(await registerAction({ error: null }, fd()))).not.toContain("Rahasia-Banget-123");
    signUpMock.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });
    expect(JSON.stringify(await registerAction({ error: null }, fd()))).not.toContain("Rahasia-Banget-123");
  });
});

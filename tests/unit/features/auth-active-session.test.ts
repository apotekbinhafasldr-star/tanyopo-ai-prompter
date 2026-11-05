import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const { checkRateLimitMock } = vi.hoisted(() => ({ checkRateLimitMock: vi.fn(() => ({ allowed: true })) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

const { signUpMock, getUserMock, signOutMock } = vi.hoisted(() => ({
  signUpMock: vi.fn(),
  getUserMock: vi.fn(),
  signOutMock: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { signUp: signUpMock, getUser: getUserMock, signOut: signOutMock },
  })),
}));

import { registerAction } from "@/features/auth/actions";

function registerFormData(email = "budi@example.com") {
  const fd = new FormData();
  fd.set("acceptLegal", "on");
  fd.set("nama", "Budi Baru");
  fd.set("namaUsaha", "Usaha Baru");
  fd.set("email", email);
  fd.set("password", "password123");
  return fd;
}

describe("registerAction — active session guard (PR-1)", () => {
  beforeEach(() => {
    signUpMock.mockReset();
    getUserMock.mockReset();
    checkRateLimitMock.mockClear();
  });

  it("refuses to register while a session is active: no signUp, no rate-limit token consumed", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: "lama@example.com" } }, error: null });

    const result = await registerAction({ error: null }, registerFormData("baru@example.com"));

    expect(signUpMock).not.toHaveBeenCalled();
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(result.error).toContain("lama@example.com");
    expect(result.error).toMatch(/keluar/i);
    expect(result.existingAccount).toBeUndefined();
    expect(result.info).toBeUndefined();
  });

  it("refuses even when the active session has no email, with a generic message", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: null } }, error: null });

    const result = await registerAction({ error: null }, registerFormData());

    expect(signUpMock).not.toHaveBeenCalled();
    expect(result.error).toMatch(/sedang masuk/i);
  });

  it("refuses an active session before it even validates the form (invalid input never reaches signUp either)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: "lama@example.com" } }, error: null });
    const result = await registerAction({ error: null }, new FormData());
    expect(signUpMock).not.toHaveBeenCalled();
    expect(result.error).toContain("lama@example.com");
  });

  it("regression: without a session, an already-registered email still gets the existing-account card state", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    signUpMock.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });

    const result = await registerAction({ error: null }, registerFormData());

    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(result.existingAccount).toBe(true);
    expect(result.error).toBeNull();
  });

  it("regression: without a session, a new email is still created and asked to confirm by email", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    signUpMock.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });

    const result = await registerAction({ error: null }, registerFormData("baru@example.com"));

    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(result.info).toMatch(/cek email/i);
  });

  it("treats a failed session lookup as 'no session' (registration stays possible; this guard is UX, not an auth boundary)", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    signUpMock.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });

    const result = await registerAction({ error: null }, registerFormData("baru@example.com"));

    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(result.error).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })), getClientIp: vi.fn(() => "127.0.0.1") }));

const { signUpMock, getUserMock, recordMock } = vi.hoisted(() => ({
  signUpMock: vi.fn(),
  getUserMock: vi.fn(async () => ({ data: { user: null } })),
  recordMock: vi.fn(async () => true),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { signUp: signUpMock, getUser: getUserMock } })),
}));
vi.mock("@/lib/consent/signup-legal", () => ({ recordSignupLegal: recordMock }));

import { registerAction } from "@/features/auth/actions";

function form(accept: string | null = "on") {
  const fd = new FormData();
  if (accept !== null) fd.set("acceptLegal", accept);
  fd.set("nama", "Budi");
  fd.set("namaUsaha", "Toko Budi");
  fd.set("email", "budi@example.com");
  fd.set("password", "password123");
  return fd;
}

describe("registerAction: pencatatan Terms/Privacy Notice sisi server (Paket 3)", () => {
  beforeEach(() => {
    signUpMock.mockReset();
    recordMock.mockReset();
    recordMock.mockResolvedValue(true);
  });

  it("akun baru tanpa sesi: mencatat sekali dengan id pengguna, lalu alur lama (cek email) tidak berubah", async () => {
    signUpMock.mockResolvedValue({ data: { user: { id: "uid-1", identities: [{}] }, session: null }, error: null });
    const result = await registerAction({ error: null }, form());
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith("uid-1");
    expect(result.error).toBeNull();
    expect(result.info).toMatch(/cek email/i);
  });

  it("akun baru dengan sesi: mencatat lalu tetap redirect ke /onboarding", async () => {
    signUpMock.mockResolvedValue({ data: { user: { id: "uid-2", identities: [{}] }, session: { access_token: "x" } }, error: null });
    await expect(registerAction({ error: null }, form())).rejects.toThrow("REDIRECT:/onboarding");
    expect(recordMock).toHaveBeenCalledWith("uid-2");
  });

  it("kegagalan pencatatan tidak memblokir pendaftaran (fail-open)", async () => {
    recordMock.mockResolvedValue(false);
    signUpMock.mockResolvedValue({ data: { user: { id: "uid-3", identities: [{}] }, session: null }, error: null });
    const result = await registerAction({ error: null }, form());
    expect(result.error).toBeNull();
    expect(result.info).toMatch(/Akun berhasil dibuat/);
  });

  it("pencatat yang melempar pun tidak boleh sampai ke pengguna lewat jalur ini (dijaga di recordSignupLegal)", async () => {
    // recordSignupLegal sendiri tidak pernah melempar (lihat consent-core.test.ts); aksi hanya menunggunya.
    recordMock.mockResolvedValue(true);
    signUpMock.mockResolvedValue({ data: { user: { id: "uid-4", identities: [{}] }, session: null }, error: null });
    await expect(registerAction({ error: null }, form())).resolves.toMatchObject({ error: null });
  });

  it("akun yang sudah ada: TIDAK mencatat (id samaran bukan milik pendaftar baru)", async () => {
    signUpMock.mockResolvedValue({ data: { user: { id: "uid-x", identities: [] }, session: null }, error: null });
    const result = await registerAction({ error: null }, form());
    expect(result.existingAccount).toBe(true);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("hasil signUp tidak pasti (exception) atau galat: TIDAK mencatat", async () => {
    signUpMock.mockRejectedValue(new Error("network"));
    expect((await registerAction({ error: null }, form())).uncertain).toBe(true);
    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: { message: "boom", status: 500 } });
    await registerAction({ error: null }, form());
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("checkbox tidak dicentang: ditolak sebelum signUp, tanpa pencatatan, pesan galat lama tidak berubah", async () => {
    const result = await registerAction({ error: null }, form(null));
    expect(result.error).toMatch(/Syarat & Ketentuan dan Kebijakan Privasi/);
    expect(signUpMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("options.data untuk handle_new_user TIDAK mendapat kunci baru", async () => {
    signUpMock.mockResolvedValue({ data: { user: { id: "uid-5", identities: [{}] }, session: null }, error: null });
    await registerAction({ error: null }, form());
    expect(Object.keys(signUpMock.mock.calls[0][0].options.data).sort()).toEqual(["jenis_usaha", "nama", "nama_usaha"]);
  });
});

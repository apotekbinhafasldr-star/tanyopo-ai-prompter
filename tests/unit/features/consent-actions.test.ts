import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, sessionMock, disconnectMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  sessionMock: vi.fn(),
  disconnectMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: rpcMock })) }));
vi.mock("@/services/session", () => ({ requireSessionContext: sessionMock }));
vi.mock("@/features/connections/actions", () => ({ disconnectAction: disconnectMock }));

import { grantConnectionConsentAction, grantOptionalConsentAction, withdrawConsentAction } from "@/features/consent/actions";
import { CONSENT_MESSAGES } from "@/lib/consent/catalog";

describe("server actions persetujuan", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: {}, error: null });
    sessionMock.mockReset();
    sessionMock.mockResolvedValue({ userId: "u1", tenantId: "t1", role: "owner" });
    disconnectMock.mockReset();
    disconnectMock.mockResolvedValue({ error: null });
  });

  it("grantOptional: kode nonaktif (v1) ditolak tanpa memanggil database", async () => {
    expect(await grantOptionalConsentAction("MARKETING_COMMS")).toEqual({ error: CONSENT_MESSAGES.saveFailed });
    expect(await grantOptionalConsentAction("CONNECT_META")).toEqual({ error: CONSENT_MESSAGES.saveFailed });
    expect(await grantOptionalConsentAction("NOPE")).toEqual({ error: CONSENT_MESSAGES.saveFailed });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("grantConnection: hanya Owner; versi tidak dikirim klien; source CONNECT_FLOW", async () => {
    sessionMock.mockResolvedValue({ userId: "u1", tenantId: "t1", role: "marketing" });
    expect(await grantConnectionConsentAction("META")).toEqual({ error: CONSENT_MESSAGES.ownerOnly });
    expect(rpcMock).not.toHaveBeenCalled();
    sessionMock.mockResolvedValue({ userId: "u1", tenantId: "t1", role: "owner" });
    expect((await grantConnectionConsentAction("META")).error).toBeNull();
    expect(rpcMock).toHaveBeenCalledWith("fn_prompter_consent_set", { p_code: "CONNECT_META", p_action: "GRANTED", p_source: "CONNECT_FLOW" });
  });

  it("grantConnection: platform X (nonaktif) ditolak", async () => {
    expect((await grantConnectionConsentAction("X")).error).toBe(CONSENT_MESSAGES.saveFailed);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("grant gagal di database = pesan galat, tanpa klaim sukses", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await grantConnectionConsentAction("META")).toEqual({ error: CONSENT_MESSAGES.saveFailed });
    rpcMock.mockRejectedValue(new Error("down"));
    expect(await grantConnectionConsentAction("META")).toEqual({ error: CONSENT_MESSAGES.saveFailed });
  });

  it("withdraw koneksi: Owner memutus koneksi dulu lalu mencatat WITHDRAWN (source SETTINGS)", async () => {
    const result = await withdrawConsentAction("CONNECT_META");
    expect(result.error).toBeNull();
    expect(disconnectMock).toHaveBeenCalledWith("META");
    expect(rpcMock).toHaveBeenCalledWith("fn_prompter_consent_set", { p_code: "CONNECT_META", p_action: "WITHDRAWN", p_source: "SETTINGS" });
    expect(disconnectMock.mock.invocationCallOrder[0]).toBeLessThan(rpcMock.mock.invocationCallOrder[0]);
  });

  it("withdraw koneksi oleh non-Owner ditolak tanpa memutus atau mencatat", async () => {
    sessionMock.mockResolvedValue({ userId: "u1", tenantId: "t1", role: "marketing" });
    expect(await withdrawConsentAction("CONNECT_META")).toEqual({ error: CONSENT_MESSAGES.ownerOnly });
    expect(disconnectMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("withdraw: bila pemutusan gagal, tidak mencatat WITHDRAWN (status tidak menyesatkan)", async () => {
    disconnectMock.mockResolvedValue({ error: "Hanya Owner yang dapat memutuskan koneksi." });
    expect((await withdrawConsentAction("CONNECT_META")).error).toBe("Hanya Owner yang dapat memutuskan koneksi.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("withdraw: koneksi terputus tetapi pencatatan gagal = pesan jujur", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await withdrawConsentAction("CONNECT_META")).toEqual({ error: CONSENT_MESSAGES.disconnectedNotRecorded });
  });

  it("withdraw kode tidak dikenal ditolak", async () => {
    expect(await withdrawConsentAction("NOPE")).toEqual({ error: CONSENT_MESSAGES.withdrawFailed });
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});

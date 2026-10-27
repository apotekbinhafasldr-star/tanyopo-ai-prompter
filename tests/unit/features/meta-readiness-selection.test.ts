import { describe, expect, it, vi } from "vitest";
import { runMetaReadinessCheck, type MetaReadinessDeps } from "@/features/connections/meta-readiness-core";
import type { MetaReadinessLookup } from "@/lib/connectors/meta-connector";

const GOOD: MetaReadinessLookup = {
  kind: "OK",
  snapshot: { accountStatus: 1, currency: "IDR", isPrepayAccount: false, hasFundingSource: true, minDailyBudgetRaw: null },
};

function makeDeps(over: Partial<MetaReadinessDeps> = {}, lookup: MetaReadinessLookup = GOOD) {
  const getAccountReadinessSnapshot = vi.fn(async (): Promise<MetaReadinessLookup> => lookup);
  const logFailure = vi.fn();
  const deps: MetaReadinessDeps = {
    loadConnection: vi.fn(async () => ({
      ok: true as const,
      connection: {
        id: "conn-A",
        status: "CONNECTED",
        external_account_id: "act_222",
        expires_at: "2099-01-01T00:00:00.000Z",
        last_refreshed_at: "2026-10-20T00:00:00.000Z",
      },
    })),
    loadEncryptedToken: vi.fn(async () => ({ ok: true as const, encrypted: "cipher" })),
    decrypt: vi.fn(() => "plain"),
    connector: { isConfigured: () => true, getAccountReadinessSnapshot },
    now: () => new Date("2026-10-28T00:00:00.000Z"),
    logFailure,
    ...over,
  };
  return { deps, getAccountReadinessSnapshot, logFailure };
}

const OWNER = { tenantId: "tenant-A", role: "owner" };

describe("readiness check for the selected ad account (F-2b)", () => {
  it("passes selectionConfirmed=true to the connector only when the Owner's confirmation is found for this tenant+connection", async () => {
    const isSelectionConfirmed = vi.fn(async () => ({ ok: true as const, confirmed: true }));
    const h = makeDeps({ isSelectionConfirmed });
    const r = await runMetaReadinessCheck(OWNER, h.deps);
    expect(r.error).toBeNull();
    expect(isSelectionConfirmed).toHaveBeenCalledWith("tenant-A", expect.objectContaining({ id: "conn-A" }));
    expect(h.getAccountReadinessSnapshot).toHaveBeenCalledWith("plain", "act_222", { selectionConfirmed: true });
    if (r.error === null) expect(r.result.state).toBe("READY");
  });

  it("is not confirmed when the marker says no, when its read fails, or when the dependency is absent", async () => {
    const no = makeDeps({ isSelectionConfirmed: vi.fn(async () => ({ ok: true as const, confirmed: false })) });
    await runMetaReadinessCheck(OWNER, no.deps);
    expect(no.getAccountReadinessSnapshot).toHaveBeenCalledWith("plain", "act_222", { selectionConfirmed: false });

    const failing = makeDeps({ isSelectionConfirmed: vi.fn(async () => ({ ok: false as const })) });
    await runMetaReadinessCheck(OWNER, failing.deps);
    expect(failing.getAccountReadinessSnapshot).toHaveBeenCalledWith("plain", "act_222", { selectionConfirmed: false });
    expect(failing.logFailure).toHaveBeenCalledWith("read_confirmation");

    const absent = makeDeps();
    await runMetaReadinessCheck(OWNER, absent.deps);
    expect(absent.getAccountReadinessSnapshot).toHaveBeenCalledWith("plain", "act_222", { selectionConfirmed: false });
  });

  it("several accounts without confirmation stay UNKNOWN with the new guidance, never READY", async () => {
    const h = makeDeps({}, { kind: "MULTIPLE" });
    const r = await runMetaReadinessCheck(OWNER, h.deps);
    if (r.error !== null) throw new Error("unexpected");
    expect(r.result.state).toBe("UNKNOWN");
    expect(r.result.unavailableReason).toBe("MULTIPLE_AD_ACCOUNTS");
  });

  it("a confirmed account that is no longer accessible is UNKNOWN (AD_ACCOUNT_MISMATCH)", async () => {
    const h = makeDeps({ isSelectionConfirmed: vi.fn(async () => ({ ok: true as const, confirmed: true })) }, { kind: "MISMATCH" });
    const r = await runMetaReadinessCheck(OWNER, h.deps);
    if (r.error !== null) throw new Error("unexpected");
    expect(r.result.state).toBe("UNKNOWN");
    expect(r.result.unavailableReason).toBe("AD_ACCOUNT_MISMATCH");
  });

  it("does not look up the confirmation for a non-owner", async () => {
    const isSelectionConfirmed = vi.fn(async () => ({ ok: true as const, confirmed: true }));
    const h = makeDeps({ isSelectionConfirmed });
    const r = await runMetaReadinessCheck({ tenantId: "tenant-A", role: "marketing" }, h.deps);
    expect(r.error).toMatch(/Owner/);
    expect(isSelectionConfirmed).not.toHaveBeenCalled();
  });
});

describe("readiness never reports for a connection that changed while Meta was being asked (F-2b consistency)", () => {
  function changingConnection(second: Record<string, unknown> | null | "error") {
    const first = {
      id: "conn-A",
      status: "CONNECTED",
      external_account_id: "act_222",
      expires_at: "2099-01-01T00:00:00.000Z",
      last_refreshed_at: "2026-10-20T00:00:00.000Z",
    };
    let calls = 0;
    return vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { ok: true as const, connection: first };
      if (second === "error") return { ok: false as const };
      return { ok: true as const, connection: second === null ? null : { ...first, ...second } };
    });
  }

  it("reports normally when nothing changed", async () => {
    const h = makeDeps({ loadConnection: changingConnection({}) });
    const r = await runMetaReadinessCheck(OWNER, h.deps);
    if (r.error !== null) throw new Error("unexpected");
    expect(r.result.state).toBe("READY");
  });

  it("drops the result (UNKNOWN, CONNECTION_CHANGED) when it was reconnected, re-selected, demoted, removed or unreadable", async () => {
    for (const change of [
      { last_refreshed_at: "2026-10-28T09:00:00.000Z" },
      { external_account_id: "act_333" },
      { status: "ACTION_REQUIRED" },
      { id: "conn-NEW" },
      null,
      "error" as const,
    ]) {
      const h = makeDeps({ loadConnection: changingConnection(change) });
      const r = await runMetaReadinessCheck(OWNER, h.deps);
      if (r.error !== null) throw new Error("unexpected");
      expect(r.result.state, JSON.stringify(change)).toBe("UNKNOWN");
      expect(r.result.unavailableReason, JSON.stringify(change)).toBe("CONNECTION_CHANGED");
      expect(r.result.checks).toEqual([]);
      expect(h.logFailure).toHaveBeenCalledWith("connection_changed");
    }
  });
});

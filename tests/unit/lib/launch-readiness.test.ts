import { describe, expect, it } from "vitest";
import {
  evaluateLaunchReadiness,
  evaluateConnection,
  evaluateAdAccountConfirmed,
  evaluateToken,
  evaluateBudget,
  evaluateApprovalThreshold,
  evaluateOwnerApproval,
  evaluateS1Gate,
  evaluateEmergencyStop,
  evaluateMetaAccountReadiness,
  READY_SUMMARY,
  type LaunchReadinessInput,
} from "@/lib/campaigns/launch-readiness";
import { evaluateMetaReadiness, unavailableMetaReadiness } from "@/lib/connectors/meta-readiness";

const NOW = new Date("2026-11-11T00:00:00.000Z");
const FUTURE = "2026-12-31T00:00:00.000Z";
const GOOD_META = evaluateMetaReadiness(
  { accountStatus: 1, currency: "IDR", isPrepayAccount: false, hasFundingSource: true, minDailyBudgetRaw: null },
  NOW,
);

const GOOD: LaunchReadinessInput = {
  now: NOW,
  connection: { ok: true, value: { status: "CONNECTED", expiresAt: FUTURE, hasAdAccount: true } },
  adAccountConfirmed: { ok: true, value: true },
  dailyBudget: 100000,
  currency: "IDR",
  approvalPolicy: { ok: true, value: { requireApprovalAbove: 500000, currency: "IDR" } },
  launchApprovals: { ok: true, value: [{ status: "APPROVED", created_at: "2026-11-10T00:00:00.000Z" }] },
  budgetWriteEnabled: true,
  emergencyStopActive: false,
  metaReadiness: GOOD_META,
};

const statusOf = (r: ReturnType<typeof evaluateLaunchReadiness>, id: string) => r.items.find((i) => i.id === id)?.status;

describe("evaluateLaunchReadiness", () => {
  it("is READY only when every item passes", () => {
    const r = evaluateLaunchReadiness(GOOD);
    expect(r.overall).toBe("READY");
    expect(r.passCount).toBe(9);
    expect(r.summary).toBe(READY_SUMMARY);
    expect(r.summary).not.toMatch(/pasti tayang|dijamin|pasti berhasil/i);
  });

  it("is NOT_READY while the S1 gate is locked (today's real state)", () => {
    const r = evaluateLaunchReadiness({ ...GOOD, budgetWriteEnabled: false });
    expect(r.overall).toBe("NOT_READY");
    expect(statusOf(r, "S1_GATE")).toBe("FAIL");
    expect(r.items.find((i) => i.id === "S1_GATE")?.detail).toContain("Terkunci");
    expect(r.summary).toContain("Belum siap");
  });

  it("fails closed when every source is unreadable", () => {
    const r = evaluateLaunchReadiness({
      now: NOW,
      connection: { ok: false },
      adAccountConfirmed: { ok: false },
      dailyBudget: undefined,
      currency: undefined,
      approvalPolicy: { ok: false },
      launchApprovals: { ok: false },
      budgetWriteEnabled: null,
      emergencyStopActive: null,
      metaReadiness: null,
    });
    expect(r.overall).toBe("NOT_READY");
    expect(r.passCount).toBe(0);
    expect(r.items.every((i) => i.status !== "PASS")).toBe(true);
  });

  it("any single non-PASS item blocks READY", () => {
    const variants: Partial<LaunchReadinessInput>[] = [
      { connection: { ok: false } },
      { adAccountConfirmed: { ok: true, value: false } },
      { dailyBudget: null },
      { launchApprovals: { ok: true, value: [] } },
      { emergencyStopActive: true },
      { emergencyStopActive: null },
      { metaReadiness: null },
    ];
    for (const v of variants) {
      expect(evaluateLaunchReadiness({ ...GOOD, ...v }).overall).toBe("NOT_READY");
    }
  });

  it("counts fails and unknowns in the summary", () => {
    const r = evaluateLaunchReadiness({ ...GOOD, emergencyStopActive: true, metaReadiness: null });
    expect(r.failCount).toBe(1);
    expect(r.unknownCount).toBe(1);
    expect(r.summary).toContain("1 hal perlu diperbaiki");
    expect(r.summary).toContain("1 hal belum bisa dipastikan");
    const onlyUnknown = evaluateLaunchReadiness({ ...GOOD, metaReadiness: null });
    expect(onlyUnknown.summary).toContain("belum bisa dipastikan");
  });
});

describe("evaluateConnection", () => {
  it("PASS / FAIL / UNKNOWN", () => {
    expect(evaluateConnection({ ok: true, value: { status: "CONNECTED", expiresAt: null, hasAdAccount: true } }).status).toBe("PASS");
    expect(evaluateConnection({ ok: true, value: null }).status).toBe("FAIL");
    for (const status of ["EXPIRED", "ACTION_REQUIRED", "DISCONNECTED"]) {
      expect(evaluateConnection({ ok: true, value: { status, expiresAt: null, hasAdAccount: true } }).status).toBe("FAIL");
    }
    expect(evaluateConnection({ ok: true, value: { status: "WEIRD", expiresAt: null, hasAdAccount: true } }).status).toBe("UNKNOWN");
    expect(evaluateConnection({ ok: false }).status).toBe("UNKNOWN");
  });
});

describe("evaluateAdAccountConfirmed", () => {
  const conn = (over = {}) => ({ ok: true as const, value: { status: "CONNECTED", expiresAt: null, hasAdAccount: true, ...over } });
  it("PASS only with a connected account, a stored ad account and a confirmation", () => {
    expect(evaluateAdAccountConfirmed({ connection: conn(), adAccountConfirmed: { ok: true, value: true } }).status).toBe("PASS");
  });
  it("FAIL when unconfirmed, no ad account, or no active connection", () => {
    expect(evaluateAdAccountConfirmed({ connection: conn(), adAccountConfirmed: { ok: true, value: false } }).status).toBe("FAIL");
    expect(evaluateAdAccountConfirmed({ connection: conn({ hasAdAccount: false }), adAccountConfirmed: { ok: true, value: true } }).status).toBe("FAIL");
    expect(evaluateAdAccountConfirmed({ connection: { ok: true, value: null }, adAccountConfirmed: { ok: true, value: true } }).status).toBe("FAIL");
    expect(evaluateAdAccountConfirmed({ connection: conn({ status: "EXPIRED" }), adAccountConfirmed: { ok: true, value: true } }).status).toBe("FAIL");
  });
  it("UNKNOWN when either source is unreadable", () => {
    expect(evaluateAdAccountConfirmed({ connection: conn(), adAccountConfirmed: { ok: false } }).status).toBe("UNKNOWN");
    expect(evaluateAdAccountConfirmed({ connection: { ok: false }, adAccountConfirmed: { ok: true, value: true } }).status).toBe("UNKNOWN");
  });
});

describe("evaluateToken", () => {
  const conn = (status: string, expiresAt: string | null) => ({ ok: true as const, value: { status, expiresAt, hasAdAccount: true } });
  it("PASS when expiry is in the future", () => {
    expect(evaluateToken(conn("CONNECTED", FUTURE), NOW).status).toBe("PASS");
  });
  it("warns but passes within 7 days", () => {
    const r = evaluateToken(conn("CONNECTED", "2026-11-14T00:00:00.000Z"), NOW);
    expect(r.status).toBe("PASS");
    expect(r.detail).toContain("3 hari");
  });
  it("FAIL when expired by date, by status, or with no connection", () => {
    expect(evaluateToken(conn("CONNECTED", "2026-11-10T00:00:00.000Z"), NOW).status).toBe("FAIL");
    expect(evaluateToken(conn("CONNECTED", NOW.toISOString()), NOW).status).toBe("FAIL");
    expect(evaluateToken(conn("EXPIRED", FUTURE), NOW).status).toBe("FAIL");
    expect(evaluateToken({ ok: true, value: null }, NOW).status).toBe("FAIL");
  });
  it("UNKNOWN when expiry is missing, unparseable, or the read failed", () => {
    expect(evaluateToken(conn("CONNECTED", null), NOW).status).toBe("UNKNOWN");
    expect(evaluateToken(conn("CONNECTED", "not-a-date"), NOW).status).toBe("UNKNOWN");
    expect(evaluateToken({ ok: false }, NOW).status).toBe("UNKNOWN");
    expect(evaluateToken(conn("CONNECTED", FUTURE), new Date("invalid")).status).toBe("UNKNOWN");
  });
});

describe("evaluateBudget", () => {
  it("PASS for a positive integer IDR budget", () => {
    expect(evaluateBudget(100000, "IDR").status).toBe("PASS");
  });
  it("FAIL when empty, zero, fractional, negative or not IDR", () => {
    expect(evaluateBudget(null, "IDR").status).toBe("FAIL");
    expect(evaluateBudget(undefined, "IDR").status).toBe("FAIL");
    expect(evaluateBudget(0, "IDR").status).toBe("FAIL");
    expect(evaluateBudget(-5, "IDR").status).toBe("FAIL");
    expect(evaluateBudget(1.5, "IDR").status).toBe("FAIL");
    expect(evaluateBudget(100, "USD").status).toBe("FAIL");
  });
  it("UNKNOWN for NaN/Infinity/non-number or unreadable currency", () => {
    expect(evaluateBudget(Number.NaN, "IDR").status).toBe("UNKNOWN");
    expect(evaluateBudget(Infinity, "IDR").status).toBe("UNKNOWN");
    expect(evaluateBudget("100000", "IDR").status).toBe("UNKNOWN");
    expect(evaluateBudget(100000, null).status).toBe("UNKNOWN");
    expect(evaluateBudget(100000, "").status).toBe("UNKNOWN");
  });
});

describe("evaluateOwnerApproval", () => {
  const rows = (...r: [string, string][]) => ({ ok: true as const, value: r.map(([status, created_at]) => ({ status, created_at })) });
  it("PASS only when the LATEST approval is APPROVED", () => {
    expect(evaluateOwnerApproval(rows(["APPROVED", "2026-11-02T00:00:00Z"])).status).toBe("PASS");
    expect(evaluateOwnerApproval(rows(["APPROVED", "2026-11-01T00:00:00Z"], ["REJECTED", "2026-11-02T00:00:00Z"])).status).toBe("FAIL");
    expect(evaluateOwnerApproval(rows(["REJECTED", "2026-11-01T00:00:00Z"], ["APPROVED", "2026-11-02T00:00:00Z"])).status).toBe("PASS");
  });
  it("FAIL for none, pending, rejected, expired", () => {
    expect(evaluateOwnerApproval(rows()).status).toBe("FAIL");
    expect(evaluateOwnerApproval(rows(["PENDING", "2026-11-02T00:00:00Z"])).status).toBe("FAIL");
    expect(evaluateOwnerApproval(rows(["REJECTED", "2026-11-02T00:00:00Z"])).status).toBe("FAIL");
    expect(evaluateOwnerApproval(rows(["EXPIRED", "2026-11-02T00:00:00Z"])).status).toBe("FAIL");
  });
  it("UNKNOWN when unreadable, with an unparseable timestamp, or an unknown status", () => {
    expect(evaluateOwnerApproval({ ok: false }).status).toBe("UNKNOWN");
    expect(evaluateOwnerApproval(rows(["APPROVED", "garbage"])).status).toBe("UNKNOWN");
    expect(evaluateOwnerApproval(rows(["MYSTERY", "2026-11-02T00:00:00Z"])).status).toBe("UNKNOWN");
  });
});

describe("evaluateApprovalThreshold", () => {
  const base = {
    dailyBudget: 100000,
    currency: "IDR",
    approvalPolicy: { ok: true, value: { requireApprovalAbove: 50000, currency: "IDR" } } as LaunchReadinessInput["approvalPolicy"],
    launchApprovals: { ok: true, value: [] } as LaunchReadinessInput["launchApprovals"],
  };
  it("PASS when no policy row or no threshold is set", () => {
    expect(evaluateApprovalThreshold({ ...base, approvalPolicy: { ok: true, value: null } }).status).toBe("PASS");
    expect(evaluateApprovalThreshold({ ...base, approvalPolicy: { ok: true, value: { requireApprovalAbove: null, currency: "IDR" } } }).status).toBe("PASS");
  });
  it("PASS when budget is at or below the threshold", () => {
    expect(evaluateApprovalThreshold({ ...base, approvalPolicy: { ok: true, value: { requireApprovalAbove: 100000, currency: "IDR" } } }).status).toBe("PASS");
  });
  it("above threshold: follows the Owner approval (FAIL / PASS / UNKNOWN)", () => {
    expect(evaluateApprovalThreshold(base).status).toBe("FAIL");
    expect(
      evaluateApprovalThreshold({ ...base, launchApprovals: { ok: true, value: [{ status: "APPROVED", created_at: "2026-11-02T00:00:00Z" }] } }).status,
    ).toBe("PASS");
    expect(evaluateApprovalThreshold({ ...base, launchApprovals: { ok: false } }).status).toBe("UNKNOWN");
  });
  it("UNKNOWN when policy unreadable, budget invalid, currency differs, or threshold malformed", () => {
    expect(evaluateApprovalThreshold({ ...base, approvalPolicy: { ok: false } }).status).toBe("UNKNOWN");
    expect(evaluateApprovalThreshold({ ...base, dailyBudget: null }).status).toBe("UNKNOWN");
    expect(evaluateApprovalThreshold({ ...base, currency: "USD" }).status).toBe("UNKNOWN");
    expect(evaluateApprovalThreshold({ ...base, approvalPolicy: { ok: true, value: { requireApprovalAbove: Number.NaN, currency: "IDR" } } }).status).toBe("UNKNOWN");
    expect(evaluateApprovalThreshold({ ...base, approvalPolicy: { ok: true, value: { requireApprovalAbove: -1, currency: "IDR" } } }).status).toBe("UNKNOWN");
  });
});

describe("evaluateS1Gate", () => {
  it("shows locked honestly", () => {
    const r = evaluateS1Gate(false);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toMatch(/^Terkunci/);
  });
  it("PASS only when open; unknown is treated as locked", () => {
    expect(evaluateS1Gate(true).status).toBe("PASS");
    const u = evaluateS1Gate(null);
    expect(u.status).toBe("UNKNOWN");
    expect(u.detail).toContain("terkunci");
  });
});

describe("evaluateEmergencyStop", () => {
  it("false=PASS, true=FAIL, null=UNKNOWN", () => {
    expect(evaluateEmergencyStop(false).status).toBe("PASS");
    expect(evaluateEmergencyStop(true).status).toBe("FAIL");
    expect(evaluateEmergencyStop(null).status).toBe("UNKNOWN");
  });
});

describe("evaluateMetaAccountReadiness", () => {
  it("maps the existing readiness states and never invents one", () => {
    expect(evaluateMetaAccountReadiness(GOOD_META).status).toBe("PASS");
    const notReady = evaluateMetaReadiness(
      { accountStatus: 1, currency: "USD", isPrepayAccount: false, hasFundingSource: true, minDailyBudgetRaw: null },
      NOW,
    );
    expect(evaluateMetaAccountReadiness(notReady).status).toBe("FAIL");
    expect(evaluateMetaAccountReadiness(unavailableMetaReadiness("TOKEN_EXPIRED", NOW)).status).toBe("UNKNOWN");
    const none = evaluateMetaAccountReadiness(null);
    expect(none.status).toBe("UNKNOWN");
    expect(none.detail).toContain("tidak menghubungi Meta");
  });
});

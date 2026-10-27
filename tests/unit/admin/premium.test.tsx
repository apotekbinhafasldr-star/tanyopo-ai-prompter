import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextRequest } from "next/server";
import { permissionsOf, type AdminPrincipal, type Permission } from "@/lib/admin/permissions";

const hoisted = vi.hoisted(() => ({
  principal: null as AdminPrincipal | null,
  flag: true,
  auditOk: true,
  audits: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/finance",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/admin/flag", () => ({ isAdminCenterEnabled: () => hoisted.flag }));
vi.mock("@/services/platform-admin", () => ({
  requireAdminPage: vi.fn(async (p: Permission) => {
    if (!hoisted.principal || !hoisted.principal.permissions.has(p)) throw new Error("NEXT_NOT_FOUND");
    return hoisted.principal;
  }),
  requireAdminPermission: vi.fn(async (p: Permission) => {
    if (!hoisted.principal || !hoisted.principal.permissions.has(p)) throw new Error("FORBIDDEN");
    return hoisted.principal;
  }),
  canSeeAdminCenterLink: vi.fn(async () => false),
}));
vi.mock("@/services/admin-audit", () => ({
  recordAdminAudit: vi.fn(async (e: unknown) => {
    hoisted.audits.push(e);
    return hoisted.auditOk;
  }),
}));

import { TrendChart } from "@/features/admin/premium/charts";
import { FinanceDashboard } from "@/features/admin/premium/dashboard";
import FinanceError from "@/app/admin/finance/error";
import Loading from "@/app/admin/finance/loading";
import AdminReportsPage from "@/app/admin/finance/reports/page";
import { POST } from "@/app/admin/finance/tax/coretax-package/route";
import { buildDashboardModel, trendOf } from "@/lib/admin/dashboard-model";
import { buildDemoAccounting, DEMO_MONTHS, DEMO_TODAY } from "@/lib/admin/demo-accounting";
import { parseFinanceFilters, parseReportTab } from "@/lib/admin/filters";
import { money } from "@/lib/finance";

const as = (role: "SUPER_ADMIN" | "STAFF", permissions: string[] = []) => {
  hoisted.principal = { userId: "actor", role, permissions: permissionsOf({ role, permissions }) };
};
const model = (period = "2026-11", status = "ALL") => {
  const d = buildDemoAccounting();
  return buildDashboardModel({
    snapshot: d.snapshot, ledger: d.ledger, filters: parseFinanceFilters({ period, status }, DEMO_MONTHS),
    monthKeys: DEMO_MONTHS, yearStart: "2026-01-01", today: DEMO_TODAY, lateAfterDays: 3, demo: true,
  });
};

beforeEach(() => {
  hoisted.principal = null;
  hoisted.flag = true;
  hoisted.auditOk = true;
  hoisted.audits = [];
});
afterEach(() => cleanup());

describe("filters are validated", () => {
  it("falls back to the latest month / ALL for anything off the allow-list", () => {
    expect(parseFinanceFilters({ period: "2099-01", status: "x" }, DEMO_MONTHS)).toEqual({ period: "2026-11", status: "ALL" });
    expect(parseFinanceFilters({ period: "ytd", status: "SETTLED" }, DEMO_MONTHS)).toEqual({ period: "ytd", status: "SETTLED" });
    expect(parseFinanceFilters({ period: ["2026-10", "x"] }, DEMO_MONTHS).period).toBe("2026-10");
    expect(parseReportTab({ r: "../../etc" })).toBe("laba-rugi");
    expect(parseReportTab({ r: "neraca" })).toBe("neraca");
  });
});

describe("KPI trend uses exact integer math", () => {
  const m = (n: string) => money(n, "IDR");
  it("computes percent change with one decimal and handles zero/new", () => {
    expect(trendOf(m("115"), m("100"))).toEqual({ kind: "UP", text: "+15,0%" });
    expect(trendOf(m("90"), m("100"))).toEqual({ kind: "DOWN", text: "-10,0%" });
    expect(trendOf(m("100"), m("100"))).toEqual({ kind: "FLAT" });
    expect(trendOf(m("5"), m("0"))).toEqual({ kind: "NEW" });
    expect(trendOf(m("5"), null)).toEqual({ kind: "NONE" });
    expect(trendOf(m("-50"), m("-100"))).toEqual({ kind: "UP", text: "+50,0%" });
  });
  it("year-to-date has no month-over-month trend", () => {
    expect(model("ytd").kpis.every((k) => k.trend.kind === "NONE")).toBe(true);
    expect(model("2026-11").kpis.find((k) => k.id === "revenue")?.trend.kind).not.toBe("NONE");
  });
});

describe("dashboard model", () => {
  it("passes only strings and plain numbers (nothing a client cannot receive)", () => {
    expect(() => JSON.stringify(model())).not.toThrow();
  });
  it("status filter narrows the transaction list and the counts stay stable", () => {
    const all = model("2026-11", "ALL");
    const refunded = model("2026-11", "REFUNDED");
    expect(refunded.transactions.length).toBeLessThan(all.transactions.length);
    expect(refunded.transactions.every((t) => t.status === "REFUNDED")).toBe(true);
    expect(refunded.statusCounts.ALL).toBe(all.statusCounts.ALL);
  });
  it("automatic checks pass for the demo ledger except the real anomalies", () => {
    const checks = model().checks;
    expect(checks.find((c) => c.label === "Neraca seimbang")?.ok).toBe(true);
    expect(checks.find((c) => c.label.startsWith("Arus kas"))?.ok).toBe(true);
    expect(checks.find((c) => c.label.startsWith("Pendapatan di muka"))?.ok).toBe(true);
    expect(checks.find((c) => c.label.startsWith("Tanpa anomali"))?.ok).toBe(false);
  });
});

describe("premium dashboard rendering", () => {
  it("shows the DEMO label, KPI cards, months and an empty state for a filter with no rows", () => {
    render(<FinanceDashboard model={model("2026-10", "UNSETTLED")} />);
    expect(screen.getByTestId("demo-banner")).toHaveTextContent("DEMO");
    expect(screen.getByTestId("kpi-revenue")).toBeInTheDocument();
    expect(screen.getByTestId("empty-state")).toHaveTextContent("Tidak ada transaksi");
  });
  it("period and status chips are real links and mark the current one", () => {
    render(<FinanceDashboard model={model("2026-10", "SETTLED")} />);
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "true");
    expect(current.map((l) => l.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Oktober 2026"), expect.stringContaining("Sudah cair")]));
    expect(screen.getByRole("link", { name: /Tahun berjalan/ })).toHaveAttribute("href", "/admin/finance?period=ytd&status=SETTLED");
  });
  it("loading state is announced and the error boundary never leaks the message", () => {
    const { unmount } = render(<Loading />);
    expect(screen.getByRole("status", { name: /Memuat/ })).toBeInTheDocument();
    unmount();
    const reset = vi.fn();
    render(<FinanceError error={Object.assign(new Error("SELECT * FROM secret_table password=hunter2"), { digest: "d" })} reset={reset} />);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/hunter2|secret_table|SELECT/);
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(reset).toHaveBeenCalled();
  });
});

describe("interactive chart", () => {
  it("tapping a month shows its exact figures; switching mode shows cash", () => {
    const m = model();
    render(<TrendChart points={m.months} initialKey="2026-11" />);
    const tip = screen.getByTestId("chart-tip");
    expect(tip).toHaveTextContent("November 2026");
    fireEvent.click(screen.getByRole("button", { name: "Sep" }));
    expect(tip).toHaveTextContent("September 2026");
    expect(tip).toHaveTextContent(m.months[0].revenue.text);
    fireEvent.click(screen.getByRole("button", { name: "Saldo kas" }));
    expect(tip).toHaveTextContent("Kas akhir");
    expect(tip).toHaveTextContent(m.months[0].cash.text);
    expect(screen.getByRole("button", { name: "Saldo kas" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("accounting reports page", () => {
  it("renders every tab without error and keeps journals read-only", async () => {
    as("SUPER_ADMIN");
    for (const r of ["jurnal", "buku-besar", "neraca-saldo", "laba-rugi", "neraca", "arus-kas", "piutang-utang", "bank"]) {
      const { container, unmount } = render(await AdminReportsPage({ searchParams: Promise.resolve({ r }) }));
      expect(container.querySelectorAll("form, input, textarea, select")).toHaveLength(0);
      expect(screen.getByTestId("demo-banner")).toBeInTheDocument();
      unmount();
    }
  });
  it("balance sheet and trial balance state their checks; bank reconciliation is NOT final", async () => {
    as("SUPER_ADMIN");
    const a = render(await AdminReportsPage({ searchParams: Promise.resolve({ r: "neraca" }) }));
    expect(screen.getByText("Aset = Liabilitas + Ekuitas")).toBeInTheDocument();
    a.unmount();
    render(await AdminReportsPage({ searchParams: Promise.resolve({ r: "bank" }) }));
    expect(screen.getByText("Rekonsiliasi disahkan manusia")).toBeInTheDocument();
    expect(screen.getByText(/Belum final/)).toBeInTheDocument();
  });
  it("is closed to a staff member without accounting.view", async () => {
    as("STAFF", ["finance.view"]);
    await expect(AdminReportsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("Coretax package route (server-side checks, no bypass)", () => {
  const req = (origin: string | null = "http://localhost", method = "POST") =>
    new NextRequest("http://localhost/admin/finance/tax/coretax-package", { method, headers: origin ? { origin } : {} });

  it("404 when the Admin Center flag is off, even for the Founder", async () => {
    as("SUPER_ADMIN");
    hoisted.flag = false;
    expect((await POST(req())).status).toBe(404);
    expect(hoisted.audits).toHaveLength(0);
  });
  it("404 without tax.export (staff, viewer, signed-out) and nothing is audited or built", async () => {
    hoisted.principal = null;
    expect((await POST(req())).status).toBe(404);
    as("STAFF", ["finance.view", "tax.view", "accounting.view"]);
    expect((await POST(req())).status).toBe(404);
    as("STAFF", ["tax.export"]);
    expect((await POST(req())).status).toBe(404); // also needs accounting.view
    expect(hoisted.audits).toHaveLength(0);
  });
  it("404 for a cross-site or origin-less request", async () => {
    as("SUPER_ADMIN");
    expect((await POST(req("https://evil.example"))).status).toBe(404);
    expect((await POST(req(null))).status).toBe(404);
  });
  it("authorised: returns a no-store ZIP, labelled DEMO, and audits the action", async () => {
    as("SUPER_ADMIN");
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Disposition")).toContain("DEMO");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    expect(hoisted.audits).toHaveLength(1);
    expect(JSON.stringify(hoisted.audits[0])).toContain("coretax_package.prepare");
  });
  it("a staff member granted tax.export + accounting.view may prepare it", async () => {
    as("STAFF", ["tax.export", "accounting.view"]);
    expect((await POST(req())).status).toBe(200);
  });
  it("only POST is exported", async () => {
    const mod = (await import("@/app/admin/finance/tax/coretax-package/route")) as Record<string, unknown>;
    for (const m of ["GET", "PUT", "PATCH", "DELETE"]) expect(mod[m]).toBeUndefined();
  });
});

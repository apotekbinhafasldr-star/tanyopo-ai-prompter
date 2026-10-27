import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { permissionsOf, type AdminPrincipal, type Permission, type PlatformRole } from "@/lib/admin/permissions";

const hoisted = vi.hoisted(() => ({ principal: null as AdminPrincipal | null, calls: [] as string[] }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/finance/tax/guide",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/services/platform-admin", () => ({
  requireAdminPage: vi.fn(async (permission: Permission) => {
    hoisted.calls.push(permission);
    if (!hoisted.principal || !hoisted.principal.permissions.has(permission)) throw new Error("NEXT_NOT_FOUND");
    return hoisted.principal;
  }),
  canSeeAdminCenterLink: vi.fn(async () => false),
}));

import AdminTaxGuidePage from "@/app/admin/finance/tax/guide/page";

const SP = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });
const visibleText = (el: HTMLElement): string => {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("style").forEach((n) => n.remove());
  return clone.textContent ?? "";
};
function as(role: PlatformRole, permissions: string[] = []) {
  hoisted.principal = { userId: "actor", role, permissions: permissionsOf({ role, permissions }) };
}
const next = () => fireEvent.click(screen.getByRole("button", { name: "Lanjut" }));
const goTo = (n: number) => {
  for (let i = 1; i < n; i += 1) next();
};

beforeEach(() => {
  hoisted.principal = null;
  hoisted.calls = [];
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => cleanup());

describe("guide page — server gate", () => {
  it("is a 404 without a principal or without the tax permission, and checks tax.view on the server", async () => {
    await expect(AdminTaxGuidePage(SP())).rejects.toThrow("NEXT_NOT_FOUND");
    as("STAFF", ["finance.view"]);
    await expect(AdminTaxGuidePage(SP())).rejects.toThrow("NEXT_NOT_FOUND");
    as("STAFF", ["tax.view"]);
    await AdminTaxGuidePage(SP());
    expect(hoisted.calls.every((c) => c === "tax.view")).toBe(true);
    expect(hoisted.calls.length).toBe(3);
  });
});

describe("guide page — choosing the return", () => {
  it("offers the three types and does not assume every return is mandatory", async () => {
    as("SUPER_ADMIN");
    render(await AdminTaxGuidePage(SP()));
    expect(screen.getByTestId("kind-pph-badan")).toHaveTextContent("SPT Tahunan PPh Badan");
    expect(screen.getByTestId("kind-ppn")).toHaveTextContent("Hanya jika PT sudah dikukuhkan sebagai PKP");
    expect(screen.getByTestId("kind-lainnya")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("kind-lainnya")).toHaveTextContent("Belum ada yang terverifikasi");
    expect(screen.queryByTestId("guide-wizard")).not.toBeInTheDocument();
    expect(screen.getByTestId("demo-banner")).toBeInTheDocument();
  });

  it("ignores an unknown or hostile type and falls back to the chooser", async () => {
    as("SUPER_ADMIN");
    const { container } = render(await AdminTaxGuidePage(SP({ jenis: "<script>", tahun: "1999" })));
    expect(container.innerHTML).not.toContain("<script>");
    expect(screen.queryByTestId("guide-wizard")).not.toBeInTheDocument();
  });

  it("'lainnya' shows an empty state, not a wizard", async () => {
    as("SUPER_ADMIN");
    render(await AdminTaxGuidePage(SP({ jenis: "lainnya" })));
    expect(screen.getByTestId("empty-state")).toHaveTextContent("Belum ada kewajiban lain yang terverifikasi");
    expect(screen.queryByTestId("guide-wizard")).not.toBeInTheDocument();
  });
});

describe("guide wizard — PPh Badan", () => {
  it("shows BELUM SIAP LAPOR with reasons while the data is demo/incomplete, and never the whole PT", async () => {
    as("SUPER_ADMIN");
    render(await AdminTaxGuidePage(SP({ jenis: "pph-badan" })));
    const r = screen.getByTestId("readiness");
    expect(r).toHaveTextContent("BELUM SIAP LAPOR");
    expect(r).not.toHaveTextContent(/^SIAP LAPOR/);
    expect(r).toHaveTextContent("Data masih DEMO");
    expect(r).toHaveTextContent("hanya satu segmen");
    expect(r).toHaveTextContent("Tarif pajak badan belum dikonfigurasi");
    expect(screen.getByTestId("demo-banner")).toBeInTheDocument();
  });

  it("walks 15 steps with progress, Sebelumnya/Lanjut and a per-step explanation", async () => {
    as("SUPER_ADMIN");
    render(await AdminTaxGuidePage(SP({ jenis: "pph-badan" })));
    expect(screen.getByText("Langkah 1 dari 15")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sebelumnya" })).toBeDisabled();
    expect(screen.getByTestId("guide-progress")).toHaveAttribute("aria-valuenow", "0");
    const boxes = within(screen.getByTestId("guide-wizard")).getAllByRole("checkbox");
    boxes.forEach((b) => fireEvent.click(b));
    expect(screen.getByTestId("guide-progress")).toHaveAttribute("aria-valuenow", "7");
    next();
    expect(screen.getByText("Langkah 2 dari 15")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sebelumnya" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Sebelumnya" }));
    expect(screen.getByText("Langkah 1 dari 15")).toBeInTheDocument();
    goTo(15);
    expect(screen.getByText("Langkah 15 dari 15")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lanjut" })).toBeDisabled();
  });

  it("?langkah= opens that step and is clamped to the real range", async () => {
    as("SUPER_ADMIN");
    render(await AdminTaxGuidePage(SP({ jenis: "pph-badan", langkah: "8" })));
    expect(screen.getByText("Langkah 8 dari 15")).toBeInTheDocument();
    cleanup();
    render(await AdminTaxGuidePage(SP({ jenis: "pph-badan", langkah: "99" })));
    expect(screen.getByText("Langkah 15 dari 15")).toBeInTheDocument();
  });

  it("the blockers of a step appear on that step", async () => {
    as("SUPER_ADMIN");
    render(await AdminTaxGuidePage(SP({ jenis: "pph-badan" })));
    goTo(3);
    expect(screen.getByTestId("step-blockers")).toHaveTextContent("selain LINOE");
  });

  it("the package step only enables the existing server route for people with export permission", async () => {
    as("STAFF", ["tax.view"]);
    const a = render(await AdminTaxGuidePage(SP({ jenis: "pph-badan" })));
    goTo(8);
    expect(screen.getByTestId("guide-package-button")).toBeDisabled();
    expect(screen.getByTestId("guide-package-button").closest("form")).toHaveAttribute("action", "/admin/finance/tax/coretax-package");
    a.unmount();
    as("SUPER_ADMIN");
    render(await AdminTaxGuidePage(SP({ jenis: "pph-badan" })));
    goTo(8);
    expect(screen.getByTestId("guide-package-button")).toBeEnabled();
    expect(screen.getByTestId("guide-package-button").closest("form")).toHaveAttribute("method", "post");
  });

  it("completing the checklist is not proof: marking done needs both official proofs and says so", async () => {
    as("SUPER_ADMIN");
    render(await AdminTaxGuidePage(SP({ jenis: "pph-badan" })));
    goTo(15);
    const done = screen.getByTestId("mark-done");
    expect(done).toBeDisabled();
    const [a, b] = within(screen.getByTestId("final-proof")).getAllByRole("checkbox");
    fireEvent.click(a);
    expect(done).toBeDisabled();
    fireEvent.click(b);
    expect(done).toBeEnabled();
    fireEvent.click(done);
    expect(done).toHaveTextContent("Sudah ditandai (catatan lokal)");
    expect(screen.getByTestId("step-warning")).toHaveTextContent("bukan bukti pelaporan");
    // Un-ticking a proof removes the mark again.
    fireEvent.click(a);
    expect(screen.getByTestId("mark-done")).toBeDisabled();
  });

  it("keeps only booleans in this browser, never anything typed", async () => {
    as("SUPER_ADMIN");
    render(await AdminTaxGuidePage(SP({ jenis: "pph-badan" })));
    fireEvent.click(within(screen.getByTestId("guide-wizard")).getAllByRole("checkbox")[0]);
    const keys = Object.keys(window.localStorage).filter((k) => k.startsWith("linoe-tax-guide:"));
    expect(keys.length).toBe(1);
    const saved = JSON.parse(window.localStorage.getItem(keys[0]) as string) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(["done", "index", "proofBpe", "proofStatus", "ticks"]);
    expect(Object.values(saved.ticks as Record<string, unknown>).every((v) => typeof v === "boolean")).toBe(true);
  });
});

describe("guide wizard — PPN", () => {
  it("has 12 steps and does not assume the company is PKP", async () => {
    as("SUPER_ADMIN");
    render(await AdminTaxGuidePage(SP({ jenis: "ppn" })));
    expect(screen.getByText("Langkah 1 dari 12")).toBeInTheDocument();
    expect(screen.getByTestId("ppn-applicability")).toHaveTextContent("Status PKP belum diverifikasi");
    expect(screen.getByTestId("readiness")).toHaveTextContent("Status PKP belum diverifikasi");
    goTo(10);
    expect(screen.getByTestId("step-warning")).toHaveTextContent("belum terverifikasi");
  });
});

describe("guide — security and sources", () => {
  it("has no password/OTP/text input anywhere and never asks for a credential", async () => {
    as("SUPER_ADMIN");
    for (const q of [{}, { jenis: "pph-badan" }, { jenis: "ppn" }] as Array<Record<string, string>>) {
      const { container, unmount } = render(await AdminTaxGuidePage(SP(q)));
      expect(container.querySelectorAll('input[type="password"], input[type="text"], input[type="email"], textarea, [autocomplete="one-time-code"]').length).toBe(0);
      expect(visibleText(container)).toContain("tidak meminta atau menyimpan kata sandi, OTP, atau kode otorisasi");
      unmount();
    }
  });

  it("cites official DJP pages with dates, opens them safely and shows no amounts", async () => {
    as("SUPER_ADMIN");
    const { container } = render(await AdminTaxGuidePage(SP({ jenis: "pph-badan" })));
    const text = visibleText(container);
    expect(text).toContain("Sumber panduan resmi DJP");
    expect(text).toContain("dibaca 2026-10-27");
    expect(text).not.toMatch(/Rp\s?\d/);
    const external = Array.from(container.querySelectorAll("a[target=_blank]"));
    expect(external.length).toBeGreaterThan(0);
    for (const a of external) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("href")).toMatch(/^https:\/\/(www\.)?(pajak\.go\.id|coretaxdjp\.pajak\.go\.id)/);
    }
  });
});

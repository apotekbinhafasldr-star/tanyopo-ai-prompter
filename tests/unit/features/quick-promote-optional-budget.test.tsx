import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/features/promote/actions", () => ({
  generateQuickCampaignDraftAction: vi.fn(async () => ({ error: null })),
}));
// The real destination picker has its own tests; here it only reports validity.
vi.mock("@/features/promote/purchase-destination-field", () => ({
  PurchaseDestinationField: ({ onValidityChange }: { onValidityChange: (ok: boolean) => void }) => (
    <button type="button" onClick={() => onValidityChange(true)}>
      destinasi-valid
    </button>
  ),
}));

import { QuickPromoteWizard } from "@/features/promote/quick-promote-wizard";
import { allocateDailyBudget } from "@/lib/campaigns/budget-allocation";
import { primaryGoals } from "@/schemas/onboarding";

afterEach(cleanup);

const products = [
  { id: "550e8400-e29b-41d4-a716-446655440000", name: "Kopi Robusta", product_type: "PHYSICAL_PRODUCT", price: 25000, currency: "IDR" },
];

function toStep2() {
  const view = render(<QuickPromoteWizard products={products} />);
  fireEvent.click(screen.getByRole("button", { name: /Kopi Robusta/ }));
  fireEvent.click(screen.getByRole("button", { name: /Lanjut/ }));
  return view;
}

const submitButton = () => screen.getByRole("button", { name: /Buat Strategi dengan AI/ });
const hidden = (container: HTMLElement, name: string) =>
  (container.querySelector(`input[type="hidden"][name="${name}"]`) as HTMLInputElement).value;

function pickObjectiveAndDestination() {
  fireEvent.click(screen.getByRole("button", { name: primaryGoals[0].label }));
  fireEvent.click(screen.getByRole("button", { name: "destinasi-valid" }));
}

describe("Quick Promote — budget is optional for creating an AI strategy", () => {
  it("regression: with an EMPTY budget the submit button is enabled once objective + destination are set", () => {
    toStep2();
    expect(submitButton()).toBeDisabled(); // objective + destination still missing
    pickObjectiveAndDestination();
    expect((screen.getByLabelText(/Berapa budget promosi ini/) as HTMLInputElement).value).toBe("");
    expect(submitButton()).toBeEnabled();
  });

  it("budget is not what gates the button: objective and destination still are", () => {
    toStep2();
    fireEvent.click(screen.getByRole("button", { name: primaryGoals[0].label }));
    expect(submitButton()).toBeDisabled(); // no destination yet
    fireEvent.click(screen.getByRole("button", { name: "destinasi-valid" }));
    expect(submitButton()).toBeEnabled();
  });

  it("a valid budget (50000) keeps it enabled and is submitted as before", () => {
    const { container } = toStep2();
    pickObjectiveAndDestination();
    fireEvent.change(screen.getByLabelText(/Berapa budget promosi ini/), { target: { value: "50000" } });
    expect(submitButton()).toBeEnabled();
    expect(hidden(container, "dailyBudget")).toBe("50000");
    expect(hidden(container, "totalBudget")).toBe("");
  });

  it("an empty budget is submitted as empty strings (server treats them as not set)", () => {
    const { container } = toStep2();
    pickObjectiveAndDestination();
    expect(hidden(container, "dailyBudget")).toBe("");
    expect(hidden(container, "totalBudget")).toBe("");
  });

  it("a negative budget is still rejected: button disabled and field marked invalid", () => {
    toStep2();
    pickObjectiveAndDestination();
    const daily = screen.getByLabelText(/Berapa budget promosi ini/);
    fireEvent.change(daily, { target: { value: "-5" } });
    expect(submitButton()).toBeDisabled();
    expect(daily).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(daily, { target: { value: "" } });
    expect(submitButton()).toBeEnabled();
    expect(daily).not.toHaveAttribute("aria-invalid");
  });

  it("tells the user that budget is optional but required for a paid launch (accessible description)", () => {
    toStep2();
    expect(screen.getByLabelText(/Berapa budget promosi ini\? \(opsional\)/)).toBeInTheDocument();
    const hint = screen.getByText(/Budget wajib diisi sebelum meluncurkan iklan berbayar/);
    expect(hint).toHaveAttribute("id", "budget-hint");
    expect(screen.getByLabelText(/Berapa budget promosi ini/)).toHaveAttribute("aria-describedby", "budget-hint");
    expect(screen.getByLabelText("Budget total (IDR)")).toHaveAttribute("aria-describedby", "budget-hint");
  });
});

describe("paid launch still requires a daily budget (unchanged gate)", () => {
  const rows = [{ id: "c1", channel: "FACEBOOK" as const, budgetPercentage: 100 }];

  it.each([null, 0, -1, Number.NaN])("allocateDailyBudget rejects daily budget %s before any ad is created", (value) => {
    const result = allocateDailyBudget(value as number | null, rows);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DAILY_BUDGET_INVALID");
      expect(result.error).toMatch(/Isi budget per hari/);
    }
  });

  it("accepts a positive integer daily budget", () => {
    expect(allocateDailyBudget(50000, rows).ok).toBe(true);
  });
});

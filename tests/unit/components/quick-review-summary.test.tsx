import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuickReviewSummary, describeBudget, type QuickReviewSummaryProps } from "@/features/campaigns/quick-review-summary";

const base: QuickReviewSummaryProps = {
  objective: "INCREASE_SALES",
  dailyBudget: 50000,
  totalBudget: null,
  currency: "IDR",
  allocation: [
    { channel: "INSTAGRAM", percentage: 60 },
    { channel: "TIKTOK", percentage: 40 },
  ],
  fallbackChannels: ["INSTAGRAM", "TIKTOK"],
  headline: "Kopi segar tiap pagi",
  primaryText: "Nikmati kopi pilihan, diantar ke rumah.",
  cta: "Pesan Sekarang",
  schedule: [
    { channel: "INSTAGRAM", label: "Sel, 19:00", scheduled: false },
    { channel: "TIKTOK", label: null, scheduled: false },
  ],
  changeBudgetHref: "/promote?product=p1",
  action: <button type="button">Setujui &amp; Siapkan Campaign</button>,
};

describe("describeBudget", () => {
  it("prefers the daily budget and mentions the total as a limit when both exist", () => {
    const result = describeBudget(50000, 1000000, "IDR");
    expect(result.primary).toContain("per hari");
    expect(result.secondary).toContain("Batas total");
  });

  it("uses the total budget when no daily budget is set", () => {
    const result = describeBudget(null, 500000, "IDR");
    expect(result.primary).toContain("total");
    expect(result.secondary).toBeNull();
  });

  it("is honest when no budget is set", () => {
    expect(describeBudget(null, null, "IDR").primary).toBe("Belum diatur");
    expect(describeBudget(0, 0, "IDR").primary).toBe("Belum diatur");
  });
});

describe("QuickReviewSummary", () => {
  it("renders the title, anchor id, and exactly one primary CTA", () => {
    const { container } = render(<QuickReviewSummary {...base} />);
    expect(screen.getByText("Rencana Promosi Anda Siap")).toBeInTheDocument();
    expect(container.querySelector("#ringkasan-target-budget")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /Setujui & Siapkan Campaign/ })).toHaveLength(1);
  });

  it("shows channels with percentages and the main message", () => {
    render(<QuickReviewSummary {...base} />);
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("Kopi segar tiap pagi")).toBeInTheDocument();
    expect(screen.getByText("Pesan Sekarang")).toBeInTheDocument();
  });

  it("falls back to plain channel names for legacy proposals without budget_allocation", () => {
    render(<QuickReviewSummary {...base} allocation={null} />);
    expect(screen.getByText("Instagram, TikTok")).toBeInTheDocument();
    expect(screen.queryByText("60%")).toBeNull();
  });

  it("labels schedule lines as suggestions and notes flexible timing", () => {
    render(<QuickReviewSummary {...base} />);
    expect(screen.getByText(/disarankan Sel, 19:00/)).toBeInTheDocument();
    expect(screen.getByText(/waktu fleksibel/)).toBeInTheDocument();
  });

  it("links back to the budget step", () => {
    render(<QuickReviewSummary {...base} />);
    expect(screen.getByRole("link", { name: /Ubah tujuan & budget/ })).toHaveAttribute("href", "/promote?product=p1");
  });

  it("makes no result/revenue promises", () => {
    const { container } = render(<QuickReviewSummary {...base} />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/omzet|ROAS|dijamin|pasti laku|jaminan/i);
  });
});

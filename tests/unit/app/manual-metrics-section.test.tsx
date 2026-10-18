import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/features/campaigns/manual-metrics-actions", () => ({
  addManualMetricAction: vi.fn(async () => ({ error: null, success: null })),
  updateManualMetricAction: vi.fn(async () => ({ error: null, success: null })),
  deleteManualMetricAction: vi.fn(async () => ({ error: null, success: null })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => currentClient),
}));

import { ManualMetricsSection } from "@/features/campaigns/manual-metrics-section";

type Err = { code?: string; message?: string } | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentClient: any;

function client(opts: { rows?: unknown[]; rowsError?: Err; product?: unknown }) {
  return {
    from(table: string) {
      const result =
        table === "prompter_manual_ad_metrics"
          ? { data: opts.rowsError ? null : (opts.rows ?? []), error: opts.rowsError ?? null }
          : { data: opts.product ?? null, error: null };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        order: () => b,
        maybeSingle: () => Promise.resolve(result),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej),
      };
      return b;
    },
  };
}

const CC = "8f1c3a52-6a3e-4b8e-9a3b-2f7d6f6f2c11";
const day = (n: number) => ({
  id: `row-${n}`,
  channel_campaign_id: CC,
  metric_date: `2026-10-0${n}`,
  spend: 100000,
  impressions: 5000,
  clicks: 100,
  conversions: 10,
  revenue: 400000,
  currency: "IDR",
});

const base = {
  masterCampaignId: "m1",
  tenantId: "t1",
  role: "owner" as const,
  campaignCurrency: "IDR",
  productId: "p1",
  channelCampaigns: [{ id: CC, channel: "FACEBOOK" as const, external_campaign_id: null }],
};
const product = { hpp: 9500, price: 22000, currency: "IDR" };

afterEach(() => cleanup());

describe("ManualMetricsSection", () => {
  it("renders the mandatory unverified-data label, the assumption note and the disclaimer", async () => {
    currentClient = client({ rows: [day(1)], product });
    render(await ManualMetricsSection(base));
    expect(screen.getAllByText("Data input manual, belum diverifikasi platform").length).toBeGreaterThan(0);
    expect(screen.getByText(/1 konversi = 1 unit produk terjual/)).toBeInTheDocument();
    expect(screen.getByText(/bukan titik impas laba bersih/)).toBeInTheDocument();
    expect(screen.queryByText("DATA SIMULASI / DEMO")).not.toBeInTheDocument();
  });

  it("owner sees the daily form, the history and a verdict computed from the rows", async () => {
    currentClient = client({ rows: [day(1), day(2), day(3)], product });
    render(await ManualMetricsSection(base));
    expect(screen.getByRole("button", { name: /Simpan Data Harian/ })).toBeInTheDocument();
    expect(screen.getByText("2026-10-01")).toBeInTheDocument();
    expect(screen.getByText("2026-10-03")).toBeInTheDocument();
    expect(screen.getAllByText("Edit")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Hapus" })).toHaveLength(3);
    expect(screen.getByText(/Dihitung dari 3 hari yang diisi/)).toBeInTheDocument();
    expect(screen.getByText("Estimasi Break-even ROAS (berdasarkan HPP)")).toBeInTheDocument();
  });

  it("a non-writer role sees history and verdict but no form, edit or delete controls", async () => {
    currentClient = client({ rows: [day(1)], product });
    render(await ManualMetricsSection({ ...base, role: "apoteker" }));
    expect(screen.queryByRole("button", { name: /Simpan Data Harian/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hapus" })).not.toBeInTheDocument();
    expect(screen.getByText(/Hanya Owner atau Marketing/)).toBeInTheDocument();
    expect(screen.getByText("2026-10-01")).toBeInTheDocument();
  });

  it("fails closed when the table is missing: notice only, no form, no verdict", async () => {
    currentClient = client({ rowsError: { code: "42P01", message: "relation does not exist" } });
    render(await ManualMetricsSection(base));
    expect(screen.getByText(/belum aktif/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Simpan Data Harian/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Estimasi Break-even ROAS (berdasarkan HPP)")).not.toBeInTheDocument();
  });

  it("fails closed on any other read error too — never shown as an empty working state", async () => {
    currentClient = client({ rowsError: { code: "XX000", message: "boom" } });
    render(await ManualMetricsSection(base));
    expect(screen.getByText(/tidak dapat dimuat/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Simpan Data Harian/ })).not.toBeInTheDocument();
  });

  it("a channel already linked to a platform campaign gets no form and no manual verdict", async () => {
    currentClient = client({ rows: [day(1)], product });
    render(
      await ManualMetricsSection({
        ...base,
        channelCampaigns: [{ id: CC, channel: "FACEBOOK", external_campaign_id: "ext-1" }],
      }),
    );
    expect(screen.getByText(/Data platform adalah sumber utama/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Simpan Data Harian/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Estimasi Break-even ROAS (berdasarkan HPP)")).not.toBeInTheDocument();
    // Metrics are frozen once the platform owns the campaign, but stale manual rows can still be cleaned up.
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hapus" })).toBeInTheDocument();
  });

  it("renders nothing for a campaign with only non-ad (SEO) channels", async () => {
    currentClient = client({});
    const { container } = render(
      await ManualMetricsSection({
        ...base,
        channelCampaigns: [{ id: CC, channel: "SEO", external_campaign_id: null }],
      }),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("withholds the verdict and explains when the product currency differs from the campaign", async () => {
    currentClient = client({ rows: [day(1)], product: { ...product, currency: "USD" } });
    render(await ManualMetricsSection(base));
    expect(screen.getByText(/Mata uang data, campaign, dan produk tidak sama/)).toBeInTheDocument();
    expect(screen.queryByText("Estimasi Break-even ROAS (berdasarkan HPP)")).not.toBeInTheDocument();
  });

  it("warns when HPP is missing and does not show a winner", async () => {
    currentClient = client({ rows: [day(1), day(2), day(3)], product: { ...product, hpp: null } });
    render(await ManualMetricsSection(base));
    expect(screen.getByText(/HPP produk belum diisi/)).toBeInTheDocument();
    expect(screen.queryByText("Kandidat scaling")).not.toBeInTheDocument();
    expect(screen.queryByText("Kandidat pemenang awal")).not.toBeInTheDocument();
  });

  it("shows an empty-state message with no verdict when there are no rows yet", async () => {
    currentClient = client({ rows: [], product });
    render(await ManualMetricsSection(base));
    expect(screen.getByText(/Belum ada data harian/)).toBeInTheDocument();
    expect(screen.getByText(/Belum ada data. Tambahkan metrik harian/)).toBeInTheDocument();
  });

  it("is mobile-first: the form fields stack in one column and widen only at sm:", async () => {
    currentClient = client({ rows: [], product });
    const { container } = render(await ManualMetricsSection(base));
    const grid = container.querySelector("form .grid");
    expect(grid?.className).toContain("grid-cols-1");
    expect(grid?.className).toContain("sm:grid-cols-2");
  });
});

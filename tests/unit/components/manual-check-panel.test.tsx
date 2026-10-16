import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ManualCheckPanel } from "@/features/campaigns/manual-check-panel";

describe("ManualCheckPanel (PR #37 / A2)", () => {
  it("explains that part of the ad objects may exist and shows the recorded campaign id", () => {
    render(
      <ManualCheckPanel
        externalCampaignId="ext_campaign_1"
        note="Peluncuran berhenti pada pembuatan creative. Objek di Meta (semua PAUSED): campaign=ext_campaign_1, adset=ext_adset_1."
      />,
    );

    expect(screen.getByText("Perlu pemeriksaan manual")).toBeInTheDocument();
    expect(screen.getByText(/mungkin\s+sudah dibuat di Meta/)).toBeInTheDocument();
    expect(screen.getByText("ext_campaign_1")).toBeInTheDocument();
    expect(screen.getByText(/adset=ext_adset_1/)).toBeInTheDocument();
  });

  it("without an id it never claims that nothing was created", () => {
    const { container } = render(<ManualCheckPanel externalCampaignId={null} note={null} />);

    expect(screen.getByText(/Tidak ada ID objek yang tercatat/)).toBeInTheDocument();
    expect(screen.getByText(/tidak membuktikan bahwa tidak ada objek/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/pasti tidak|tidak ada objek yang dibuat\./i);
  });

  it("offers no retry, reset, unlock or resume path: no button, form or link", () => {
    const { container } = render(<ManualCheckPanel externalCampaignId="ext_campaign_1" note="catatan" />);

    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    // Case-sensitive on purpose: the panel may SAY there is no retry button
    // ("tombol coba lagi"), but must not render a control labelled like one.
    expect(container.textContent).not.toMatch(/Coba Lagi|Lepas kunci|Lanjutkan|Resume/);
  });
});

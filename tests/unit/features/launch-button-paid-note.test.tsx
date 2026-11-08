import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const launch = vi.hoisted(() => vi.fn());
vi.mock("@/features/campaigns/launch-actions", () => ({ launchChannelCampaignAction: launch }));

import { LaunchChannelButton } from "@/features/campaigns/launch-button";

afterEach(() => {
  cleanup();
  launch.mockReset();
});

describe("LaunchChannelButton — paid launch gate closed (display only)", () => {
  it("is disabled and explains that paid launch is being prepared", () => {
    render(
      <LaunchChannelButton channelCampaignId="cc1" paidLaunchNote="Peluncuran iklan berbayar sedang dalam persiapan." />,
    );
    expect(screen.getByRole("button", { name: "Luncurkan" })).toBeDisabled();
    expect(screen.getByText("Peluncuran iklan berbayar sedang dalam persiapan.")).toBeInTheDocument();
  });

  it("keeps the retry label but stays disabled", () => {
    render(<LaunchChannelButton channelCampaignId="cc1" retry paidLaunchNote="Peluncuran iklan berbayar sedang dalam persiapan." />);
    expect(screen.getByRole("button", { name: "Coba Lagi" })).toBeDisabled();
  });

  it("is unchanged (enabled, no note) when no note is passed", () => {
    render(<LaunchChannelButton channelCampaignId="cc1" />);
    expect(screen.getByRole("button", { name: "Luncurkan" })).toBeEnabled();
    expect(screen.queryByText(/dalam persiapan/)).toBeNull();
  });
});

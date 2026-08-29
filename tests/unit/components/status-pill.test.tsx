import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "@/components/ui/status-pill";

describe("StatusPill", () => {
  it("renders NOT_CONFIGURED honestly rather than as connected", () => {
    render(<StatusPill status="NOT_CONFIGURED" />);
    expect(screen.getByText("Belum Dikonfigurasi")).toBeInTheDocument();
  });

  it("renders CONNECTED only when explicitly given that status", () => {
    render(<StatusPill status="CONNECTED" />);
    expect(screen.getByText("Terhubung")).toBeInTheDocument();
  });
});

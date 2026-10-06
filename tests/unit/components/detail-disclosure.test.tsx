import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DetailDisclosure } from "@/features/campaigns/detail-disclosure";

// Vitest globals are off, so RTL does not auto-clean between tests.
afterEach(() => cleanup());

describe("DetailDisclosure", () => {
  it("renders children untouched (no <details>) when disabled", () => {
    const { container } = render(
      <DetailDisclosure enabled={false}>
        <p>Strategi AI</p>
      </DetailDisclosure>,
    );
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("Strategi AI")).toBeInTheDocument();
  });

  it("wraps children in a closed <details> by default when enabled", () => {
    const { container } = render(
      <DetailDisclosure enabled>
        <p>Strategi AI</p>
      </DetailDisclosure>,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(screen.getByText("Lihat Detail Strategi")).toBeInTheDocument();
  });

  it("keeps hidden children in the DOM so editors/forms are not unmounted", () => {
    render(
      <DetailDisclosure enabled>
        <form aria-label="editor">
          <input aria-label="headline" defaultValue="Halo" />
        </form>
      </DetailDisclosure>,
    );
    expect(screen.getByLabelText("headline")).toHaveValue("Halo");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { regenerateMock } = vi.hoisted(() => ({ regenerateMock: vi.fn(async () => ({ error: null })) }));
vi.mock("@/features/campaigns/actions", () => ({ regenerateCampaignProposalAction: regenerateMock }));

import { ProposalRecoveryCard } from "@/features/campaigns/proposal-recovery-card";
import { classifyStoredProposal, proposalRecoveryAccess } from "@/lib/campaigns/proposal-recovery";

afterEach(() => {
  cleanup();
  regenerateMock.mockClear();
});

describe("classifyStoredProposal", () => {
  it.each([
    ["null", null, "MISSING"],
    ["undefined", undefined, "MISSING"],
    ["a string", "Kopi", "MALFORMED"],
    ["an array", [1], "MALFORMED"],
    ["a number", 5, "MALFORMED"],
    ["empty object", {}, "INCOMPLETE"],
    ["headline blank", { headline: " ", primary_text: "p", cta: "c" }, "INCOMPLETE"],
    ["cta wrong type", { headline: "h", primary_text: "p", cta: 3 }, "INCOMPLETE"],
    ["complete copy", { headline: "h", primary_text: "p", cta: "c" }, "OK"],
  ])("%s -> %s", (_name, raw, expected) => {
    expect(classifyStoredProposal(raw)).toBe(expected);
  });
});

describe("proposalRecoveryAccess (mirrors the actions: DRAFT, owner/marketing)", () => {
  it("allows owner and marketing on a DRAFT only", () => {
    expect(proposalRecoveryAccess("owner", "DRAFT")).toEqual({ allowed: true });
    expect(proposalRecoveryAccess("marketing", "DRAFT")).toEqual({ allowed: true });
  });
  it.each([["viewer"], ["finance"], [null], [undefined], [""]])("refuses role %s with a reason", (role) => {
    const r = proposalRecoveryAccess(role as string | null | undefined, "DRAFT");
    expect(r.allowed).toBe(false);
  });
  it.each(["AWAITING_APPROVAL", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "FAILED"])("refuses status %s", (status) => {
    expect(proposalRecoveryAccess("owner", status).allowed).toBe(false);
  });
});

describe("ProposalRecoveryCard", () => {
  it.each([
    ["MISSING", /Strategi iklan belum ada/],
    ["MALFORMED", /Strategi iklan tidak bisa dibaca/],
  ] as const)("%s: plain explanation and a regenerate button for an owner on a DRAFT, and no AI call on render", (shape, title) => {
    render(<ProposalRecoveryCard campaignId="c1" shape={shape} role="owner" status="DRAFT" />);
    expect(screen.getByRole("region", { name: title })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Buat Ulang dengan AI/ })).toBeTruthy();
    expect(document.body.textContent).toContain("AI hanya berjalan setelah Anda menekan tombol");
    expect(document.body.textContent).toContain("kuota AI");
    expect(regenerateMock).not.toHaveBeenCalled();
  });

  it("the action runs only after the user presses the button", async () => {
    render(<ProposalRecoveryCard campaignId="c1" shape="MISSING" role="marketing" status="DRAFT" />);
    fireEvent.click(screen.getByRole("button", { name: /Buat Ulang dengan AI/ }));
    await waitFor(() => expect(regenerateMock).toHaveBeenCalledTimes(1));
    expect(regenerateMock).toHaveBeenCalledWith("c1");
  });

  it.each([
    ["viewer", "DRAFT", /Hanya Owner atau Marketing/],
    ["owner", "AWAITING_APPROVAL", /Batalkan pengajuan/],
    ["owner", "SCHEDULED", /Kembalikan ke Draft/],
    ["owner", "ACTIVE", /masih berstatus Draft/],
  ])("%s on %s: the reason is shown and there is NO button", (role, status, reason) => {
    render(<ProposalRecoveryCard campaignId="c1" shape="MISSING" role={role} status={status} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("proposal-recovery-reason").textContent).toMatch(reason);
    expect(regenerateMock).not.toHaveBeenCalled();
  });

  it("INCOMPLETE explains and points to the editor, without a second regenerate button", () => {
    render(<ProposalRecoveryCard campaignId="c1" shape="INCOMPLETE" role="owner" status="DRAFT" />);
    expect(screen.getByRole("region", { name: /Teks iklan belum lengkap/ })).toBeTruthy();
    expect(document.body.textContent).toContain("editor di bagian Konten Iklan");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

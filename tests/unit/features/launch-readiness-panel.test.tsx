import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LaunchReadinessPanel,
  NOT_AVAILABLE_NOTE,
  PREVIEW_DISCLAIMER,
  READINESS_PANEL_DISCLAIMER,
} from "@/features/campaigns/launch-readiness-panel";
import { evaluateLaunchReadiness, type LaunchReadinessInput } from "@/lib/campaigns/launch-readiness";
import { buildInternalPreview } from "@/lib/campaigns/internal-preview";

const NOW = new Date("2026-11-11T00:00:00.000Z");
const INPUT: LaunchReadinessInput = {
  now: NOW,
  connection: { ok: true, value: { status: "CONNECTED", expiresAt: "2026-12-31T00:00:00.000Z", hasAdAccount: true } },
  adAccountConfirmed: { ok: true, value: true },
  dailyBudget: 100000,
  currency: "IDR",
  approvalPolicy: { ok: true, value: null },
  launchApprovals: { ok: true, value: [{ status: "APPROVED", created_at: "2026-11-10T00:00:00Z" }] },
  budgetWriteEnabled: false,
  emergencyStopActive: false,
  metaReadiness: null,
};
const PREVIEW = buildInternalPreview({
  aiProposal: { headline: "Judul Iklan", primary_text: "Teks utama", cta: "Pesan", audience_summary: "Pemilik warung" },
  audienceNotes: null,
  targetCity: "Solo",
  targetRegion: null,
  targetCountry: null,
  targetLanguage: "id",
  dailyBudget: 100000,
  totalBudget: null,
  currency: "IDR",
  durationDays: 5,
  channelShares: [{ channel: "FACEBOOK", percentage: 100 }],
});

function render(input: LaunchReadinessInput = INPUT) {
  return renderToStaticMarkup(<LaunchReadinessPanel readiness={evaluateLaunchReadiness(input)} preview={PREVIEW} />);
}

describe("LaunchReadinessPanel", () => {
  it("shows 'Belum siap' with the locked S1 gate and unchecked Meta readiness", () => {
    const html = render();
    expect(html).toContain('data-overall="NOT_READY"');
    expect(html).toContain("Belum siap");
    expect(html).toContain('data-item="S1_GATE" data-status="FAIL"');
    expect(html).toContain("Terkunci");
    expect(html).toContain('data-item="META_ACCOUNT_READINESS" data-status="UNKNOWN"');
  });

  it("shows the internal preview and the honest limits", () => {
    const html = render();
    expect(html).toContain("Judul Iklan");
    expect(html).toContain("Pemilik warung");
    expect(html).toContain("Solo");
    expect(html).toContain("Perkiraan biaya selama durasi");
    expect(html).toContain(PREVIEW_DISCLAIMER);
    expect(html).toContain(NOT_AVAILABLE_NOTE);
    expect(html).toContain(READINESS_PANEL_DISCLAIMER);
  });

  it("makes no promise about ad results", () => {
    const html = render();
    expect(html).not.toMatch(/pasti tayang|dijamin|pasti berhasil|pasti laku|pasti untung/i);
    expect(html).toContain("bukan jaminan");
  });

  it("has no button, form or action control", () => {
    const html = render();
    expect(html).not.toMatch(/<button|<form|<input|type="submit"/i);
    expect(html).not.toMatch(/Luncurkan|Publish|Aktifkan/);
  });

  it("shows READY wording only when every item passes", () => {
    const html = render({
      ...INPUT,
      budgetWriteEnabled: true,
      metaReadiness: {
        state: "READY",
        summary: "",
        checks: [],
        unavailableReason: null,
        minDailyBudgetRaw: null,
        checkedAt: NOW.toISOString(),
      },
    });
    expect(html).toContain('data-overall="READY"');
    expect(html).toContain("Pemeriksaan lulus");
  });

  it("notes a missing proposal instead of inventing preview text", () => {
    const empty = buildInternalPreview({ aiProposal: null, audienceNotes: null, targetCity: null, targetRegion: null, targetCountry: null, targetLanguage: null, dailyBudget: null, totalBudget: null, currency: "IDR", durationDays: null, channelShares: [] });
    const html = renderToStaticMarkup(<LaunchReadinessPanel readiness={evaluateLaunchReadiness(INPUT)} preview={empty} />);
    expect(html).toContain("Belum ada proposal AI");
    expect(html).toContain("Belum diisi");
  });
});

describe("readiness files stay read-only and offline", () => {
  const files = [
    "lib/campaigns/launch-readiness.ts",
    "lib/campaigns/internal-preview.ts",
    "features/campaigns/launch-readiness-panel.tsx",
  ];
  for (const rel of files) {
    it(`${rel} has no writes, network, env or connector/gate import`, () => {
      const text = readFileSync(path.join(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const pattern of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /\.rpc\(/, /\bfetch\(/, /process\.env/, /use server/]) {
        expect(pattern.test(text), `${rel} ${pattern}`).toBe(false);
      }
      expect(text).not.toMatch(/from "@\/lib\/connectors\/(meta-connector|get-connector)"/);
      expect(text).not.toMatch(/external-budget-guard/);
      expect(text).not.toMatch(/supabase/i);
    });
  }
});

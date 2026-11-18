/**
 * Where a campaign is on the path
 *   Produk → Strategi AI → Review → Persetujuan → Eksekusi → Analitik
 * derived ONLY from the stored campaign status (+ whether an AI proposal
 * exists). Pure, no I/O.
 *
 * Honesty rule: "Eksekusi" is marked done only when the status says the
 * campaign actually ran (ACTIVE/COMPLETED). SCHEDULED means approved but not
 * launched, so Eksekusi is the CURRENT step, never a finished one.
 */

export type JourneyStepId = "product" | "strategy" | "review" | "approval" | "execution" | "analytics";
export type JourneyStepState = "done" | "current" | "attention" | "upcoming";

export interface JourneyStep {
  readonly id: JourneyStepId;
  readonly label: string;
  readonly state: JourneyStepState;
}

export interface CampaignJourney {
  readonly steps: readonly JourneyStep[];
  /** 1-based index of the step the person should look at now. */
  readonly currentIndex: number;
  readonly currentLabel: string;
  /** One plain sentence: what happens or what to do next. */
  readonly nextAction: string;
}

const STEP_LABELS: readonly [JourneyStepId, string][] = [
  ["product", "Produk"],
  ["strategy", "Strategi AI"],
  ["review", "Review"],
  ["approval", "Persetujuan"],
  ["execution", "Eksekusi"],
  ["analytics", "Analitik"],
];

function build(states: readonly JourneyStepState[], nextAction: string): CampaignJourney {
  const steps = STEP_LABELS.map(([id, label], i) => ({ id, label, state: states[i] }));
  const focus = steps.findIndex((s) => s.state === "current" || s.state === "attention");
  const currentIndex = focus === -1 ? steps.length : focus + 1;
  return { steps, currentIndex, currentLabel: steps[currentIndex - 1].label, nextAction };
}

export function buildCampaignJourney(status: string, hasProposal: boolean): CampaignJourney {
  switch (status) {
    case "DRAFT":
      return hasProposal
        ? build(
            ["done", "done", "current", "upcoming", "upcoming", "upcoming"],
            "Periksa strategi dan teks iklan, lalu ajukan persetujuan. Belum ada yang diterbitkan.",
          )
        : build(
            ["done", "current", "upcoming", "upcoming", "upcoming", "upcoming"],
            "Strategi AI belum ada. Buat strategi dulu agar bisa ditinjau.",
          );
    case "AWAITING_APPROVAL":
      return build(
        ["done", "done", "done", "current", "upcoming", "upcoming"],
        "Menunggu keputusan Owner. Belum ada yang diterbitkan.",
      );
    case "SCHEDULED":
      return build(
        ["done", "done", "done", "done", "current", "upcoming"],
        "Sudah disetujui, tetapi belum berjalan. Luncurkan per channel secara manual.",
      );
    case "ACTIVE":
      return build(
        ["done", "done", "done", "done", "done", "current"],
        "Campaign berjalan. Pantau hasilnya dan catat metrik.",
      );
    case "PAUSED":
      return build(
        ["done", "done", "done", "done", "attention", "upcoming"],
        "Campaign dijeda. Periksa channel sebelum melanjutkan.",
      );
    case "COMPLETED":
      return build(
        ["done", "done", "done", "done", "done", "done"],
        "Campaign selesai. Tinjau hasil untuk campaign berikutnya.",
      );
    case "FAILED":
      return build(
        ["done", "done", "done", "done", "attention", "upcoming"],
        "Ada channel yang gagal. Buka rincian channel untuk melihat penyebabnya.",
      );
    default:
      return build(
        ["done", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"],
        "Status campaign tidak dikenali.",
      );
  }
}

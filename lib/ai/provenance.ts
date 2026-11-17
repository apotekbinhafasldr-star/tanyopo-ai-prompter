/**
 * Honest, user-facing description of WHERE an AI result came from, derived
 * only from the recorded prompter_ai_jobs row (never guessed).
 *
 * "Provider cadangan" means a second real model answered because the first
 * one failed. It is still AI output. Nothing in this app silently swaps in a
 * canned template for a real tenant, so there is no "template" kind here; if
 * the job row is missing the origin is reported as unknown, not as AI.
 */

export interface AiJobProvenanceRow {
  readonly status: string;
  readonly provider: string | null;
  readonly model: string | null;
  /** The provider that was tried first and failed, when a fallback answered. */
  readonly fallback_provider: string | null;
}

export type AiProvenanceKind = "MODEL" | "FALLBACK_PROVIDER" | "UNKNOWN";

export interface AiProvenance {
  readonly kind: AiProvenanceKind;
  readonly label: string;
  readonly detail: string;
}

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

export function providerDisplayName(provider: string): string {
  return PROVIDER_NAMES[provider.toLowerCase()] ?? provider;
}

export function describeAiProvenance(job: AiJobProvenanceRow | null | undefined): AiProvenance {
  if (!job) {
    return {
      kind: "UNKNOWN",
      label: "Asal AI tidak tercatat",
      detail: "Tidak ada catatan job AI untuk strategi ini (misalnya dibuat sebelum pencatatan). Jangan anggap ini bukti hasil model.",
    };
  }
  if (job.status !== "COMPLETED" || !job.provider || !job.model) {
    return {
      kind: "UNKNOWN",
      label: "Asal AI belum terverifikasi",
      detail: "Catatan job AI tidak lengkap atau belum selesai, jadi sumbernya tidak bisa dipastikan.",
    };
  }
  const used = `${providerDisplayName(job.provider)} ${job.model}`;
  if (job.fallback_provider) {
    return {
      kind: "FALLBACK_PROVIDER",
      label: `Dibuat oleh model cadangan (${providerDisplayName(job.provider)})`,
      detail: `Penyedia utama (${providerDisplayName(job.fallback_provider)}) gagal, lalu ${used} yang menjawab. Hasilnya tetap keluaran model AI, tetapi kualitasnya bisa berbeda.`,
    };
  }
  return {
    kind: "MODEL",
    label: `Dibuat oleh model AI: ${providerDisplayName(job.provider)}`,
    detail: `Model ${used}. Dicatat dari job AI, bukan template.`,
  };
}

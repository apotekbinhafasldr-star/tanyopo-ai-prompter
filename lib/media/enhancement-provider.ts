/**
 * Batch B4, Step 5 — Lightweight Enhancement Readiness. Same
 * discipline/shape as lib/billing/payment-provider.ts and
 * lib/connectors/types.ts: a vendor-neutral contract for basic media
 * touch-ups (clarify, exposure, sharpen, denoise, crop, resize; basic
 * video clarity/stabilization) — never the heavy generative creative
 * work that stays Tanyopo AdPersona's job. No real provider is wired in
 * yet (no image/video processing library or API exists anywhere in this
 * codebase today); only NullMediaEnhancementProvider
 * (lib/media/providers/null-media-enhancement-provider.ts) exists,
 * resolved via getMediaEnhancementProvider()
 * (lib/media/get-media-enhancement-provider.ts). Nothing in the app UI
 * calls this yet — it exists so a real provider can plug in later
 * without customers ever having seen a button that claimed to work
 * before one did.
 */

export class MediaEnhancementConfigError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = "MediaEnhancementConfigError";
  }
}

export type ImageEnhancementOperation =
  | "CLARIFY"
  | "EXPOSURE"
  | "SHARPEN"
  | "DENOISE"
  | "CROP"
  | "RESIZE";

export type VideoEnhancementOperation = "CLARIFY" | "STABILIZE";

export interface ImageEnhancementInput {
  /** Path within the product-media bucket, e.g. "{tenantId}/{productId}/{file}". */
  storagePath: string;
  operation: ImageEnhancementOperation;
  /** e.g. { x, y, width, height } for CROP, { width, height } for RESIZE. */
  params?: Record<string, number>;
}

export interface VideoEnhancementInput {
  storagePath: string;
  operation: VideoEnhancementOperation;
}

export interface EnhancementResult {
  /** Storage path of the newly-produced enhanced asset — the original
   * upload is never overwritten in place. */
  storagePath: string;
}

export interface MediaEnhancementProvider {
  /** e.g. a real vendor's slug once one is chosen. "none" for the null provider. */
  readonly name: string;

  isConfigured(): boolean;

  enhanceImage(input: ImageEnhancementInput): Promise<EnhancementResult>;

  enhanceVideo(input: VideoEnhancementInput): Promise<EnhancementResult>;
}

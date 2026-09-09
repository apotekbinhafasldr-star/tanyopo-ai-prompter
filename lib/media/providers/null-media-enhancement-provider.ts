import {
  MediaEnhancementConfigError,
  type EnhancementResult,
  type ImageEnhancementInput,
  type MediaEnhancementProvider,
  type VideoEnhancementInput,
} from "@/lib/media/enhancement-provider";

/**
 * The default (and today, only) MediaEnhancementProvider — no real
 * image/video processing library or API is configured in this codebase.
 * Every method throws MediaEnhancementConfigError rather than returning
 * the original file unchanged and pretending it was enhanced. Kept
 * strictly out of any UI: a customer must never see a "perjelas foto"
 * button that quietly does nothing.
 */
export class NullMediaEnhancementProvider implements MediaEnhancementProvider {
  readonly name = "none";

  isConfigured(): boolean {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept typed/named so callers (and tests) get real arity checking against the interface.
  async enhanceImage(input: ImageEnhancementInput): Promise<EnhancementResult> {
    throw new MediaEnhancementConfigError(this.name, "Belum ada media enhancement provider yang dikonfigurasi.");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async enhanceVideo(input: VideoEnhancementInput): Promise<EnhancementResult> {
    throw new MediaEnhancementConfigError(this.name, "Belum ada media enhancement provider yang dikonfigurasi.");
  }
}

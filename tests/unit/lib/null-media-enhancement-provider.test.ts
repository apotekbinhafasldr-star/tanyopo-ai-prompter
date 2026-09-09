import { describe, expect, it } from "vitest";
import { NullMediaEnhancementProvider } from "@/lib/media/providers/null-media-enhancement-provider";
import { MediaEnhancementConfigError } from "@/lib/media/enhancement-provider";

describe("NullMediaEnhancementProvider", () => {
  const provider = new NullMediaEnhancementProvider();

  it("reports itself as not configured", () => {
    expect(provider.isConfigured()).toBe(false);
    expect(provider.name).toBe("none");
  });

  it("throws MediaEnhancementConfigError rather than faking an enhanced image", async () => {
    await expect(
      provider.enhanceImage({ storagePath: "tenant1/product1/photo.jpg", operation: "SHARPEN" }),
    ).rejects.toBeInstanceOf(MediaEnhancementConfigError);
  });

  it("throws MediaEnhancementConfigError rather than faking an enhanced video", async () => {
    await expect(
      provider.enhanceVideo({ storagePath: "tenant1/product1/clip.mp4", operation: "STABILIZE" }),
    ).rejects.toBeInstanceOf(MediaEnhancementConfigError);
  });
});

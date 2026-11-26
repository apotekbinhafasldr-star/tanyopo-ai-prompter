// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMediaUploadHardeningEnabled } from "@/lib/media/upload-hardening-flag";

describe("MEDIA_UPLOAD_HARDENING_ENABLED", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("default MATI saat env tidak diset", () => {
    vi.stubEnv("MEDIA_UPLOAD_HARDENING_ENABLED", "");
    expect(isMediaUploadHardeningEnabled()).toBe(false);
  });

  it("aktif hanya bila persis \"true\"", () => {
    vi.stubEnv("MEDIA_UPLOAD_HARDENING_ENABLED", "true");
    expect(isMediaUploadHardeningEnabled()).toBe(true);
  });

  it.each(["TRUE", "True", "1", "yes", "on", "false", " true", "true "])("nilai %j tetap MATI", (value) => {
    vi.stubEnv("MEDIA_UPLOAD_HARDENING_ENABLED", value);
    expect(isMediaUploadHardeningEnabled()).toBe(false);
  });
});

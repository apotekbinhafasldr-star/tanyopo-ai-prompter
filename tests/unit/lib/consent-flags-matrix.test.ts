import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isConsentEnforcementEnabled, isConsentUiEnabled, resetConsentFlagWarningForTests } from "@/lib/consent/flags";

const COMBOS: Array<{ ui: string; enf: string; uiOn: boolean; enfEffective: boolean }> = [
  { ui: "", enf: "", uiOn: false, enfEffective: false },
  { ui: "true", enf: "", uiOn: true, enfEffective: false },
  { ui: "true", enf: "true", uiOn: true, enfEffective: true },
  // UI MATI + ENF HIDUP dilarang: enforcement efektif MATI (Owner tidak terkunci tanpa jalur persetujuan).
  { ui: "", enf: "true", uiOn: false, enfEffective: false },
];

describe("matriks saklar UI x ENF (K5-2)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetConsentFlagWarningForTests();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    errorSpy.mockRestore();
  });

  it.each(COMBOS)("UI=%j ENF=%j", ({ ui, enf, uiOn, enfEffective }) => {
    vi.stubEnv("CONSENT_UI_ENABLED", ui);
    vi.stubEnv("CONSENT_ENFORCEMENT_ENABLED", enf);
    expect(isConsentUiEnabled()).toBe(uiOn);
    expect(isConsentEnforcementEnabled()).toBe(enfEffective);
  });

  it("ENF tanpa UI: log galat tepat sekali per instance, tanpa data pribadi, tanpa nilai env", () => {
    vi.stubEnv("CONSENT_UI_ENABLED", "");
    vi.stubEnv("CONSENT_ENFORCEMENT_ENABLED", "true");
    isConsentEnforcementEnabled();
    isConsentEnforcementEnabled();
    isConsentEnforcementEnabled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toBe("[consent] CONSENT_ENFORCEMENT_ENABLED aktif tanpa CONSENT_UI_ENABLED: enforcement diperlakukan MATI.");
  });

  it("tanpa ENF atau dengan keduanya hidup: tidak ada log", () => {
    vi.stubEnv("CONSENT_UI_ENABLED", "true");
    vi.stubEnv("CONSENT_ENFORCEMENT_ENABLED", "true");
    isConsentEnforcementEnabled();
    vi.stubEnv("CONSENT_ENFORCEMENT_ENABLED", "");
    isConsentEnforcementEnabled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("nilai selain persis \"true\" = MATI untuk keduanya", () => {
    for (const v of ["1", "TRUE", " true", "yes"]) {
      vi.stubEnv("CONSENT_UI_ENABLED", v);
      vi.stubEnv("CONSENT_ENFORCEMENT_ENABLED", v);
      expect(isConsentUiEnabled()).toBe(false);
      expect(isConsentEnforcementEnabled()).toBe(false);
    }
  });
});

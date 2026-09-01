import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionary";
import idDictionary from "@/lib/i18n/dictionaries/id";
import enDictionary from "@/lib/i18n/dictionaries/en";

describe("getDictionary", () => {
  it("returns the Indonesian dictionary for 'id'", async () => {
    const dict = await getDictionary("id");
    expect(dict).toBe(idDictionary);
    expect(dict.common.save).toBe("Simpan");
  });

  it("returns the English dictionary for 'en'", async () => {
    const dict = await getDictionary("en");
    expect(dict).toBe(enDictionary);
    expect(dict.common.save).toBe("Save");
  });

  it("falls back to the default (Indonesian) locale for an unsupported value", async () => {
    const dict = await getDictionary("fr");
    expect(dict).toBe(idDictionary);
  });

  it("falls back to the default locale for null/undefined", async () => {
    expect(await getDictionary(null)).toBe(idDictionary);
    expect(await getDictionary(undefined)).toBe(idDictionary);
  });

  it("id and en dictionaries expose exactly the same keys (no missing translations)", () => {
    function keysOf(obj: object, prefix = ""): string[] {
      return Object.entries(obj).flatMap(([key, value]) =>
        typeof value === "object" && value !== null
          ? keysOf(value, `${prefix}${key}.`)
          : [`${prefix}${key}`],
      );
    }

    expect(keysOf(enDictionary).sort()).toEqual(keysOf(idDictionary).sort());
  });
});

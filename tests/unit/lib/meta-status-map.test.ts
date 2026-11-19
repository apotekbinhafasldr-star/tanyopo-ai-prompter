import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { META_STATUS_DISPLAY, metaStatusDisplay, type MetaStatusCategory } from "@/lib/campaigns/meta-status-map";

/** Words that claim the ad is on / delivering. Allowed ONLY for effective_status === "ACTIVE". */
const DELIVERY_WORDS = /aktif|tayang/i;

const TABLE: [string, MetaStatusCategory, string][] = [
  ["ACTIVE", "ACTIVE", "Aktif di Meta"],
  ["PAUSED", "PAUSED", "Dijeda"],
  ["CAMPAIGN_PAUSED", "PAUSED_PARENT", "Dijeda (induk)"],
  ["ADSET_PAUSED", "PAUSED_PARENT", "Dijeda (induk)"],
  ["PENDING_REVIEW", "IN_REVIEW", "Ditinjau Meta"],
  ["IN_PROCESS", "IN_REVIEW", "Ditinjau Meta"],
  ["DISAPPROVED", "NEEDS_FIX", "Perlu perbaikan"],
  ["WITH_ISSUES", "NEEDS_FIX", "Perlu perbaikan"],
  ["PENDING_BILLING_INFO", "BILLING_ISSUE", "Masalah pembayaran"],
  ["ARCHIVED", "ARCHIVED", "Diarsipkan"],
  ["DELETED", "ARCHIVED", "Diarsipkan"],
];

describe("metaStatusDisplay: effective_status table", () => {
  it.each(TABLE)("%s -> %s / %s", (effective, category, label) => {
    const display = metaStatusDisplay(effective, effective);
    expect(display.category).toBe(category);
    expect(display.label).toBe(label);
    expect(display.note.length).toBeGreaterThan(0);
  });

  it("every category has a display entry and the table is frozen", () => {
    expect(Object.keys(META_STATUS_DISPLAY).sort()).toEqual(
      ["ACTIVE", "ARCHIVED", "BILLING_ISSUE", "IN_REVIEW", "NEEDS_FIX", "PAUSED", "PAUSED_PARENT", "UNKNOWN"].sort(),
    );
    expect(Object.isFrozen(META_STATUS_DISPLAY)).toBe(true);
  });

  it("the effective status wins over a different configured status", () => {
    expect(metaStatusDisplay("CAMPAIGN_PAUSED", "ACTIVE").label).toBe("Dijeda (induk)");
    expect(metaStatusDisplay("DISAPPROVED", "ACTIVE").label).toBe("Perlu perbaikan");
    expect(metaStatusDisplay("ACTIVE", "PAUSED").label).toBe("Aktif di Meta");
  });
});

describe('"Aktif"/"tayang" only for effective_status === "ACTIVE"', () => {
  const EFFECTIVE_VALUES: unknown[] = [
    ...TABLE.map(([effective]) => effective),
    "SOMETHING_NEW",
    "",
    "active",
    "Active",
    " ACTIVE",
    "ACTIVE ",
    "ACTIVE_NOW",
    "AKTIF",
    null,
    undefined,
    0,
    1,
    true,
    {},
    [],
    ["ACTIVE"],
  ];
  const CONFIGURED_VALUES: unknown[] = ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED", "active", "SOMETHING_NEW", null, undefined, 5, {}];

  it("no other combination produces the active state or a delivery word", () => {
    for (const effective of EFFECTIVE_VALUES) {
      for (const configured of CONFIGURED_VALUES) {
        const display = metaStatusDisplay(effective, configured);
        const text = `${display.label} ${display.note}`;
        if (effective === "ACTIVE") {
          expect(display.isActiveOnMeta).toBe(true);
          expect(display.category).toBe("ACTIVE");
        } else {
          expect(display.isActiveOnMeta, JSON.stringify([effective, configured])).toBe(false);
          expect(display.category, JSON.stringify([effective, configured])).not.toBe("ACTIVE");
          expect(text, JSON.stringify([effective, configured])).not.toMatch(DELIVERY_WORDS);
        }
      }
    }
  });

  it("configured_status ACTIVE alone never yields Aktif", () => {
    for (const effective of [undefined, null, "", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "PENDING_REVIEW", "DISAPPROVED", "PENDING_BILLING_INFO", "WITH_ISSUES"]) {
      const display = metaStatusDisplay(effective, "ACTIVE");
      expect(display.isActiveOnMeta).toBe(false);
      expect(`${display.label} ${display.note}`).not.toMatch(DELIVERY_WORDS);
    }
    expect(metaStatusDisplay(undefined, "ACTIVE").label).toBe("Tidak diketahui");
    expect(metaStatusDisplay(null, "ACTIVE").label).toBe("Tidak diketahui");
  });

  it("the delivery word does appear for ACTIVE (the check is not vacuous)", () => {
    const display = metaStatusDisplay("ACTIVE", "ACTIVE");
    expect(`${display.label} ${display.note}`).toMatch(DELIVERY_WORDS);
    expect(display.variant).toBe("success");
  });

  it("only the ACTIVE entry uses the success variant", () => {
    for (const [category, entry] of Object.entries(META_STATUS_DISPLAY)) {
      if (category === "ACTIVE") expect(entry.variant).toBe("success");
      else expect(entry.variant).not.toBe("success");
    }
  });
});

describe("metaStatusDisplay: fail-closed for the unknown", () => {
  it.each([
    ["an unrecognised value", "SOMETHING_NEW"],
    ["an empty string combined with nothing", ""],
    ["lower case", "active"],
    ["lower case paused", "paused"],
    ["mixed case", "Paused"],
    ["padded with spaces", " PAUSED "],
    ["a number", 7],
    ["an object", {}],
    ["an array", ["PAUSED"]],
    ["a boolean", false],
    ["a prototype key", "constructor"],
    ["another prototype key", "__proto__"],
    ["toString", "toString"],
  ])("%s is Tidak diketahui", (_label, value) => {
    const display = metaStatusDisplay(value, undefined);
    expect(display.category).toBe("UNKNOWN");
    expect(display.label).toBe("Tidak diketahui");
    expect(display.isActiveOnMeta).toBe(false);
  });

  it("null and undefined without a configured status are Tidak diketahui", () => {
    for (const value of [null, undefined]) {
      expect(metaStatusDisplay(value).label).toBe("Tidak diketahui");
      expect(metaStatusDisplay(value, null).label).toBe("Tidak diketahui");
      expect(metaStatusDisplay(value, undefined).label).toBe("Tidak diketahui");
    }
  });

  it("a present but unrecognised effective status is not rescued by configured_status", () => {
    expect(metaStatusDisplay("SOMETHING_NEW", "PAUSED").label).toBe("Tidak diketahui");
    expect(metaStatusDisplay("paused", "PAUSED").label).toBe("Tidak diketahui");
  });

  it("a missing effective status falls back to configured_status only for values that never deliver", () => {
    expect(metaStatusDisplay(undefined, "PAUSED").label).toBe("Dijeda");
    expect(metaStatusDisplay(null, "PAUSED").label).toBe("Dijeda");
    expect(metaStatusDisplay("", "ARCHIVED").label).toBe("Diarsipkan");
    expect(metaStatusDisplay(undefined, "DELETED").label).toBe("Diarsipkan");
    expect(metaStatusDisplay(undefined, "paused").label).toBe("Tidak diketahui");
    expect(metaStatusDisplay(undefined, "PENDING_REVIEW").label).toBe("Tidak diketahui");
  });
});

describe("meta-status-map is pure", () => {
  const source = readFileSync("lib/campaigns/meta-status-map.ts", "utf8");

  it("has no I/O: no fetch, no server-only, no database, no environment", () => {
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios|server-only|supabase|process\.env/);
  });

  it("imports only a type from the existing display module", () => {
    const imports = source.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual(['import type { ChannelStatusDisplay } from "@/lib/campaigns/channel-status-display";']);
  });
});

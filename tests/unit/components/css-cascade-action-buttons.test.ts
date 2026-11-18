import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

interface Block {
  prelude: string;
  body: string;
}

/** Splits CSS into its top-level blocks (depth 0). Nested blocks stay inside `body`. */
function topLevelBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let depth = 0;
  let start = 0;
  let bodyStart = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        blocks.push({ prelude: source.slice(start, bodyStart - 1).trim(), body: source.slice(bodyStart, i) });
        start = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      start = i + 1; // e.g. @import "tailwindcss";
    }
  }
  return blocks;
}

const blocks = topLevelBlocks(css);
const unlayeredRules = blocks.filter((b) => !b.prelude.startsWith("@"));
const layered = blocks.filter((b) => b.prelude.startsWith("@layer") || b.prelude.startsWith("@theme"));
const ruleFor = (selector: string) => unlayeredRules.find((b) => b.prelude.split(",").map((x) => x.trim()).includes(selector));

/** [ids, classes+attributes+pseudo-classes, elements] of one simple selector list entry. */
function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes =
    (selector.match(/\.[\w-]+/g) ?? []).length +
    (selector.match(/\[[^\]]+\]/g) ?? []).length +
    (selector.match(/(?<!:):(?!:)[\w-]+/g) ?? []).length;
  const elements = (selector.replace(/[.#:[][^\s.#:[>+~]*/g, "").match(/[a-z][\w-]*/gi) ?? []).length;
  return [ids, classes, elements];
}
const higher = (a: [number, number, number], b: [number, number, number]) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

describe("action-btn CSS lives OUTSIDE any @layer (so it beats the unlayered global rules and utilities)", () => {
  it("no @layer / @theme block mentions the action-btn or hero-cta rules", () => {
    for (const b of layered) {
      expect(b.body).not.toContain("action-btn");
      expect(b.body).not.toContain("hero-cta");
    }
  });

  it("defines the scoped unlayered rules with the exact colours", () => {
    expect(ruleFor(".action-btn:focus-visible")?.body).toMatch(/outline-color:\s*var\(--action\)/);
    expect(ruleFor(".action-btn--on-dark")?.body).toMatch(/border-color:\s*rgb\(255 255 255 \/ 0\.4\)/);
    expect(ruleFor(".action-btn--on-card")?.body).toMatch(/border-color:\s*rgb\(255 255 255 \/ 0\.7\)/);
    expect(ruleFor(".action-btn--on-dark:focus-visible")?.body).toMatch(/outline-color:\s*#ffffff/);
    expect(ruleFor(".action-btn--on-card:focus-visible")?.body).toMatch(/outline-color:\s*#ffffff/);
  });

  it("leaves the global rules and --brand untouched", () => {
    expect(ruleFor(":focus-visible")?.body).toMatch(/outline:\s*2px solid var\(--brand\)/);
    expect(ruleFor("*")?.body).toMatch(/border-color:\s*var\(--border\)/);
    expect(css).toMatch(/--brand:\s*#4338ca;/i);
  });

  it("each scoped selector is more specific than the global rule it must beat", () => {
    expect(higher(specificity(".action-btn:focus-visible"), specificity(":focus-visible"))).toBe(true);
    expect(higher(specificity(".action-btn--on-dark:focus-visible"), specificity(":focus-visible"))).toBe(true);
    expect(higher(specificity(".action-btn--on-dark"), specificity("*"))).toBe(true);
    expect(higher(specificity(".action-btn--on-card"), specificity("*"))).toBe(true);
  });

  it("cascade model: unlayered normal rules beat layered utilities, then specificity decides", () => {
    type Decl = { layered: boolean; spec: [number, number, number]; order: number; value: string };
    const winner = (decls: Decl[]) =>
      [...decls].sort((a, b) =>
        a.layered !== b.layered ? (a.layered ? 1 : -1) : higher(a.spec, b.spec) ? -1 : higher(b.spec, a.spec) ? 1 : b.order - a.order,
      )[0].value;
    const focusRing = winner([
      { layered: true, spec: specificity(".focus-visible\\:outline-action:focus-visible"), order: 0, value: "utility" },
      { layered: false, spec: specificity(":focus-visible"), order: 1, value: "global-indigo" },
      { layered: false, spec: specificity(".action-btn:focus-visible"), order: 2, value: "action-btn-navy" },
    ]);
    expect(focusRing).toBe("action-btn-navy");
    const border = winner([
      { layered: true, spec: [0, 1, 0], order: 0, value: "utility" },
      { layered: false, spec: specificity("*"), order: 1, value: "global" },
      { layered: false, spec: specificity(".action-btn--on-dark"), order: 2, value: "action-btn" },
    ]);
    expect(border).toBe("action-btn");
  });
});

describe("hero CTA overlay CSS", () => {
  const cta = ruleFor(".hero-cta")?.body ?? "";

  it("font never below 10px and scales with the image box", () => {
    expect(cta).toMatch(/font-size:\s*clamp\(10px,\s*0\.98cqw,\s*15px\)/);
  });

  it("is a navy button with white text and uses the action tokens", () => {
    expect(cta).toMatch(/background:\s*var\(--action\)/);
    expect(cta).toMatch(/color:\s*var\(--action-foreground\)/);
    expect(ruleFor(".hero-cta:hover")?.body).toMatch(/background:\s*var\(--action-hover\)/);
  });

  it("hit area is at least 44px tall via an invisible ::after", () => {
    expect(ruleFor(".hero-cta::after")?.body).toMatch(/height:\s*max\(100%,\s*44px\)/);
  });

  it("the long label is hidden when the image box is under 1000px", () => {
    expect(css).toMatch(/@container \(max-width: 999px\)\s*{\s*\.hero-cta-long\s*{\s*display:\s*none;/);
  });
});

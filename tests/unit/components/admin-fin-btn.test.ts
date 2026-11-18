import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const theme = readFileSync(join(process.cwd(), "features/admin/premium/theme.ts"), "utf8");
const rule = (selector: string) => {
  const line = theme.split("\n").find((l) => l.startsWith(selector));
  return line ?? "";
};

describe("admin .fin-btn is navy and --blue is kept for charts", () => {
  it(".fin-btn uses --action (with the navy fallback), not --blue", () => {
    const base = rule(".fin-btn{");
    expect(base).toContain("background:var(--action,#172b4d)");
    expect(base).not.toContain("var(--blue)");
    expect(base).toContain("color:#fff");
    expect(base).toContain("min-height:48px");
  });

  it("has a navy hover (not for disabled/ghost) and a navy focus ring", () => {
    expect(rule(".fin-btn:hover")).toContain("var(--action-hover,#243f68)");
    expect(rule(".fin-btn:hover")).toContain(":not([disabled]):not(.ghost)");
    expect(rule(".fin-btn:focus-visible")).toContain("outline:2px solid var(--action,#172b4d)");
  });

  it("disabled and ghost buttons keep their muted look", () => {
    expect(rule(".fin-btn[disabled]")).toContain("background:#e7e9f1");
    expect(rule(".fin-btn.ghost")).toContain("background:#eef0f6");
  });

  it("--blue / --cyan stay #4338ca so the chart palette is unchanged", () => {
    expect(theme).toContain("--blue:#4338ca");
    expect(theme).toContain("--cyan:#4338ca");
  });
});

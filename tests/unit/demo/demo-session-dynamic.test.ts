import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("demo session helper stays dynamic", () => {
  it("reads cookies() before the secret check, so /demo pages are never prerendered at build time", () => {
    const src = readFileSync(path.resolve(__dirname, "../../../lib/demo/is-demo-request.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function getDemoSession"));
    expect(body.indexOf("await cookies()")).toBeGreaterThan(-1);
    expect(body.indexOf("await cookies()")).toBeLessThan(body.indexOf("sessionSecret"));
  });
});

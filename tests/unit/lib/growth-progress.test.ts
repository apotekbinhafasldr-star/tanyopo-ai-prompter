import { describe, expect, it } from "vitest";
import { computeGrowthProgress } from "@/lib/growth-progress";

describe("computeGrowthProgress", () => {
  it("returns null percent/remaining when no snapshot has been logged", () => {
    const result = computeGrowthProgress({ current: null, target: 1000 });
    expect(result.percent).toBeNull();
    expect(result.remaining).toBeNull();
    expect(result.reached).toBe(false);
  });

  it("computes percent and remaining toward a target", () => {
    const result = computeGrowthProgress({ current: 250, target: 1000 });
    expect(result.percent).toBe(25);
    expect(result.remaining).toBe(750);
    expect(result.reached).toBe(false);
  });

  it("clamps percent at 100 and remaining at 0 when the target is exceeded", () => {
    const result = computeGrowthProgress({ current: 1500, target: 1000 });
    expect(result.percent).toBe(100);
    expect(result.remaining).toBe(0);
    expect(result.reached).toBe(true);
  });

  it("marks reached when current equals target exactly", () => {
    const result = computeGrowthProgress({ current: 1000, target: 1000 });
    expect(result.reached).toBe(true);
    expect(result.percent).toBe(100);
  });

  it("handles a target of zero without dividing by zero", () => {
    const result = computeGrowthProgress({ current: 5, target: 0 });
    expect(result.percent).toBe(100);
    expect(result.reached).toBe(true);
  });
});

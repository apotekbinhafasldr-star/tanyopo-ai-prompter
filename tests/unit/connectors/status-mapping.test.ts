import { describe, expect, it } from "vitest";
import { toDisplayStatus } from "@/lib/connectors/status-mapping";

describe("toDisplayStatus — connection-state transitions", () => {
  it("is NOT_CONFIGURED when credentials are absent, regardless of stored status", () => {
    expect(toDisplayStatus(false, null)).toBe("NOT_CONFIGURED");
    expect(toDisplayStatus(false, "CONNECTED")).toBe("NOT_CONFIGURED");
  });

  it("is NOT_CONNECTED when configured but no row exists yet", () => {
    expect(toDisplayStatus(true, null)).toBe("NOT_CONNECTED");
  });

  it("maps a DISCONNECTED row to NOT_CONNECTED", () => {
    expect(toDisplayStatus(true, "DISCONNECTED")).toBe("NOT_CONNECTED");
  });

  it("passes through CONNECTED, EXPIRED, and ACTION_REQUIRED unchanged", () => {
    expect(toDisplayStatus(true, "CONNECTED")).toBe("CONNECTED");
    expect(toDisplayStatus(true, "EXPIRED")).toBe("EXPIRED");
    expect(toDisplayStatus(true, "ACTION_REQUIRED")).toBe("ACTION_REQUIRED");
  });

  it("never returns CONNECTED unless both configured and stored as CONNECTED", () => {
    const allInputs: Array<[boolean, "CONNECTED" | "EXPIRED" | "ACTION_REQUIRED" | "DISCONNECTED" | null]> = [
      [false, null],
      [false, "CONNECTED"],
      [false, "EXPIRED"],
      [true, null],
      [true, "DISCONNECTED"],
      [true, "EXPIRED"],
      [true, "ACTION_REQUIRED"],
    ];
    for (const [configured, stored] of allInputs) {
      expect(toDisplayStatus(configured, stored)).not.toBe("CONNECTED");
    }
  });
});

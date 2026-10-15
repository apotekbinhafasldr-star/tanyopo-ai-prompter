import { describe, expect, it } from "vitest";
import { ConnectorApiError, ConnectorConfigError } from "@/lib/connectors/types";
import {
  LaunchDatabaseError,
  LaunchUncertainResultError,
  LAUNCH_IN_PROGRESS_NOTE,
  buildProgressNote,
  classifyCreateFailure,
  describeLaunchFailure,
  requireCreatedId,
} from "@/lib/campaigns/launch-reconciliation";

describe("requireCreatedId", () => {
  it("returns a usable id", () => {
    expect(requireCreatedId({ id: "123" }, "createCampaign")).toBe("123");
  });
  it.each([undefined, null, {}, { id: "" }, { id: "  " }, { id: 5 }])("treats %j as an uncertain result", (value) => {
    expect(() => requireCreatedId(value, "createAd")).toThrow(LaunchUncertainResultError);
  });
});

describe("classifyCreateFailure", () => {
  it("treats a plain network error as UNCERTAIN (never retried)", () => {
    expect(classifyCreateFailure(new Error("ECONNRESET"))).toBe("UNCERTAIN");
  });
  it("treats our own config error as NOT_CREATED", () => {
    expect(classifyCreateFailure(new ConnectorConfigError("Page belum dipilih"))).toBe("NOT_CREATED");
  });
});

describe("describeLaunchFailure", () => {
  it("never leaks a provider message", () => {
    const err = new Error("secret-token-EAAB failed");
    const failure = describeLaunchFailure("createAdSet", err, { campaignId: "c1" });
    expect(failure.message).not.toContain("secret-token");
    expect(failure.message).toContain("campaign=c1");
    expect(failure.releasable).toBe(false);
    expect(failure.certainty).toBe("UNCERTAIN");
  });
  it("is releasable only for a definitive rejection of the first call with nothing created", () => {
    const failure = describeLaunchFailure("createCampaign", new ConnectorConfigError("x"), {});
    expect(failure.releasable).toBe(true);
    expect(describeLaunchFailure("createCampaign", new Error("timeout"), {}).releasable).toBe(false);
    expect(describeLaunchFailure("createAdSet", new ConnectorConfigError("x"), { campaignId: "c1" }).releasable).toBe(false);
  });
  it("marks database failures as DATABASE and blocks relaunch", () => {
    const failure = describeLaunchFailure("saveResult", new LaunchDatabaseError("progres peluncuran"), { campaignId: "c1" });
    expect(failure.certainty).toBe("DATABASE");
    expect(failure.releasable).toBe(false);
    expect(failure.message).toContain("diblokir");
  });
});

describe("progress note", () => {
  it("is the plain in-progress note when nothing exists", () => {
    expect(buildProgressNote({})).toBe(LAUNCH_IN_PROGRESS_NOTE);
  });
  it("lists the created ids", () => {
    expect(buildProgressNote({ campaignId: "c", adSetId: "a" })).toContain("campaign=c, adset=a");
  });
});

describe("classifyCreateFailure — structured platform answers", () => {
  it("a 4xx answer means the object was not created", () => {
    expect(classifyCreateFailure(new ConnectorApiError("META", "x", { status: 400 }))).toBe("NOT_CREATED");
  });
  it("408, 5xx and a missing status stay UNCERTAIN", () => {
    expect(classifyCreateFailure(new ConnectorApiError("META", "x", { status: 408 }))).toBe("UNCERTAIN");
    expect(classifyCreateFailure(new ConnectorApiError("META", "x", { status: 500 }))).toBe("UNCERTAIN");
    expect(classifyCreateFailure(new ConnectorApiError("META", "x"))).toBe("UNCERTAIN");
  });
});

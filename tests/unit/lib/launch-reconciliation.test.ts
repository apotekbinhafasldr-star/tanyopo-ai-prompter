import { describe, expect, it } from "vitest";
import { ConnectorApiError, ConnectorConfigError } from "@/lib/connectors/types";
import {
  LaunchDatabaseError,
  LaunchFenceLostError,
  LaunchStopError,
  LaunchUncertainResultError,
  LAUNCH_IN_PROGRESS_NOTE,
  MAX_OBJECT_NAME_LENGTH,
  buildClaimNote,
  buildIntentNote,
  buildProgressNote,
  classifyCreateFailure,
  correlationToken,
  describeLaunchFailure,
  extractLaunchNonce,
  launchAttemptTag,
  newLaunchNonce,
  nonceMarker,
  requireCreatedId,
  withCorrelationToken,
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
    expect(classifyCreateFailure(new ConnectorConfigError("META", "Page belum dipilih"))).toBe("NOT_CREATED");
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
    const failure = describeLaunchFailure("createCampaign", new ConnectorConfigError("META", "x"), {});
    expect(failure.releasable).toBe(true);
    expect(describeLaunchFailure("createCampaign", new Error("timeout"), {}).releasable).toBe(false);
    expect(describeLaunchFailure("createAdSet", new ConnectorConfigError("META", "x"), { campaignId: "c1" }).releasable).toBe(false);
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

describe("H2-A: nonce, marker and correlation tokens", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("creates a valid, unique nonce per attempt", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const n = newLaunchNonce();
      expect(n).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      seen.add(n);
    }
    expect(seen.size).toBe(200);
  });

  it("round-trips the ownership marker and rejects malformed nonces", () => {
    expect(extractLaunchNonce(buildClaimNote(A))).toBe(A);
    expect(extractLaunchNonce(`${LAUNCH_IN_PROGRESS_NOTE}`)).toBeNull();
    expect(extractLaunchNonce(null)).toBeNull();
    expect(() => nonceMarker("not-a-uuid")).toThrow();
    expect(() => nonceMarker(`${A}'; drop table x;--`)).toThrow();
    expect(() => correlationToken("short", "ad")).toThrow();
  });

  it("the claim note starts with the in-progress text and ends with the marker", () => {
    const note = buildClaimNote(A);
    expect(note.startsWith(LAUNCH_IN_PROGRESS_NOTE)).toBe(true);
    expect(note.endsWith(`[LNE:${A}]`)).toBe(true);
  });

  it("tokens are short, stable per attempt+object and distinct per attempt and per object", () => {
    expect(launchAttemptTag(A)).toBe("AAAAAAAA");
    expect(correlationToken(A, "campaign")).toBe("LNE-AAAAAAAA-C");
    expect(correlationToken(A, "adSet")).toBe("LNE-AAAAAAAA-S");
    expect(correlationToken(A, "creative")).toBe("LNE-AAAAAAAA-R");
    expect(correlationToken(A, "ad")).toBe("LNE-AAAAAAAA-A");
    expect(correlationToken(A, "ad")).toBe(correlationToken(A, "ad"));
    expect(correlationToken(B, "ad")).not.toBe(correlationToken(A, "ad"));
  });

  it("appends the token as a recognisable suffix", () => {
    expect(withCorrelationToken("Promo", "campaign", A)).toBe("Promo [LNE-AAAAAAAA-C]");
    expect(withCorrelationToken("Promo", "adSet", A, "Ad Set")).toBe("Promo — Ad Set [LNE-AAAAAAAA-S]");
  });

  it("truncates long and astral-plane names by code point while the token stays intact", () => {
    const long = "😀".repeat(500);
    const name = withCorrelationToken(long, "ad", A, "Ad");
    expect(Array.from(name).length).toBeLessThanOrEqual(MAX_OBJECT_NAME_LENGTH);
    expect(name.endsWith(" — Ad [LNE-AAAAAAAA-A]")).toBe(true);
    expect(name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    const plain = withCorrelationToken("x".repeat(1000), "creative", A, "Creative");
    expect(plain.length).toBeLessThanOrEqual(MAX_OBJECT_NAME_LENGTH);
    expect(plain.endsWith("[LNE-AAAAAAAA-R]")).toBe(true);
  });

  it("the intent note names the step, the token, known ids and the marker", () => {
    const note = buildIntentNote("createAdSet", { campaignId: "111" } as never, A, "LNE-AAAAAAAA-S");
    expect(note).toContain("LNE-AAAAAAAA-S");
    expect(note).toContain("111");
    expect(note).toContain("TIDAK PASTI");
    expect(note.endsWith(`[LNE:${A}]`)).toBe(true);
  });

  it("the progress note without a nonce is unchanged; with a nonce it ends with the marker", () => {
    expect(buildProgressNote({})).toBe(LAUNCH_IN_PROGRESS_NOTE);
    expect(buildProgressNote({ campaignId: "1" } as never, A).endsWith(`[LNE:${A}]`)).toBe(true);
  });
});

describe("H2-B/C: failure classification for stop and lost ownership", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ctx = { nonce: A, tokenInNames: true };

  it("Emergency Stop (active or unreadable) is NOT_ATTEMPTED and never releasable, even before the first create", () => {
    for (const reason of ["ACTIVE", "UNREADABLE"] as const) {
      const f = describeLaunchFailure("createCampaign", new LaunchStopError(reason), {}, ctx);
      expect(f.certainty).toBe("NOT_ATTEMPTED");
      expect(f.releasable).toBe(false);
      expect(f.message).toContain("Peluncuran ulang diblokir");
      expect(f.message).toContain("LNE-AAAAAAAA-*");
    }
  });

  it("a failed intent write is NOT_ATTEMPTED; a failed result write stays DATABASE", () => {
    expect(describeLaunchFailure("createAd", new LaunchDatabaseError("niat pembuatan", true), {}, ctx).certainty).toBe("NOT_ATTEMPTED");
    expect(describeLaunchFailure("createAd", new LaunchDatabaseError("progres peluncuran"), {}, ctx).certainty).toBe("DATABASE");
  });

  it("lost ownership is FENCE_LOST, never releasable, and does not claim the row is blocked by this attempt", () => {
    const f = describeLaunchFailure("createCreative", new LaunchFenceLostError("progres peluncuran"), { campaignId: "1" } as never, ctx);
    expect(f.certainty).toBe("FENCE_LOST");
    expect(f.releasable).toBe(false);
    expect(f.message).not.toContain("Peluncuran ulang diblokir");
  });

  it("still releases only a definitive 4xx on the first call with nothing created", () => {
    const err = new ConnectorApiError("META", "x", { status: 400 });
    expect(describeLaunchFailure("createCampaign", err, {}, ctx).releasable).toBe(true);
    expect(describeLaunchFailure("createAdSet", err, {}, ctx).releasable).toBe(false);
  });

  it("never leaks provider text and always carries the nonce marker when an attempt is given", () => {
    const f = describeLaunchFailure("createCampaign", new Error("secret provider text"), {}, ctx);
    expect(f.message).not.toContain("secret provider text");
    expect(f.message.endsWith(`[LNE:${A}]`)).toBe(true);
  });
});

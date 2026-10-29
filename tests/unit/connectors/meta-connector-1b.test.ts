import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  serverEnv: {
    meta: { appId: "app123", appSecret: "secret123", redirectUri: "https://app.example.com/callback", loginConfigId: undefined },
  },
  isConnectorConfigured: (credentials: Record<string, string | undefined>) =>
    Object.values(credentials).every((v) => !!v && v.length > 0),
}));

import { MetaConnector } from "@/lib/connectors/meta-connector";
import { ConnectorConfigError } from "@/lib/connectors/types";

/** A local fetch double. Nothing here ever reaches the network or Meta. */
function stubFetchOk() {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: "obj_1" }) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sentBody = (fetchMock: ReturnType<typeof stubFetchOk>): any =>
  JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

afterEach(() => vi.unstubAllGlobals());

describe("MetaConnector#createAdSet — Phase 1B age targeting", () => {
  const base = { campaignId: "c1", name: "AS", dailyBudgetMinorUnits: 50000, targetingCountries: ["ID"], optimizationGoal: "REACH" };

  it("sends age_min and age_max next to the countries when a valid range is given", async () => {
    const fetchMock = stubFetchOk();
    await new MetaConnector().createAdSet("tok", "act_1", { ...base, ageMin: 23, ageMax: 50 });
    const body = sentBody(fetchMock);
    expect(body.targeting).toEqual({ geo_locations: { countries: ["ID"] }, age_min: 23, age_max: 50 });
    expect(body.status).toBe("PAUSED");
  });

  it("accepts the boundaries 18 and 65 and equal ages", async () => {
    for (const [ageMin, ageMax] of [[18, 65], [30, 30]]) {
      const fetchMock = stubFetchOk();
      await new MetaConnector().createAdSet("tok", "act_1", { ...base, ageMin, ageMax });
      expect(sentBody(fetchMock).targeting).toMatchObject({ age_min: ageMin, age_max: ageMax });
    }
  });

  it("adds NOTHING when no age is given: the payload is exactly what it was before Phase 1B", async () => {
    const fetchMock = stubFetchOk();
    await new MetaConnector().createAdSet("tok", "act_1", base);
    expect(sentBody(fetchMock).targeting).toEqual({ geo_locations: { countries: ["ID"] } });
  });

  it.each([
    [17, 50],
    [23, 66],
    [51, 50],
    [23.5, 50],
    [23, 50.5],
    [Number.NaN, 50],
    [23, Number.POSITIVE_INFINITY],
    ["23", 50],
    [null, 50],
    [23, undefined],
    [undefined, 50],
    [0, 0],
    [-1, 50],
  ])("refuses ages %j/%j before any request", async (ageMin, ageMax) => {
    const fetchMock = stubFetchOk();
    const failure = await new MetaConnector()
      .createAdSet("tok", "act_1", { ...base, ageMin: ageMin as number, ageMax: ageMax as number })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ConnectorConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("valid ages do not unlock an unverified goal: LINK_CLICKS is still refused", async () => {
    const fetchMock = stubFetchOk();
    const failure = await new MetaConnector()
      .createAdSet("tok", "act_1", { ...base, optimizationGoal: "LINK_CLICKS", ageMin: 23, ageMax: 50 })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ConnectorConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MetaConnector#createCreative — Phase 1B CTA allowlist", () => {
  const base = {
    name: "C",
    headline: "H",
    primaryText: "P",
    pageId: "page_1",
    linkUrl: "https://toko-saya.co.id/produk",
    imageUrl: "https://proj.supabase.co/storage/v1/object/public/product-media/t1/p1/a.jpg",
  };

  it.each(["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "CONTACT_US", "ORDER_NOW"])("maps the allowlisted CTA %s", async (cta) => {
    const fetchMock = stubFetchOk();
    await new MetaConnector().createCreative("tok", "act_1", { ...base, cta });
    expect(sentBody(fetchMock).object_story_spec.link_data.call_to_action).toEqual({ type: cta, value: { link: base.linkUrl } });
  });

  it.each(["Pelajari", "shop_now", " SHOP_NOW", "BUY_NOW", "", "constructor", "__proto__", "toString", "hasOwnProperty"])(
    "anything else (%j) keeps the previous behaviour: LEARN_MORE",
    async (cta) => {
      const fetchMock = stubFetchOk();
      await new MetaConnector().createCreative("tok", "act_1", { ...base, cta });
      expect(sentBody(fetchMock).object_story_spec.link_data.call_to_action.type).toBe("LEARN_MORE");
    },
  );

  it("the CTA link is still the same landing link, and the other fields are unchanged", async () => {
    const fetchMock = stubFetchOk();
    await new MetaConnector().createCreative("tok", "act_1", { ...base, cta: "SHOP_NOW" });
    const linkData = sentBody(fetchMock).object_story_spec.link_data;
    expect(linkData).toMatchObject({ message: "P", name: "H", link: base.linkUrl, picture: base.imageUrl });
    expect(linkData.call_to_action.value.link).toBe(linkData.link);
  });
});

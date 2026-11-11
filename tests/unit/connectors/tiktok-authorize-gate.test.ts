// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  connector: null as null | { isConfigured: () => boolean },
  sharedHandler: vi.fn(),
}));

vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: () => h.connector }));
vi.mock("@/lib/connectors/oauth-authorize", () => ({ handleConnectorOauthAuthorize: h.sharedHandler }));

import { GET } from "@/app/api/connections/tiktok/authorize/route";

const call = () => GET(new NextRequest("https://app.example/api/connections/tiktok/authorize"));
const errorOf = (res: Response) => new URL(res.headers.get("location") as string).searchParams.get("error");

describe("TikTok authorize route gate (fail-closed)", () => {
  beforeEach(() => {
    h.sharedHandler.mockReset();
    h.connector = { isConfigured: () => true };
  });

  it("does not start OAuth while provider approval is pending, even with credentials", async () => {
    const res = await call();
    expect(errorOf(res)).toBe("provider_pending");
    expect(h.sharedHandler).not.toHaveBeenCalled();
  });

  it("reports not_configured without credentials", async () => {
    h.connector = { isConfigured: () => false };
    expect(errorOf(await call())).toBe("not_configured");
    expect(h.sharedHandler).not.toHaveBeenCalled();
  });

  it("reports not_available without a connector", async () => {
    h.connector = null;
    expect(errorOf(await call())).toBe("not_available");
    expect(h.sharedHandler).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { tiktokRedirectUriProblem } from "@/lib/connectors/tiktok-redirect";

const OK = "https://app.example.com/api/connections/tiktok/callback";

describe("tiktokRedirectUriProblem", () => {
  it("accepts only the exact https callback URL", () => {
    expect(tiktokRedirectUriProblem(OK)).toBeNull();
  });

  it("rejects empty, malformed, http, query, fragment, wrong path, credentials and over-long values", () => {
    expect(tiktokRedirectUriProblem(undefined)).toBe("invalid_url");
    expect(tiktokRedirectUriProblem("not a url")).toBe("invalid_url");
    expect(tiktokRedirectUriProblem("http://app.example.com/api/connections/tiktok/callback")).toBe("not_https");
    expect(tiktokRedirectUriProblem("https://u:p@app.example.com/api/connections/tiktok/callback")).toBe("not_https");
    expect(tiktokRedirectUriProblem(`${OK}?a=1`)).toBe("has_query_or_fragment");
    expect(tiktokRedirectUriProblem(`${OK}#x`)).toBe("has_query_or_fragment");
    expect(tiktokRedirectUriProblem(`${OK}?`)).toBe("has_query_or_fragment");
    expect(tiktokRedirectUriProblem("https://app.example.com/api/connections/meta/callback")).toBe("wrong_path");
    expect(tiktokRedirectUriProblem(`${OK}/`)).toBe("wrong_path");
    expect(tiktokRedirectUriProblem(`https://app.example.com/${"a".repeat(520)}`)).toBe("too_long");
  });
});

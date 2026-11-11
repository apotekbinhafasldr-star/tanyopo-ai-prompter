// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildXAuthorizationUrl, deriveCodeChallenge, generatePkcePair } from "@/lib/connectors/x-pkce";

describe("x-pkce", () => {
  it("menurunkan challenge S256 sesuai contoh RFC 7636 Appendix B", () => {
    expect(deriveCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("menghasilkan verifier 43 karakter base64url dan challenge yang cocok", () => {
    const pair = generatePkcePair();
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.codeChallengeMethod).toBe("S256");
    expect(pair.codeChallenge).toBe(createHash("sha256").update(pair.codeVerifier).digest("base64url"));
  });

  it("verifier berbeda setiap kali", () => {
    expect(generatePkcePair().codeVerifier).not.toBe(generatePkcePair().codeVerifier);
  });

  it("membangun URL otorisasi di x.com dengan PKCE S256 dan scope publikasi", () => {
    const url = new URL(
      buildXAuthorizationUrl({
        clientId: "cid",
        redirectUri: "https://app.example/cb",
        scopes: ["tweet.read", "tweet.write", "offline.access"],
        state: "st",
        codeChallenge: "chal",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/cb");
    expect(url.searchParams.get("scope")).toBe("tweet.read tweet.write offline.access");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("menolak challenge kosong dan state di luar 1-500 karakter", () => {
    const base = { clientId: "c", redirectUri: "https://a/b", scopes: ["tweet.read"], state: "s", codeChallenge: "x" };
    expect(() => buildXAuthorizationUrl({ ...base, codeChallenge: "" })).toThrow();
    expect(() => buildXAuthorizationUrl({ ...base, state: "" })).toThrow();
    expect(() => buildXAuthorizationUrl({ ...base, state: "a".repeat(501) })).toThrow();
  });
});

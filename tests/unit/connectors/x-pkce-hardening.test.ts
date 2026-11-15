// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { deriveCodeChallenge, generatePkcePair, isValidXRedirectUri } from "@/lib/connectors/x-pkce";
import { X_CONNECT_SCOPES, X_PUBLISH_SCOPES, createXClient } from "@/lib/connectors/x-api-client";

describe("PKCE RFC 7636", () => {
  it("vektor Appendix B: verifier -> challenge S256", () => {
    expect(deriveCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("vektor Appendix B: octet sequence -> verifier base64url", () => {
    const octets = Buffer.from([
      116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240,
      91, 88, 5, 88, 83, 132, 141, 121,
    ]);
    expect(octets.toString("base64url")).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  });

  it("verifier acak 43-128 karakter [A-Za-z0-9-._~], challenge = base64url(sha256(verifier)), selalu S256", () => {
    for (let i = 0; i < 20; i += 1) {
      const pair = generatePkcePair(randomBytes);
      expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
      expect(pair.codeChallenge).toBe(createHash("sha256").update(pair.codeVerifier).digest("base64url"));
      expect(pair.codeChallengeMethod).toBe("S256");
    }
  });
});

describe("scope minimum", () => {
  it("alur Hubungkan hanya meminta baca identitas + offline.access, tanpa izin tulis", () => {
    expect([...X_CONNECT_SCOPES].sort()).toEqual(["offline.access", "tweet.read", "users.read"]);
    expect(X_CONNECT_SCOPES).not.toContain("tweet.write");
    expect(X_CONNECT_SCOPES).not.toContain("media.write");
    // Scope posting tetap terdokumentasi untuk nanti, tetapi tidak dipakai Hubungkan.
    expect(X_PUBLISH_SCOPES).toContain("tweet.write");
  });
});

describe("redirect URI persis", () => {
  it("menerima https + path callback aplikasi, dan http hanya untuk localhost", () => {
    expect(isValidXRedirectUri("https://app.example/api/connections/x/callback")).toBe(true);
    expect(isValidXRedirectUri("http://localhost:3000/api/connections/x/callback")).toBe(true);
  });

  it("menolak kosong, http non-lokal, path lain, query, fragment, kredensial, dan trailing slash", () => {
    for (const bad of [
      undefined,
      "",
      "not a url",
      "http://app.example/api/connections/x/callback",
      "https://app.example/cb",
      "https://app.example/api/connections/x/callback/",
      "https://app.example/api/connections/x/callback?a=1",
      "https://app.example/api/connections/x/callback#f",
      "https://u:p@app.example/api/connections/x/callback",
    ]) {
      expect(isValidXRedirectUri(bad)).toBe(false);
    }
  });
});

describe("penukaran token (fetch palsu)", () => {
  it("memakai Basic auth, grant_type authorization_code, redirect_uri persis, code_verifier; tidak diulang saat gagal", async () => {
    const calls: { url: string; auth: string | undefined; body: URLSearchParams }[] = [];
    const client = createXClient({
      fetch: async (url, init) => {
        calls.push({
          url,
          auth: (init?.headers as Record<string, string>).Authorization,
          body: new URLSearchParams(String(init?.body)),
        });
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      },
      sleep: async () => {},
    });
    const redirectUri = "https://app.example/api/connections/x/callback";
    await expect(
      client.exchangeCode({ clientId: "cid", clientSecret: "sec", redirectUri, code: "C", codeVerifier: "V".repeat(43) }),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.x.com/2/oauth2/token");
    expect(calls[0].auth).toBe(`Basic ${Buffer.from("cid:sec").toString("base64")}`);
    expect(calls[0].body.get("grant_type")).toBe("authorization_code");
    expect(calls[0].body.get("redirect_uri")).toBe(redirectUri);
    expect(calls[0].body.get("code_verifier")).toBe("V".repeat(43));
    expect(calls[0].body.get("code")).toBe("C");
  });
});

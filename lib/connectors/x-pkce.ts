import { createHash, randomBytes } from "node:crypto";

/**
 * PKCE (RFC 7636) + pembuat URL otorisasi X — fungsi murni, tanpa jaringan.
 *
 * Dokumentasi resmi X (https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code.md,
 * diakses 2026-11-11) mencantumkan `code_challenge` dan `code_challenge_method`
 * (`S256` atau `plain`) pada URL otorisasi `https://x.com/i/oauth2/authorize`.
 * Aturan panjang/karakter `code_verifier` TIDAK dijelaskan di halaman itu, jadi
 * di sini memakai RFC 7636: 32 byte acak -> 43 karakter base64url. Selalu S256.
 */

export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";

export interface XPkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export function deriveCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

export function generatePkcePair(randomSource: (size: number) => Buffer = randomBytes): XPkcePair {
  const codeVerifier = randomSource(32).toString("base64url");
  return { codeVerifier, codeChallenge: deriveCodeChallenge(codeVerifier), codeChallengeMethod: "S256" };
}

export interface XAuthorizationUrlInput {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  codeChallenge: string;
}

/** `state` maksimal 500 karakter menurut dokumentasi X. */
export function buildXAuthorizationUrl(input: XAuthorizationUrlInput): string {
  if (!input.codeChallenge) throw new Error("code_challenge wajib untuk X (PKCE).");
  if (input.state.length === 0 || input.state.length > 500) {
    throw new Error("state X harus 1-500 karakter.");
  }
  const url = new URL(X_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** Path callback tetap aplikasi (app/api/connections/x/callback/route.ts). */
export const X_CALLBACK_PATH = "/api/connections/x/callback";

/**
 * X mewajibkan `redirect_uri` PERSIS sama dengan Callback URL di App
 * (exact-match). Di sini hanya memastikan nilai env masuk akal: https
 * (http hanya untuk localhost), tanpa query/fragment/kredensial, dan path =
 * route callback kita. Salah satu gagal -> konektor dianggap belum
 * dikonfigurasi (fail-closed) daripada mengirim pengguna ke halaman error X.
 */
export function isValidXRedirectUri(value: string | undefined): boolean {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return false;
  if (url.search || url.hash || url.username || url.password) return false;
  return url.pathname === X_CALLBACK_PATH;
}

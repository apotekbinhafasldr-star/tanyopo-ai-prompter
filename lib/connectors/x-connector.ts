import "server-only";

import { serverEnv, isConnectorConfigured } from "@/lib/env";
import {
  ConnectorConfigError,
  type ConnectorAccount,
  type ConnectorInsights,
  type ConnectorTokenResult,
  type PlatformConnector,
} from "@/lib/connectors/types";
import { buildXAuthorizationUrl } from "@/lib/connectors/x-pkce";
import {
  X_PUBLISH_SCOPES,
  createXClient,
  type XClient,
  type XMediaCategory,
  type XTokenSet,
} from "@/lib/connectors/x-api-client";

/**
 * Konektor X (Twitter). Status: CODE READY + UNIT TEST PASS (fetch palsu);
 * BELUM diuji terhadap X sungguhan. Detail, biaya, dan blocker: docs/X_INTEGRATION.md.
 *
 * Hasil audit terhadap dokumentasi resmi X (diakses 2026-11-11):
 *
 * 1. X Ads API (`https://ads-api.x.com`) hanya mendokumentasikan OAuth 1.0a
 *    dan butuh persetujuan akses Ads untuk aplikasi
 *    (https://docs.x.com/x-ads-api/fundamentals/making-authenticated-requests.md).
 *    Konektor lama memakai host `ads-api.twitter.com` dengan token OAuth 2.0
 *    Bearer — kombinasi yang tidak terdokumentasi. Semua operasi iklan
 *    (kampanye, ad set, creative, ad, statistik iklan, jeda, anggaran)
 *    sekarang FAIL-CLOSED dengan ConnectorConfigError, bukan mengirim
 *    permintaan yang tidak bisa dibuktikan benar.
 * 2. OAuth 2.0 X memakai PKCE (`code_challenge`). Antarmuka bersama
 *    `PlatformConnector.getAuthorizationUrl(state)` / `exchangeCodeForToken(code)`
 *    tidak membawa `code_verifier`, dan menyimpannya butuh perubahan di
 *    jalur OAuth bersama (oauth-authorize/oauth-callback), yang terlarang
 *    untuk diubah tanpa persetujuan Founder. Maka jalur bersama TIDAK
 *    dihubungkan: kedua metode itu melempar ConnectorConfigError dan
 *    `isConfigured()` tetap false. Bagian X-spesifik yang sudah siap dan
 *    teruji: `getAuthorizationUrlWithPkce` dan `exchangeCodeForTokenWithPkce`.
 * 3. Posting organik (teks/gambar/video) tersedia lewat `publishPost` /
 *    `uploadMedia`, tetapi belum dipanggil dari mana pun di aplikasi dan
 *    capability PUBLISH_CONTENT tetap nonaktif.
 */

/**
 * Saklar fail-closed: tetap `false` sampai penyimpanan code_verifier di jalur
 * OAuth bersama disetujui dan diimplementasikan (lihat docs/X_INTEGRATION.md).
 */
const X_OAUTH_PKCE_WIRED = false;

const PKCE_BLOCKED_MESSAGE =
  "Alur OAuth X membutuhkan PKCE (code_verifier) yang belum tersambung di jalur OAuth bersama — butuh persetujuan Founder (lihat docs/X_INTEGRATION.md). Koneksi X dinonaktifkan sampai itu selesai.";

const ADS_UNSUPPORTED_MESSAGE =
  "Operasi iklan X belum didukung: X Ads API hanya mendokumentasikan OAuth 1.0a dan butuh persetujuan akses Ads, sedangkan koneksi X di aplikasi ini memakai OAuth 2.0. Tidak ada permintaan yang dikirim ke X.";

function toTokenResult(tokens: XTokenSet): ConnectorTokenResult {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    scopes: tokens.scopes.length ? tokens.scopes : [...X_PUBLISH_SCOPES],
    expiresAt: tokens.expiresInSeconds ? new Date(Date.now() + tokens.expiresInSeconds * 1000) : undefined,
  };
}

export class XConnector implements PlatformConnector {
  readonly platform = "X" as const;

  private readonly client: XClient;

  /** `client` dapat disuntik oleh tes; default memakai fetch global (dibaca saat dipanggil). */
  constructor(client?: XClient) {
    this.client = client ?? createXClient({ fetch: (input, init) => fetch(input, init) });
  }

  private hasCredentials(): boolean {
    return isConnectorConfigured({
      clientId: serverEnv.x.clientId,
      clientSecret: serverEnv.x.clientSecret,
      redirectUri: serverEnv.x.redirectUri,
    });
  }

  /** Siap dipakai penuh hanya bila kredensial ada DAN alur PKCE tersambung. */
  isConfigured(): boolean {
    return X_OAUTH_PKCE_WIRED && this.hasCredentials();
  }

  private requireCredentials() {
    if (!this.hasCredentials()) {
      throw new ConnectorConfigError(
        this.platform,
        "X connector belum dikonfigurasi. Tambahkan X_CLIENT_ID, X_CLIENT_SECRET, dan X_REDIRECT_URI.",
      );
    }
    return {
      clientId: serverEnv.x.clientId!,
      clientSecret: serverEnv.x.clientSecret!,
      redirectUri: serverEnv.x.redirectUri!,
    };
  }

  // --- OAuth -------------------------------------------------------------

  /** Jalur bersama: fail-closed sampai PKCE tersambung (lihat komentar atas file). */
  getAuthorizationUrl(_state: string): string {
    this.requireCredentials();
    throw new ConnectorConfigError(this.platform, PKCE_BLOCKED_MESSAGE);
  }

  /** Jalur bersama: fail-closed — tidak ada `code_verifier` di antarmuka ini. */
  async exchangeCodeForToken(_code: string): Promise<ConnectorTokenResult> {
    this.requireCredentials();
    throw new ConnectorConfigError(this.platform, PKCE_BLOCKED_MESSAGE);
  }

  /** Bagian X-spesifik yang siap dipakai setelah penyimpanan verifier disetujui. */
  getAuthorizationUrlWithPkce(state: string, codeChallenge: string): string {
    const { clientId, redirectUri } = this.requireCredentials();
    return buildXAuthorizationUrl({
      clientId,
      redirectUri,
      scopes: X_PUBLISH_SCOPES,
      state,
      codeChallenge,
    });
  }

  async exchangeCodeForTokenWithPkce(code: string, codeVerifier: string): Promise<ConnectorTokenResult> {
    const { clientId, clientSecret, redirectUri } = this.requireCredentials();
    return toTokenResult(await this.client.exchangeCode({ clientId, clientSecret, redirectUri, code, codeVerifier }));
  }

  async refreshAccessToken(refreshToken: string): Promise<ConnectorTokenResult> {
    const { clientId, clientSecret } = this.requireCredentials();
    return toTokenResult(await this.client.refreshToken({ clientId, clientSecret, refreshToken }));
  }

  async disconnect(accessToken: string): Promise<void> {
    const { clientId, clientSecret } = this.requireCredentials();
    await this.client.revokeToken({ clientId, clientSecret, token: accessToken, hint: "access_token" });
  }

  /**
   * Akun yang tersambung = akun X pemilik token (GET /2/users/me), BUKAN akun
   * iklan: X Ads API tidak dapat diakses dengan token OAuth 2.0 ini.
   */
  async getAccounts(accessToken: string): Promise<ConnectorAccount[]> {
    this.requireCredentials();
    const me = await this.client.getMe(accessToken);
    return [{ id: me.id, name: `@${me.username}` }];
  }

  // --- Posting organik (belum dipanggil dari UI/aksi mana pun) ----------

  async uploadMedia(
    accessToken: string,
    input: { bytes: Uint8Array; mediaType: string; category: XMediaCategory },
  ): Promise<{ mediaId: string }> {
    this.requireCredentials();
    return this.client.uploadMedia(accessToken, input);
  }

  async publishPost(
    accessToken: string,
    input: { text?: string; mediaIds?: string[] },
  ): Promise<{ id: string; text: string }> {
    this.requireCredentials();
    return this.client.createPost(accessToken, input);
  }

  async getPostMetrics(accessToken: string, postId: string) {
    this.requireCredentials();
    return this.client.getPostMetrics(accessToken, postId);
  }

  // --- Iklan: fail-closed -------------------------------------------------

  private unsupportedAds(): never {
    throw new ConnectorConfigError(this.platform, ADS_UNSUPPORTED_MESSAGE);
  }

  async createCampaign(): Promise<{ id: string }> {
    return this.unsupportedAds();
  }

  async createAdSet(): Promise<{ id: string }> {
    return this.unsupportedAds();
  }

  async createCreative(): Promise<{ id: string }> {
    return this.unsupportedAds();
  }

  async createAd(): Promise<{ id: string }> {
    return this.unsupportedAds();
  }

  async getInsights(): Promise<ConnectorInsights> {
    return this.unsupportedAds();
  }

  async pauseCampaign(): Promise<void> {
    return this.unsupportedAds();
  }

  async updateBudget(): Promise<void> {
    return this.unsupportedAds();
  }
}

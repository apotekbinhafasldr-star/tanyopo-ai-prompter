// @vitest-environment node
/**
 * QA/Security (2026-11-11) — abuse controls on the unauthenticated auth actions. SEC-01 and SEC-02 are FIXED in this
 * change; these tests now pin the SAFE behavior (they were "known gap" pins in #139) and drive the real server actions
 * with the real in-memory limiter. Supabase and next/* are mocked; there is no network and no database.
 *
 *  SEC-01  registerAction / verifyEmailOtpAction / resendSignupOtpAction key their per-IP limiters on the trusted IP
 *          only (x-nf-client-connection-ip, validated, IPv6 as /64). A forged x-forwarded-for neither creates fresh
 *          buckets nor spends a real user's bucket. With no trusted IP, all such requests share ONE bucket.
 *  SEC-02  loginAction counts failed sign-ins per IP+email and per IP (never per email alone), answers one generic
 *          message, resets the IP+email bucket on success, and fails open if the limiter itself breaks.
 *
 * Label: CODE + UNIT TEST (mocked Supabase). Not E2E.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const { hdr, signIn, signUp, getUser, verifyOtp, resend, rl } = vi.hoisted(() => ({
  hdr: { current: new Headers() },
  signIn: vi.fn(),
  signUp: vi.fn(),
  getUser: vi.fn(),
  verifyOtp: vi.fn(),
  resend: vi.fn(),
  rl: { peekThrows: false },
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => hdr.current) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { signInWithPassword: signIn, signUp, getUser, verifyOtp, resend },
  })),
}));
// Real limiter; only the peek can be made to throw (fail-safe test).
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    peekRateLimit: (...args: Parameters<typeof actual.peekRateLimit>) => {
      if (rl.peekThrows) throw new Error("limiter down");
      return actual.peekRateLimit(...args);
    },
  };
});

import { loginAction, registerAction } from "@/features/auth/actions";
import { resendSignupOtpAction, verifyEmailOtpAction } from "@/features/auth/otp-actions";
import { OTP_MESSAGES } from "@/lib/auth/email-otp";
import { __resetRateLimitStateForTests, getClientIp } from "@/lib/rate-limit";
import { getTrustedClientIp } from "@/lib/security/client-ip";
import {
  getAuthClientBucket,
  LOGIN_IP_LIMIT,
  LOGIN_PAIR_LIMIT,
  LOGIN_THROTTLED_MESSAGE,
  LOGIN_UNIDENTIFIED_LIMIT,
} from "@/lib/security/login-throttle";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const initial = { error: null };

/** Sets the request headers the next action call will see. */
function asClient(opts: { nf?: string; xff?: string } = {}) {
  const h = new Headers();
  if (opts.nf) h.set("x-nf-client-connection-ip", opts.nf);
  if (opts.xff) h.set("x-forwarded-for", opts.xff);
  hdr.current = h;
}

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const loginFd = (email: string, password = "password123") => fd({ email, password });
const registerFd = (email: string) =>
  fd({ nama: "Budi", namaUsaha: "Toko Budi", email, password: "password123", acceptLegal: "on" });

const wrongCreds = { error: { status: 400, message: "Invalid login credentials" } };

beforeEach(() => {
  __resetRateLimitStateForTests();
  rl.peekThrows = false;
  asClient();
  signIn.mockReset();
  signUp.mockReset();
  getUser.mockReset();
  verifyOtp.mockReset();
  resend.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
  signUp.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });
  verifyOtp.mockResolvedValue({ data: {}, error: { status: 400, code: "otp_expired", message: "expired" } });
  resend.mockResolvedValue({ data: {}, error: null });
  vi.stubEnv("EMAIL_OTP_ENABLED", "true");
});

describe("SEC-01: the limiter identity is the trusted IP, never x-forwarded-for", () => {
  it("a forged x-forwarded-for is ignored; rotating it keeps the same shared bucket", () => {
    const keys = new Set(
      [1, 2, 3, 4].map((n) => getAuthClientBucket(new Headers({ "x-forwarded-for": `198.51.100.${n}` })).key),
    );
    expect([...keys]).toEqual(["unidentified"]);
    expect(getAuthClientBucket(new Headers({ "x-forwarded-for": "198.51.100.1" })).identified).toBe(false);
    expect(getTrustedClientIp(new Headers({ "x-forwarded-for": "203.0.113.77" }))).toBeNull();
  });

  it("a valid Netlify IP identifies the client; garbage in that header does not", () => {
    expect(getAuthClientBucket(new Headers({ "x-nf-client-connection-ip": "203.0.113.5" }))).toEqual({
      key: "203.0.113.5",
      identified: true,
    });
    expect(getAuthClientBucket(new Headers({ "x-nf-client-connection-ip": "not-an-ip" })).identified).toBe(false);
  });

  it("registerAction: rotating x-forwarded-for does not escape the shared (no trusted IP) bucket", async () => {
    let blockedAt = 0;
    for (let n = 1; n <= 40; n += 1) {
      asClient({ xff: `198.51.100.${n}` });
      const r = await registerAction(initial, registerFd(`u${n}@example.com`));
      if (r.error?.includes("Terlalu banyak percobaan pendaftaran")) {
        blockedAt = n;
        break;
      }
    }
    expect(blockedAt).toBe(21); // 20 allowed in the shared bucket, the 21st is refused
    expect(signUp).toHaveBeenCalledTimes(20);
  });

  it("registerAction: an identified IP gets the stricter per-IP limit; another IP is unaffected", async () => {
    asClient({ nf: "203.0.113.10" });
    for (let n = 1; n <= 5; n += 1) {
      expect((await registerAction(initial, registerFd(`a${n}@example.com`))).error).toBeNull();
    }
    const sixth = await registerAction(initial, registerFd("a6@example.com"));
    expect(sixth.error).toMatch(/Terlalu banyak percobaan pendaftaran/);

    asClient({ nf: "203.0.113.11" });
    expect((await registerAction(initial, registerFd("b1@example.com"))).error).toBeNull();
  });

  it("registerAction: forging a victim's address in x-forwarded-for cannot spend the victim's bucket", async () => {
    asClient({ nf: "198.51.100.200", xff: "203.0.113.10" }); // attacker, claiming to be the victim
    for (let n = 1; n <= 5; n += 1) await registerAction(initial, registerFd(`x${n}@example.com`));

    asClient({ nf: "203.0.113.10" }); // the real victim still has the full quota
    for (let n = 1; n <= 5; n += 1) {
      expect((await registerAction(initial, registerFd(`v${n}@example.com`))).error).toBeNull();
    }
  });

  it("registerAction: IPv6 addresses inside one /64 share one bucket", async () => {
    for (let n = 1; n <= 5; n += 1) {
      asClient({ nf: `2001:db8:1:2::${n}` });
      expect((await registerAction(initial, registerFd(`s${n}@example.com`))).error).toBeNull();
    }
    asClient({ nf: "2001:db8:1:2:aaaa:bbbb:cccc:dddd" });
    expect((await registerAction(initial, registerFd("s6@example.com"))).error).toMatch(/Terlalu banyak/);
  });

  it("verifyEmailOtpAction: rotating x-forwarded-for shares one bucket (distinct emails, so only the IP bucket can bind)", async () => {
    let blockedAt = 0;
    for (let n = 1; n <= 80; n += 1) {
      asClient({ xff: `198.51.100.${n}` });
      const r = await verifyEmailOtpAction(initial, fd({ email: `o${n}@example.com`, token: "12345678" }));
      if (r.error === OTP_MESSAGES.tooMany && verifyOtp.mock.calls.length === n - 1) {
        blockedAt = n;
        break;
      }
    }
    expect(blockedAt).toBe(61); // shared bucket: 60 per 5 minutes
  });

  it("verifyEmailOtpAction: an identified IP is limited to 20 per 5 minutes", async () => {
    asClient({ nf: "203.0.113.20" });
    for (let n = 1; n <= 20; n += 1) {
      await verifyEmailOtpAction(initial, fd({ email: `o${n}@example.com`, token: "12345678" }));
    }
    expect(verifyOtp).toHaveBeenCalledTimes(20);
    const r = await verifyEmailOtpAction(initial, fd({ email: "o21@example.com", token: "12345678" }));
    expect(r.error).toBe(OTP_MESSAGES.tooMany);
    expect(verifyOtp).toHaveBeenCalledTimes(20);
  });

  it("verifyEmailOtpAction: the per-email limit still holds whatever the IP header says", async () => {
    for (let n = 1; n <= 8; n += 1) {
      asClient({ nf: `203.0.113.${100 + n}`, xff: `198.51.100.${n}` });
      await verifyEmailOtpAction(initial, fd({ email: "victim@example.com", token: "12345678" }));
    }
    asClient({ nf: "203.0.113.150" });
    const r = await verifyEmailOtpAction(initial, fd({ email: "victim@example.com", token: "12345678" }));
    expect(r.error).toBe(OTP_MESSAGES.tooMany);
    expect(verifyOtp).toHaveBeenCalledTimes(8);
  });

  it("resendSignupOtpAction: rotating x-forwarded-for shares one bucket (30 per hour), identified IP gets 6", async () => {
    let sent = 0;
    for (let n = 1; n <= 40; n += 1) {
      asClient({ xff: `198.51.100.${n}` });
      const r = await resendSignupOtpAction(initial, fd({ email: `r${n}@example.com` }));
      if (r.error === OTP_MESSAGES.resendWait) break;
      sent += 1;
    }
    expect(sent).toBe(30);

    __resetRateLimitStateForTests();
    resend.mockClear();
    asClient({ nf: "203.0.113.30" });
    for (let n = 1; n <= 8; n += 1) await resendSignupOtpAction(initial, fd({ email: `q${n}@example.com` }));
    expect(resend).toHaveBeenCalledTimes(6);
  });

  it("structure: no auth action calls the unsafe getClientIp any more", () => {
    for (const file of ["features/auth/actions.ts", "features/auth/otp-actions.ts"]) {
      expect(read(file), file).not.toMatch(/\bgetClientIp\b/);
      expect(read(file), file).toContain("getAuthClientBucket(");
    }
    // The deprecated helper still exists and is still unsafe, which is exactly why nothing may use it for limiters.
    expect(getClientIp(new Headers({ "x-forwarded-for": "203.0.113.77" }))).toBe("203.0.113.77");
  });
});

describe("SEC-02: login throttle", () => {
  it("blocks after LOGIN_PAIR_LIMIT failures for the same IP+email, without calling Supabase again", async () => {
    signIn.mockResolvedValue(wrongCreds);
    asClient({ nf: "203.0.113.40" });
    for (let n = 1; n <= LOGIN_PAIR_LIMIT; n += 1) {
      const r = await loginAction(initial, loginFd("victim@example.com", `guess${n}`));
      expect(r.error).toBe("Email atau kata sandi salah.");
    }
    expect(signIn).toHaveBeenCalledTimes(LOGIN_PAIR_LIMIT);

    const blocked = await loginAction(initial, loginFd("victim@example.com", "guess-next"));
    expect(blocked.error).toBe(LOGIN_THROTTLED_MESSAGE);
    expect(signIn).toHaveBeenCalledTimes(LOGIN_PAIR_LIMIT);
  });

  it("cannot be weaponised: failures from the attacker's IP do not lock the victim on another IP", async () => {
    signIn.mockResolvedValue(wrongCreds);
    asClient({ nf: "198.51.100.50" }); // attacker
    for (let n = 1; n <= LOGIN_PAIR_LIMIT + 3; n += 1) await loginAction(initial, loginFd("victim@example.com", `g${n}`));

    asClient({ nf: "203.0.113.51" }); // the victim, elsewhere, with the right password
    signIn.mockResolvedValue({ error: null });
    await expect(loginAction(initial, loginFd("victim@example.com", "right-password"))).rejects.toThrow(
      "REDIRECT:/dashboard",
    );
  });

  it("forging x-forwarded-for does not dodge the limit and does not lock anyone else", async () => {
    signIn.mockResolvedValue(wrongCreds);
    for (let n = 1; n <= LOGIN_PAIR_LIMIT; n += 1) {
      asClient({ xff: `198.51.100.${n}` }); // no trusted IP: all share one bucket
      await loginAction(initial, loginFd("victim@example.com", `g${n}`));
    }
    asClient({ xff: "198.51.100.99" });
    expect((await loginAction(initial, loginFd("victim@example.com", "g-next"))).error).toBe(LOGIN_THROTTLED_MESSAGE);

    // A user with a real trusted IP is untouched by the shared bucket.
    asClient({ nf: "203.0.113.60" });
    expect((await loginAction(initial, loginFd("victim@example.com", "g-next"))).error).toBe("Email atau kata sandi salah.");
  });

  it("other emails from the same IP are still allowed after one pair is blocked", async () => {
    signIn.mockResolvedValue(wrongCreds);
    asClient({ nf: "203.0.113.70" });
    for (let n = 1; n <= LOGIN_PAIR_LIMIT; n += 1) await loginAction(initial, loginFd("a@example.com", `g${n}`));
    expect((await loginAction(initial, loginFd("a@example.com"))).error).toBe(LOGIN_THROTTLED_MESSAGE);
    expect((await loginAction(initial, loginFd("b@example.com"))).error).toBe("Email atau kata sandi salah.");
  });

  it("blocks one IP after LOGIN_IP_LIMIT failures spread over many emails", async () => {
    signIn.mockResolvedValue(wrongCreds);
    asClient({ nf: "203.0.113.80" });
    for (let n = 1; n <= LOGIN_IP_LIMIT; n += 1) await loginAction(initial, loginFd(`user${n}@example.com`));
    expect(signIn).toHaveBeenCalledTimes(LOGIN_IP_LIMIT);
    expect((await loginAction(initial, loginFd("fresh@example.com"))).error).toBe(LOGIN_THROTTLED_MESSAGE);
    expect(signIn).toHaveBeenCalledTimes(LOGIN_IP_LIMIT);
  });

  it("the shared no-trusted-IP bucket blocks after LOGIN_UNIDENTIFIED_LIMIT failures across emails", async () => {
    signIn.mockResolvedValue(wrongCreds);
    for (let n = 1; n <= LOGIN_UNIDENTIFIED_LIMIT; n += 1) {
      asClient({ xff: `198.51.100.${n % 250}` });
      await loginAction(initial, loginFd(`user${n}@example.com`));
    }
    asClient({ xff: "198.51.100.251" });
    expect((await loginAction(initial, loginFd("fresh@example.com"))).error).toBe(LOGIN_THROTTLED_MESSAGE);
  });

  it("resets the IP+email bucket on success: the failure budget starts over", async () => {
    asClient({ nf: "203.0.113.90" });
    signIn.mockResolvedValue(wrongCreds);
    for (let n = 1; n < LOGIN_PAIR_LIMIT; n += 1) await loginAction(initial, loginFd("me@example.com", `g${n}`));

    signIn.mockResolvedValue({ error: null });
    await expect(loginAction(initial, loginFd("me@example.com", "right"))).rejects.toThrow("REDIRECT:/dashboard");

    signIn.mockResolvedValue(wrongCreds);
    signIn.mockClear();
    for (let n = 1; n <= LOGIN_PAIR_LIMIT; n += 1) {
      expect((await loginAction(initial, loginFd("me@example.com", `h${n}`))).error).toBe("Email atau kata sandi salah.");
    }
    expect(signIn).toHaveBeenCalledTimes(LOGIN_PAIR_LIMIT);
  });

  it("a blocked attempt and a non-credential error do not count as failures", async () => {
    asClient({ nf: "203.0.113.91" });
    signIn.mockResolvedValue({ error: { status: 500, message: "boom" } });
    for (let n = 1; n <= LOGIN_PAIR_LIMIT + 2; n += 1) {
      expect((await loginAction(initial, loginFd("me@example.com"))).error).toBe("Gagal masuk. Silakan coba lagi.");
    }
    expect(signIn).toHaveBeenCalledTimes(LOGIN_PAIR_LIMIT + 2);
  });

  it("answers one generic message: wrong password, unknown email and throttle reveal nothing about the account", async () => {
    asClient({ nf: "203.0.113.92" });
    signIn.mockResolvedValue(wrongCreds);
    const wrongPassword = await loginAction(initial, loginFd("exists@example.com", "bad"));
    const unknownEmail = await loginAction(initial, loginFd("ghost@example.com", "bad"));
    expect(wrongPassword).toEqual(unknownEmail);

    for (let n = 1; n <= LOGIN_PAIR_LIMIT; n += 1) await loginAction(initial, loginFd("exists@example.com", "bad"));
    for (let n = 1; n <= LOGIN_PAIR_LIMIT; n += 1) await loginAction(initial, loginFd("ghost@example.com", "bad"));
    const a = await loginAction(initial, loginFd("exists@example.com", "bad"));
    const b = await loginAction(initial, loginFd("ghost@example.com", "bad"));
    expect(a).toEqual(b);
    expect(a.error).toBe(LOGIN_THROTTLED_MESSAGE);
    expect(LOGIN_THROTTLED_MESSAGE).not.toMatch(/email|akun|\bIP\b|terdaftar/i);
  });

  it("fails open: if the limiter throws, login still works (and still fails normally with wrong credentials)", async () => {
    rl.peekThrows = true;
    asClient({ nf: "203.0.113.93" });
    signIn.mockResolvedValue({ error: null });
    await expect(loginAction(initial, loginFd("me@example.com"))).rejects.toThrow("REDIRECT:/dashboard");
    signIn.mockResolvedValue(wrongCreds);
    expect((await loginAction(initial, loginFd("me@example.com", "bad"))).error).toBe("Email atau kata sandi salah.");
  });

  it("structure: loginAction checks the throttle after validation and before signInWithPassword", () => {
    const src = read("features/auth/actions.ts");
    const body = src.slice(src.indexOf("export async function loginAction"), src.indexOf("export async function registerAction"));
    const iParse = body.indexOf("loginSchema.safeParse");
    const iCheck = body.indexOf("checkLoginThrottle(");
    const iSignIn = body.indexOf("signInWithPassword(");
    expect(iParse).toBeGreaterThanOrEqual(0);
    expect(iCheck).toBeGreaterThan(iParse);
    expect(iSignIn).toBeGreaterThan(iCheck);
    expect(body).toContain("resetLoginThrottle(");
  });

  it("structure: there is no email-only login bucket (it would let anyone lock a victim out)", () => {
    const src = read("lib/security/login-throttle.ts");
    expect(src).not.toMatch(/`login-email:/);
    expect(src).toMatch(/login-pair:\$\{bucket\.key\}:/);
  });
});

describe("regression: normal sign-in and sign-up keep working", () => {
  it("a normal login redirects to /dashboard (or the safe next path)", async () => {
    asClient({ nf: "203.0.113.100" });
    signIn.mockResolvedValue({ error: null });
    await expect(loginAction(initial, loginFd("ok@example.com"))).rejects.toThrow("REDIRECT:/dashboard");
    const withNext = fd({ email: "ok@example.com", password: "password123", next: "/onboarding" });
    await expect(loginAction(initial, withNext)).rejects.toThrow("REDIRECT:/onboarding");
    expect(signIn).toHaveBeenCalledWith({ email: "ok@example.com", password: "password123" });
  });

  it("many successful logins from one IP are never throttled (only failures count)", async () => {
    asClient({ nf: "203.0.113.101" });
    signIn.mockResolvedValue({ error: null });
    for (let n = 1; n <= LOGIN_IP_LIMIT + 10; n += 1) {
      await expect(loginAction(initial, loginFd("ok@example.com"))).rejects.toThrow("REDIRECT:/dashboard");
    }
  });

  it("login validation errors are unchanged and do not touch Supabase", async () => {
    asClient({ nf: "203.0.113.102" });
    const r = await loginAction(initial, loginFd("not-an-email"));
    expect(r.error).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("a normal registration still reaches signUp and answers with the confirm-your-email info", async () => {
    asClient({ nf: "203.0.113.103" });
    const r = await registerAction(initial, registerFd("new@example.com"));
    expect(signUp).toHaveBeenCalledTimes(1);
    expect(r.error).toBeNull();
    expect(r.verifyEmail ?? r.info).toBeTruthy();
  });

  it("a normal OTP verify success redirects to /onboarding; resend answers the generic sent message", async () => {
    asClient({ nf: "203.0.113.104" });
    verifyOtp.mockResolvedValue({ data: { session: {} }, error: null });
    await expect(verifyEmailOtpAction(initial, fd({ email: "new@example.com", token: "12345678" }))).rejects.toThrow(
      "REDIRECT:/onboarding",
    );
    const r = await resendSignupOtpAction(initial, fd({ email: "new@example.com" }));
    expect(r.error).toBeNull();
    expect(r.info).toBe(OTP_MESSAGES.resendSent);
  });
});

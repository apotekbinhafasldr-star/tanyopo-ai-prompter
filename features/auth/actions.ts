"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from "@/schemas/auth";
import { publicEnv } from "@/lib/env";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { isExistingAccountSignUp } from "@/lib/auth/existing-account";
import { isUncertainSignupOutcome, mapSignupError, UNCERTAIN_SIGNUP_MESSAGE } from "@/lib/auth/signup-error";
import { safeNextPath } from "@/lib/auth/safe-next";

/**
 * Best-effort brake on trial-farming (repeated signups to get fresh
 * 14-day trials / AI usage allowances) — same in-memory, process-local
 * rate limiter already proven for the UMKMpro integration routes
 * (lib/umkmpro/route-helpers.ts), keyed per client IP instead of per
 * route. Generous enough that a shared household/office IP with several
 * real people registering in the same hour is very unlikely to hit it.
 */
const REGISTER_RATE_LIMIT = 5;
const REGISTER_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export interface AuthActionState {
  error: string | null;
  info?: string | null;
  /** True only when registerAction detected the email already belongs to
   * an existing account in this shared Supabase project — lets the
   * register form show a distinct "already registered" card (Masuk /
   * Lupa kata sandi) instead of the generic "check your email" card. */
  existingAccount?: boolean;
  /** Non-secret form values handed back so the person does not retype them after a message. NEVER the password. */
  values?: RegisterKeptValues;
  /** True when the signUp() request may or may not have been processed (transport failure / thrown error). */
  uncertain?: boolean;
}

export interface RegisterKeptValues {
  nama: string;
  namaUsaha: string;
  email: string;
}

const KEPT_VALUE_MAX = 200;

function keptField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, KEPT_VALUE_MAX) : "";
}

/** Only these three fields are ever echoed back; the password is deliberately not read here. */
function keptValues(formData: FormData): RegisterKeptValues {
  return { nama: keptField(formData, "nama"), namaUsaha: keptField(formData, "namaUsaha"), email: keptField(formData, "email") };
}

export async function loginAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return {
      error:
        error.status === 400
          ? "Email atau kata sandi salah."
          : "Gagal masuk. Silakan coba lagi.",
    };
  }

  redirect(safeNextPath(formData.get("next")));
}

export async function registerAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  // An active session means the person is already signed in as someone. Registering from here would create a second
  // identity next to a live one (and the old session would keep being used afterwards, which is exactly what looks
  // like "the new account shows the old data"). Refuse before anything else: no validation, no rate-limit token, no
  // signUp(). The register page itself shows the "already signed in" notice instead of this form; this guard covers a
  // direct invocation of the action.
  const sessionClient = await createClient();
  const activeSession = await sessionClient.auth.getUser();
  const activeUser = activeSession?.data?.user ?? null;
  if (activeUser) {
    return {
      error: activeUser.email
        ? `Anda sedang masuk sebagai ${activeUser.email}. Keluar terlebih dahulu untuk membuat akun baru.`
        : "Anda sedang masuk. Keluar terlebih dahulu untuk membuat akun baru.",
    };
  }

  const values = keptValues(formData);

  const parsed = registerSchema.safeParse({
    nama: formData.get("nama"),
    namaUsaha: formData.get("namaUsaha"),
    email: formData.get("email"),
    password: formData.get("password"),
    // Only an explicitly checked box ("on") counts as acceptance.
    acceptLegal: formData.get("acceptLegal") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid", values };
  }

  // Runs only after validation succeeds, so a typo retry never counts
  // against the limit — and before signUp(), so a blocked attempt never
  // reaches Supabase Auth at all.
  const clientIp = getClientIp(await headers());
  const rateLimit = checkRateLimit(`register:${clientIp}`, REGISTER_RATE_LIMIT, REGISTER_RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return {
      error: "Terlalu banyak percobaan pendaftaran dari jaringan ini. Silakan coba lagi dalam beberapa saat.",
      values,
    };
  }

  const supabase = sessionClient;
  const { nama, namaUsaha, email, password } = parsed.data;

  // No automatic retry anywhere: a signUp() whose outcome is unknown may already have created the account, and a
  // second blind attempt could create a duplicate. A thrown error or a transport-level failure is reported as
  // "uncertain" instead of "not created".
  let signUpResult: Awaited<ReturnType<typeof supabase.auth.signUp>>;
  try {
    signUpResult = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          nama,
          nama_usaha: namaUsaha,
          // Promoter-only signups don't map to a UMKMpro business type;
          // the shared handle_new_user trigger records this as a custom
          // business_template row. Real marketing context is collected in
          // /onboarding and stored in prompter_brand_profiles.
          jenis_usaha: "lainnya",
        },
        // No emailRedirectTo here (see B12 P0-1): the production Supabase
        // project has exactly one Redirect URLs entry, an exact-match bare
        // `/auth/callback` with no wildcard, so any redirectTo carrying a
        // query string (e.g. `?next=/onboarding`) would silently fail that
        // check and fall back to the Site URL instead of taking effect.
        // Signup confirmation instead relies on the "Confirm signup" email
        // template being configured to link straight to
        // `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/onboarding`
        // (app/auth/confirm/route.ts) — a path that bypasses this allow-list
        // check entirely, since it never goes through Supabase's own
        // redirect step. Verified in the Supabase Dashboard (2026-09) that
        // this template is configured exactly this way and Site URL already
        // points at this app's own production domain — not a stale/unset
        // fallback — so this flow is confirmed live end-to-end.
      },
    });
  } catch {
    return { error: UNCERTAIN_SIGNUP_MESSAGE, uncertain: true, values };
  }
  const { data, error } = signUpResult;

  // Covers both signals Supabase can return for "this email already has an
  // account" (this project is shared with UMKMpro AI, so that's a real,
  // expected case, not just a theoretical one) — see
  // lib/auth/existing-account.ts for why both are checked. Never proceeds
  // as if a new account were created: nama/namaUsaha are never written
  // anywhere for an existing account (signUp() itself already guarantees
  // that), and the user is pointed at the existing sign-in paths instead.
  if (isExistingAccountSignUp(error, data)) {
    return {
      error: null,
      info: "Email ini sudah terdaftar. Silakan masuk menggunakan akun Anda.",
      existingAccount: true,
      values,
    };
  }

  if (isUncertainSignupOutcome(error)) {
    return { error: UNCERTAIN_SIGNUP_MESSAGE, uncertain: true, values };
  }

  if (error) {
    return { error: mapSignupError(error), values };
  }

  // If the project requires email confirmation, signUp succeeds but no
  // session is issued yet — there's nothing to redirect into.
  if (!data.session) {
    return {
      error: null,
      info: "Akun berhasil dibuat. Silakan cek email Anda untuk konfirmasi sebelum masuk.",
    };
  }

  redirect("/onboarding");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Always returns a generic success message regardless of whether the email
 * exists — Supabase's own behavior for resetPasswordForEmail, kept here so
 * this action never becomes an account-enumeration oracle.
 */
export async function forgotPasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const supabase = await createClient();
  // No query string here: Supabase's Redirect URLs allow list holds the
  // exact `${appUrl}/auth/callback` entry with no wildcard, and requires an
  // exact match on redirectTo — anything appended (e.g. `?next=...`) fails
  // that match, so Supabase would silently fall back to this shared
  // project's Site URL if this ever stopped matching. app/auth/callback/
  // route.ts's default `next` covers the destination instead. Verified in
  // the Supabase Dashboard (B12 P0-1, 2026-09) that this redirectTo
  // matches the project's sole allow-list entry exactly, so this flow is
  // confirmed live end-to-end — Site URL is not this app's fallback path
  // in normal operation, only a safety net if the match ever breaks.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.appUrl}/auth/callback`,
  });

  return {
    error: null,
    info: "Jika email tersebut terdaftar, kami telah mengirimkan tautan untuk mengatur ulang kata sandi. Silakan cek kotak masuk (dan folder spam) Anda.",
  };
}

/**
 * Only callable with an active recovery session (established by
 * app/auth/callback/route.ts after a valid, unexpired reset link). Signs the
 * user out afterward so they must explicitly log back in with the new
 * password, rather than silently continuing on the one-time recovery
 * session.
 */
export async function resetPasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "Tautan reset kata sandi ini sudah kedaluwarsa atau tidak valid. Silakan minta tautan baru.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return { error: "Gagal memperbarui kata sandi. Silakan coba lagi." };
  }

  await supabase.auth.signOut();
  redirect("/login?reset=success");
}

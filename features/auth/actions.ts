"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from "@/schemas/auth";
import { publicEnv } from "@/lib/env";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { isExistingAccountSignUp } from "@/lib/auth/existing-account";

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
}

/**
 * Only ever redirects to a same-origin app path. A `next` value coming
 * from a query string is untrusted input — without this check a login
 * link could be crafted to bounce a user off to an attacker's site
 * (`//evil.com`, `https://evil.com`) after they authenticate.
 */
function safeNextPath(next: FormDataEntryValue | null): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }
  return next;
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
  const parsed = registerSchema.safeParse({
    nama: formData.get("nama"),
    namaUsaha: formData.get("namaUsaha"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  // Runs only after validation succeeds, so a typo retry never counts
  // against the limit — and before signUp(), so a blocked attempt never
  // reaches Supabase Auth at all.
  const clientIp = getClientIp(await headers());
  const rateLimit = checkRateLimit(`register:${clientIp}`, REGISTER_RATE_LIMIT, REGISTER_RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return {
      error: "Terlalu banyak percobaan pendaftaran dari jaringan ini. Silakan coba lagi dalam beberapa saat.",
    };
  }

  const supabase = await createClient();
  const { nama, namaUsaha, email, password } = parsed.data;

  const { data, error } = await supabase.auth.signUp({
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
    },
  });

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
    };
  }

  if (error) {
    return { error: "Gagal membuat akun. Silakan coba lagi." };
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
  // that match, so Supabase silently falls back to this shared project's
  // Site URL (localhost, since the project is also used by UMKMpro AI).
  // app/auth/callback/route.ts's default `next` covers the destination
  // instead.
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

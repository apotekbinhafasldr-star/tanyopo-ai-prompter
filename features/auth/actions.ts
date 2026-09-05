"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from "@/schemas/auth";
import { publicEnv } from "@/lib/env";

export interface AuthActionState {
  error: string | null;
  info?: string | null;
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

  if (error) {
    return {
      error:
        error.status === 422 || error.code === "user_already_exists"
          ? "Email ini sudah terdaftar. Silakan masuk."
          : "Gagal membuat akun. Silakan coba lagi.",
    };
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
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.appUrl}/auth/callback?next=/reset-password`,
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

"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, registerSchema } from "@/schemas/auth";

export interface AuthActionState {
  error: string | null;
  info?: string | null;
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

  redirect("/dashboard");
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

import type { Metadata } from "next";
import { RegisterForm } from "@/features/auth/register-form";
import { ActiveSessionNotice } from "@/features/auth/active-session-notice";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Daftar — LINOE",
};

export default async function RegisterPage() {
  // proxy.ts no longer redirects signed-in visitors away from this page; they see who they are signed in as.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return <ActiveSessionNotice email={user.email ?? null} continueHref="/dashboard" context="register" />;
  }

  return <RegisterForm />;
}

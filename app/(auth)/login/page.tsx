import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/login-form";
import { ActiveSessionNotice } from "@/features/auth/active-session-notice";
import { safeNextPath } from "@/lib/auth/safe-next";
import { parseConfirmNotice } from "@/lib/auth/confirm-notice";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Masuk — LINOE",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; notice?: string }>;
}) {
  const { next, reset, notice } = await searchParams;

  // proxy.ts no longer redirects signed-in visitors away from this page; they see who they are signed in as.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return <ActiveSessionNotice email={user.email ?? null} continueHref={safeNextPath(next)} context="login" />;
  }

  return <LoginForm next={next} resetSuccess={reset === "success"} notice={parseConfirmNotice(notice)} />;
}

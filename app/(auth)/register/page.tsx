import type { Metadata } from "next";
import { RegisterForm } from "@/features/auth/register-form";
import { isCollectionEnabled } from "@/lib/trial-abuse/config";

export const metadata: Metadata = {
  title: "Daftar — LINOE",
};

// Read per request: the browser only gathers anti-abuse signals while the server-side mode is on.
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return <RegisterForm collectDeviceSignals={isCollectionEnabled()} />;
}

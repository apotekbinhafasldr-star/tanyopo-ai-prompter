import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = {
  title: "Masuk — Tanyopo AI Promoter",
};

export default function LoginPage() {
  return <LoginForm />;
}

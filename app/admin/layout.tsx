import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/features/admin/admin-shell";
import { requireAdminPage } from "@/services/platform-admin";

// Internal area: never indexed, never cached as a public page.
export const metadata: Metadata = {
  title: "Admin Perusahaan — LINOE",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Pages below re-check their own permission: a layout alone is not a security boundary.
  const principal = await requireAdminPage("admin.overview");
  return <AdminShell principal={principal}>{children}</AdminShell>;
}

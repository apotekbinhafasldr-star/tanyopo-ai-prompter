import { redirect } from "next/navigation";
import { getDemoSession } from "@/lib/demo/is-demo-request";

/**
 * Bare /demo (e.g. a bookmarked or directly-typed link): re-enters
 * through /api/demo/start for a fresh session when there's none valid
 * yet, otherwise goes straight to the dashboard. The "Coba Demo" button
 * on the landing page links directly to /api/demo/start and never lands
 * here first.
 */
export default async function DemoEntryPage() {
  const session = await getDemoSession();
  redirect(session ? "/demo/dashboard" : "/api/demo/start");
}

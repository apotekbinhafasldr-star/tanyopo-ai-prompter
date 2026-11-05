import Link from "next/link";
import { logoutAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown on /login and /register when the visitor already has a live session, instead of silently redirecting.
 * A silent redirect made a signed-in person believe a "new" registration had opened the old account's dashboard.
 *
 * Server component: `email` comes from the server-verified session (supabase.auth.getUser(), which asks Auth to
 * validate the token), never from a cookie value or a query parameter. Nothing here creates, switches or changes
 * an account or tenant: "Lanjut" is a plain link, "Keluar" is the existing logoutAction.
 */
export function ActiveSessionNotice({
  email,
  continueHref,
  context,
}: {
  email: string | null;
  /** Already passed through safeNextPath() by the caller. */
  continueHref: string;
  context: "login" | "register";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Anda sudah masuk</CardTitle>
        <CardDescription>
          {context === "register"
            ? "Untuk membuat akun baru, keluar dari akun ini terlebih dahulu."
            : "Untuk masuk dengan akun lain, keluar dari akun ini terlebih dahulu."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="rounded-[var(--radius-md)] border border-border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Akun aktif</p>
          <p className="break-all text-sm font-medium text-foreground" data-testid="active-session-email">
            {email ?? "Akun tanpa alamat email"}
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href={continueHref}>Lanjut ke Dashboard</Link>
        </Button>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" className="w-full">
            Keluar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

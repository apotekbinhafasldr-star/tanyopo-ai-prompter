import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * P1-2 — Custom 404 handling. Renders inside the existing root layout
 * (app/layout.tsx already provides <html>/<body> and loads globals.css),
 * so this only needs the page content itself. Uses only existing LINOE
 * design tokens/components (Button, EmptyState) — no new design system.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center p-8">
      <EmptyState
        icon={FileQuestion}
        title="Halaman tidak ditemukan"
        description="Halaman yang Anda cari tidak ada, sudah dipindahkan, atau tautannya sudah kedaluwarsa."
        action={
          <Button asChild>
            <Link href="/dashboard">Kembali ke Dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}

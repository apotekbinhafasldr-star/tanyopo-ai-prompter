import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <Link href="/" className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-[var(--radius-md)] bg-brand text-sm font-bold text-brand-foreground">
          T
        </span>
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Tanyopo AI Promoter
        </span>
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

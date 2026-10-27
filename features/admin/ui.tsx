import type { ReactNode } from "react";
import { AlertTriangle, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_LABEL } from "@/lib/admin/demo-data";
import { cn } from "@/lib/utils/cn";

/** Must appear on every screen that shows demo data. */
export function DemoBanner() {
  return (
    <div
      role="note"
      data-testid="demo-banner"
      className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warning bg-warning-muted px-3 py-2 text-sm text-warning"
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">{DEMO_LABEL}.</span> Migrasi database belum diterapkan, jadi halaman ini
        memakai contoh tetap. Tidak ada data pelanggan atau pembayaran asli.
      </p>
    </div>
  );
}

export function PageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p
          className={cn(
            "text-base font-semibold tracking-tight md:text-lg",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning",
            tone === "danger" && "text-danger",
            tone === "neutral" && "text-foreground",
          )}
        >
          {value}
        </p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="p-4 pb-0">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

export function KeyValueRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("text-right text-sm", strong ? "font-semibold text-foreground" : "text-foreground")}>{value}</dd>
    </div>
  );
}

export function Notice({ children, tone = "warning" }: { children: ReactNode; tone?: "warning" | "info" }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm",
        tone === "warning" ? "bg-warning-muted text-warning" : "bg-info-muted text-info",
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function DisabledAction({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="min-h-11 rounded-[var(--radius-md)] border border-border bg-surface-muted px-4 text-sm font-medium text-muted-foreground opacity-70"
      >
        {label}
      </button>
      <p className="text-xs text-muted-foreground">{reason}</p>
    </div>
  );
}

export function StatusBadge({ children, variant }: { children: ReactNode; variant: "success" | "warning" | "danger" | "neutral" | "info" | "brand" }) {
  return <Badge variant={variant}>{children}</Badge>;
}

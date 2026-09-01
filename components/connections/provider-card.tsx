import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusPill, type ConnectionStatus } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import type { CapabilityRow } from "@/lib/connectors/capability-registry";
import { DisconnectButton, VerifyButton } from "@/components/connections/connection-actions";

const CAPABILITY_LABEL: Record<string, string> = {
  CONNECT_ACCOUNT: "Hubungkan Akun",
  READ_ANALYTICS: "Baca Analitik",
  PUBLISH_CONTENT: "Publikasi Konten",
  CREATE_CAMPAIGN: "Buat Campaign",
  CREATE_AD: "Buat Iklan",
  UPDATE_BUDGET: "Ubah Budget",
  PAUSE_CAMPAIGN: "Jeda Campaign",
};

export function ProviderCard({
  icon: Icon,
  title,
  description,
  status,
  accountName,
  lastRefreshedAt,
  capabilities,
  connectHref,
  platformParam,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  status: ConnectionStatus;
  accountName: string | null;
  lastRefreshedAt: string | null;
  capabilities: CapabilityRow[];
  connectHref: string | null;
  platformParam: string;
}) {
  const isConnected = status === "CONNECTED" || status === "EXPIRED" || status === "ACTION_REQUIRED";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
        <StatusPill status={status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isConnected && accountName ? (
          <p className="text-sm text-foreground">
            Akun: <span className="font-medium">{accountName}</span>
          </p>
        ) : null}
        {isConnected && lastRefreshedAt ? (
          <p className="text-xs text-muted-foreground">
            Terakhir diverifikasi: {new Date(lastRefreshedAt).toLocaleString("id-ID")}
          </p>
        ) : null}
        <ul className="flex flex-wrap gap-1.5">
          {capabilities.map((cap) => (
            <li
              key={cap.capability}
              className={
                "rounded-full border px-2 py-0.5 text-xs " +
                (cap.enabled
                  ? "border-border text-foreground"
                  : "border-border-strong text-muted-foreground opacity-60")
              }
              title={cap.notes ?? undefined}
            >
              {CAPABILITY_LABEL[cap.capability] ?? cap.capability}
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        {status === "NOT_CONFIGURED" ? (
          <p className="text-xs text-muted-foreground">
            Kredensial developer belum diatur untuk platform ini.
          </p>
        ) : isConnected ? (
          <div className="flex gap-2">
            <VerifyButton platform={platformParam} />
            <DisconnectButton platform={platformParam} />
          </div>
        ) : connectHref ? (
          <Button asChild size="sm">
            <a href={connectHref}>Hubungkan</a>
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

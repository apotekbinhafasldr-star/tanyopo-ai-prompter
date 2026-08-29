import { Badge } from "@/components/ui/badge";

export type ConnectionStatus =
  | "CONNECTED"
  | "NOT_CONNECTED"
  | "EXPIRED"
  | "ACTION_REQUIRED"
  | "NOT_AVAILABLE"
  | "NOT_CONFIGURED";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  CONNECTED: "Terhubung",
  NOT_CONNECTED: "Belum Terhubung",
  EXPIRED: "Kedaluwarsa",
  ACTION_REQUIRED: "Perlu Tindakan",
  NOT_AVAILABLE: "Tidak Tersedia",
  NOT_CONFIGURED: "Belum Dikonfigurasi",
};

const STATUS_VARIANT: Record<
  ConnectionStatus,
  "success" | "neutral" | "warning" | "danger" | "outline"
> = {
  CONNECTED: "success",
  NOT_CONNECTED: "neutral",
  EXPIRED: "danger",
  ACTION_REQUIRED: "warning",
  NOT_AVAILABLE: "outline",
  NOT_CONFIGURED: "outline",
};

/**
 * Renders a connector/integration status. Deliberately has no "fake"
 * success state — a connector with no credentials configured always renders
 * NOT_CONFIGURED, never CONNECTED. See docs/INTEGRATIONS.md.
 */
export function StatusPill({ status }: { status: ConnectionStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

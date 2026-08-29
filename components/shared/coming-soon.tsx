import { Construction } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Honest placeholder for nav destinations not yet built. Never fakes data
 * or a working control — states plainly which phase ships the feature.
 */
export function ComingSoon({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <EmptyState
        icon={Construction}
        title={`Modul ini dibangun pada ${phase}`}
        description="Belum ada data atau koneksi palsu di sini — halaman ini akan aktif setelah fase pengembangan terkait selesai."
      />
    </div>
  );
}

import { Frame, Skeleton } from "@/features/admin/premium/parts";

export default function Loading() {
  return (
    <Frame>
      <div role="status" aria-label="Memuat data keuangan" style={{ display: "grid", gap: 12 }}>
        <Skeleton height={86} />
        <Skeleton height={44} />
        <div className="fin-grid">
          <Skeleton height={96} /><Skeleton height={96} /><Skeleton height={96} /><Skeleton height={96} />
        </div>
        <Skeleton height={260} />
      </div>
    </Frame>
  );
}

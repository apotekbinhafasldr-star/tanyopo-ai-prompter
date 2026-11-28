import { Skeleton } from "@/components/ui/skeleton";

export default function PrivasiLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-8">
      <span className="sr-only">Memuat halaman…</span>
      <div className="flex flex-col gap-2" aria-hidden>
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
      <Skeleton className="h-32 w-full" aria-hidden />
      <Skeleton className="h-32 w-full" aria-hidden />
      <Skeleton className="h-32 w-full" aria-hidden />
    </div>
  );
}

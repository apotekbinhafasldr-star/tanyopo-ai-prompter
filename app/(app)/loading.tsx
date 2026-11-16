import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-segment loading state for every page under the signed-in app shell
 * (dashboard, connections, ...). Pages fetch on the server, so without this a
 * slow request shows a blank screen on a mobile connection. Display only:
 * neutral placeholder blocks, no data, announced once to screen readers.
 */
export default function AppLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="flex flex-1 flex-col gap-6 p-4 sm:p-8"
    >
      <span className="sr-only">Memuat halaman…</span>
      <div className="flex flex-col gap-2" aria-hidden>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-56 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-[var(--radius-lg)]" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-[var(--radius-lg)]" aria-hidden />
    </div>
  );
}

import { Skeleton } from '@/components/ui';

/** Root loading state. Matches the home page's shape so it does not jump. */
export default function Loading() {
  return (
    <div className="space-y-10" aria-busy="true">
      <span className="sr-only">Loading</span>
      <div className="space-y-4 text-center">
        <Skeleton className="mx-auto h-7 w-52 rounded-full" />
        <Skeleton className="mx-auto h-12 w-3/4 max-w-xl" />
        <Skeleton className="mx-auto h-5 w-full max-w-md" />
        <Skeleton className="mx-auto h-14 w-64 rounded-xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

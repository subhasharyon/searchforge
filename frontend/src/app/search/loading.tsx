import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <section className="mx-auto w-full max-w-5xl flex-1 px-4 pt-10 pb-16 sm:px-6 sm:pt-14">
      <Skeleton className="mx-auto h-12 max-w-2xl rounded-xl sm:h-13" />
      <div className="mt-8 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        {/* Filter sidebar skeleton (desktop only — mobile collapses it). */}
        <div className="hidden lg:block">
          <div className="sticky top-20 space-y-6">
            {[0, 1].map((section) => (
              <div key={section}>
                <Skeleton className="mx-2 h-3 w-16 rounded" />
                <div className="mt-3 space-y-2">
                  {[0, 1, 2].map((row) => (
                    <div key={row} className="flex items-center gap-2 px-2">
                      <Skeleton className="size-3.5 rounded-[4px]" />
                      <Skeleton className="h-3.5 w-20 rounded" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <Skeleton className="mx-2 h-8 w-full rounded-lg" />
            <Skeleton className="mx-2 h-8 w-full rounded-lg" />
          </div>
        </div>
        {/* Results skeleton. */}
        <div>
          <Skeleton className="h-4 w-40 rounded" />
          <div className="mt-4 space-y-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="rounded-xl border border-border bg-card p-4 sm:p-5"
              >
                <Skeleton className="h-5 w-3/5 rounded-md" />
                <Skeleton className="mt-2 h-3 w-32 rounded" />
                <Skeleton className="mt-3 h-4 w-full rounded" />
                <Skeleton className="mt-1.5 h-4 w-4/5 rounded" />
                <div className="mt-4 flex gap-1.5">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

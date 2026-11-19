import { Skeleton } from "@/components/ui/skeleton"

export default function DocumentLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <Skeleton className="h-4 w-24" />
      <div className="mx-auto mt-10 max-w-3xl">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="mt-5 h-9 w-3/4" />
        <Skeleton className="mt-4 h-4 w-64" />
        <div className="mt-4 flex gap-1.5">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>
        <Skeleton className="mt-8 h-72 w-full rounded-xl" />
        <Skeleton className="mt-6 h-9 w-40" />
      </div>
    </div>
  )
}

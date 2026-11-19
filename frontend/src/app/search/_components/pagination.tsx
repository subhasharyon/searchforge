import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { buildSearchHref, type SearchUrlParams } from "@/lib/search-url"
import type { SearchPagination } from "@/types/search"

export function Pagination({
  pagination,
  params,
}: {
  pagination: SearchPagination
  params: SearchUrlParams
}) {
  const { page, totalPages, total } = pagination
  if (total === 0 || totalPages <= 1) {
    return null
  }

  return (
    <nav
      aria-label="Search results pagination"
      className="mt-6 flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
    >
      <p className="text-xs text-muted-foreground">
        Page {page} of {totalPages} ·{" "}
        {total.toLocaleString("en-US")}{" "}
        {total === 1 ? "result" : "results"}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link
                href={buildSearchHref({ ...params, page: page - 1 })}
                aria-label="Previous page"
              />
            }
          >
            <ChevronLeft aria-hidden />
            Previous
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft aria-hidden />
            Previous
          </Button>
        )}
        {page < totalPages ? (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link
                href={buildSearchHref({ ...params, page: page + 1 })}
                aria-label="Next page"
              />
            }
          >
            Next
            <ChevronRight aria-hidden />
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
            <ChevronRight aria-hidden />
          </Button>
        )}
      </div>
    </nav>
  )
}

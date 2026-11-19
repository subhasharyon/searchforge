import type { Metadata } from "next"
import { ChevronDown, SlidersHorizontal } from "lucide-react"

import { SearchBox } from "@/components/shared/search-box"
import { Badge } from "@/components/ui/badge"
import { searchDocuments } from "@/lib/api/search"
import {
  activeFilterCount,
  buildSearchHref,
  DEFAULT_PAGE_SIZE,
  parseSearchParams,
} from "@/lib/search-url"
import type { SearchResponse } from "@/types/search"
import { ActiveFilters } from "./_components/active-filters"
import { Pagination } from "./_components/pagination"
import { SearchFilters } from "./_components/search-filters"
import { SearchResults } from "./_components/search-results"
import {
  EmptyQueryState,
  EmptyResultsState,
  SearchErrorState,
} from "./_components/search-states"

export const metadata: Metadata = {
  title: "Search — SearchForge",
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = parseSearchParams(await searchParams)
  const query = params.q ?? ""
  const filterCount = activeFilterCount(params)
  const searching = Boolean(query) || filterCount > 0

  let data: SearchResponse | null = null
  let failure: unknown = null
  if (searching) {
    try {
      data = await searchDocuments({
        ...params,
        limit: params.limit ?? DEFAULT_PAGE_SIZE,
      })
    } catch (error) {
      console.error("Search request failed", error)
      failure = error
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl flex-1 px-4 pt-10 pb-16 sm:px-6 sm:pt-14">
      <SearchBox defaultValue={query} className="mx-auto max-w-2xl" />
      <div className="mt-8 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        {/* Collapsible filters on small screens — native details, no JS. */}
        <details className="group mb-6 rounded-xl border border-border bg-card lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal
                className="size-4 text-muted-foreground"
                aria-hidden
              />
              Filters
              {filterCount > 0 ? (
                <Badge variant="secondary">{filterCount}</Badge>
              ) : null}
            </span>
            <ChevronDown
              className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="border-t border-border/60 px-3 pt-1 pb-3">
            <SearchFilters params={params} />
          </div>
        </details>
        {/* Sticky sidebar on large screens. */}
        <aside className="hidden lg:block">
          <div className="sticky top-20">
            <SearchFilters params={params} />
          </div>
        </aside>
        {/* Results column. */}
        <div className="min-w-0">
          {!searching ? (
            <EmptyQueryState />
          ) : failure ? (
            <SearchErrorState
              error={failure}
              retryHref={buildSearchHref(params)}
            />
          ) : data ? (
            <>
              <ActiveFilters params={params} />
              {data.results.length > 0 ? (
                <>
                  <div className={filterCount > 0 ? "mt-4" : undefined}>
                    <SearchResults
                      data={data}
                      query={query || undefined}
                      from={buildSearchHref(params)}
                    />
                  </div>
                  <Pagination pagination={data.pagination} params={params} />
                </>
              ) : (
                <EmptyResultsState
                  query={query || undefined}
                  clearFiltersHref={
                    filterCount > 0
                      ? buildSearchHref({ q: params.q })
                      : undefined
                  }
                />
              )}
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}

import Link from "next/link"

import { buildSearchHref, type SearchUrlParams } from "@/lib/search-url"
import { SEARCH_MODES, type SearchMode } from "@/types/search"

const LABELS: Record<SearchMode, string> = {
  keyword: "Keyword",
  semantic: "Semantic",
  hybrid: "Hybrid",
}

/**
 * Keyword/semantic mode selector as a segmented control of plain links —
 * server-rendered, no client JS required. Switching mode resets to page 1
 * while preserving query and filters.
 */
export function SearchModeToggle({ params }: { params: SearchUrlParams }) {
  const active: SearchMode = params.mode ?? "keyword"
  return (
    <div
      role="group"
      aria-label="Search mode"
      className="inline-flex rounded-lg border border-border bg-card p-1"
    >
      {SEARCH_MODES.map((mode) => (
        <Link
          key={mode}
          href={buildSearchHref({
            ...params,
            mode: mode === "keyword" ? undefined : mode,
            page: undefined,
          })}
          aria-current={mode === active ? "true" : undefined}
          className={
              mode === active
              ? "rounded-md bg-foreground/10 px-3 py-1.5 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              : "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          }
        >
          {LABELS[mode]}
        </Link>
      ))}
    </div>
  )
}

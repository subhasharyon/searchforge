import { X } from "lucide-react"
import Link from "next/link"

import {
  activeFilterCount,
  buildSearchHref,
  type SearchUrlParams,
} from "@/lib/search-url"

const LABELS = {
  category: "Category",
  source: "Source",
  technology: "Technology",
  contentType: "Content type",
} as const

type FilterKey = keyof typeof LABELS

export function ActiveFilters({ params }: { params: SearchUrlParams }) {
  const active = (
    [
      ["category", params.category],
      ["source", params.source],
      ["technology", params.technology],
      ["contentType", params.contentType],
    ] as [FilterKey, string | undefined][]
  ).filter((entry): entry is [FilterKey, string] => Boolean(entry[1]))

  if (active.length === 0) {
    return null
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {active.map(([key, value]) => (
        <Link
          key={key}
          href={buildSearchHref({
            ...params,
            [key]: undefined,
            page: undefined,
          })}
          aria-label={`Remove ${LABELS[key]} filter`}
          className="group inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 py-1 pr-2 pl-2.5 text-xs font-medium text-foreground outline-none transition-colors hover:border-brand/50 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="text-muted-foreground">{LABELS[key]}:</span>
          {value}
          <X
            className="size-3 text-muted-foreground transition-colors group-hover:text-foreground"
            aria-hidden
          />
        </Link>
      ))}
      {activeFilterCount(params) > 1 ? (
        <Link
          href={buildSearchHref({ q: params.q, limit: params.limit })}
          className="rounded-sm px-1 text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Clear all
        </Link>
      ) : null}
    </div>
  )
}

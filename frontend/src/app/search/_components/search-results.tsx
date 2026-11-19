import Link from "next/link"
import { ExternalLink } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { displayHost, formatDate } from "@/lib/format"
import { safeHttpUrl } from "@/lib/documents"
import { highlightToHtml } from "@/lib/highlight"
import type { SearchResponse, SearchResultItem } from "@/types/search"

function HighlightedText({ html }: { html: string }) {
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

function ResultCard({
  result,
  from,
}: {
  result: SearchResultItem
  from: string
}) {
  const titleHtml = result.highlights.title[0]
    ? highlightToHtml(result.highlights.title[0])
    : null
  const excerpt = result.highlights.content
    .slice(0, 2)
    .map(highlightToHtml)
    .join(" … ")
  const updated = formatDate(result.updatedAt)
  const published = result.publishedAt ? formatDate(result.publishedAt) : null
  const externalUrl = safeHttpUrl(result.url)
  const detailHref = `/documents/${encodeURIComponent(result.id)}?from=${encodeURIComponent(from)}`

  return (
    <article className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={detailHref}
          className="group min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <h2 className="text-[15px] leading-6 font-medium text-balance text-foreground group-hover:text-brand">
            {titleHtml ? <HighlightedText html={titleHtml} /> : result.title}
          </h2>
        </Link>
        {externalUrl ? (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open original at ${displayHost(externalUrl)}`}
            className="mt-1 shrink-0 rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground/80">
        {displayHost(result.url)}
      </p>
      {excerpt ? (
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-pretty text-muted-foreground">
          <HighlightedText html={excerpt} />
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Badge variant="secondary">{result.source}</Badge>
        <Badge variant="outline">{result.category}</Badge>
        <Badge variant="outline" className="font-mono font-normal">
          {result.contentType}
        </Badge>
        {result.technologies.slice(0, 4).map((tech) => (
          <Badge
            key={tech}
            variant="outline"
            className="font-mono font-normal"
          >
            {tech}
          </Badge>
        ))}
        <span className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
          {result.author ? <span>{result.author}</span> : null}
          {published ? <span>Published {published}</span> : null}
          {updated ? <span>Updated {updated}</span> : null}
        </span>
      </div>
    </article>
  )
}

export function SearchResults({
  data,
  query,
  from,
}: {
  data: SearchResponse
  query?: string
  from: string
}) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">
        {data.pagination.total.toLocaleString("en-US")}{" "}
        {data.pagination.total === 1 ? "result" : "results"}
        {query ? (
          <>
            {" "}for{" "}
            <span className="font-medium text-foreground">“{query}”</span>
          </>
        ) : null}
      </p>
      <div className="mt-4 space-y-3">
        {data.results.map((result) => (
          <ResultCard key={result.id} result={result} from={from} />
        ))}
      </div>
    </div>
  )
}

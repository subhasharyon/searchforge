import { ExternalLink } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { highlightToHtml } from "@/lib/highlight"
import type { SearchResponse, SearchResultItem } from "@/types/search"

function HighlightedText({ html }: { html: string }) {
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function formatDate(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function ResultCard({ result }: { result: SearchResultItem }) {
  const titleHtml = result.highlights.title[0]
    ? highlightToHtml(result.highlights.title[0])
    : null
  const excerpt = result.highlights.content
    .slice(0, 2)
    .map(highlightToHtml)
    .join(" … ")
  const updated = formatDate(result.updatedAt)
  const published = result.publishedAt ? formatDate(result.publishedAt) : null

  return (
    <article className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/20 sm:p-5">
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group inline-flex max-w-full items-baseline gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <h2 className="text-[15px] leading-6 font-medium text-balance text-foreground group-hover:text-brand">
          {titleHtml ? <HighlightedText html={titleHtml} /> : result.title}
        </h2>
        <ExternalLink
          className="size-3.5 shrink-0 translate-y-0.5 self-center text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </a>
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
}: {
  data: SearchResponse
  query?: string
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
          <ResultCard key={result.id} result={result} />
        ))}
      </div>
    </div>
  )
}

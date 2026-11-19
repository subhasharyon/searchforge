import { FileSearch, SearchX, TriangleAlert } from "lucide-react"
import Link from "next/link"

import { ApiError } from "@/lib/api/client"
import { Button } from "@/components/ui/button"

function StateShell({
  icon: Icon,
  title,
  message,
  children,
}: {
  icon: typeof FileSearch
  title: string
  message: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center pt-14 pb-6 text-center">
      <span className="grid size-12 place-items-center rounded-xl border border-border bg-card text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <h2 className="mt-5 text-xl font-semibold tracking-tight text-balance text-foreground">
        {title}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-pretty text-muted-foreground">
        {message}
      </p>
      {children}
    </div>
  )
}

export function EmptyQueryState() {
  return (
    <StateShell
      icon={FileSearch}
      title="Search technical documentation"
      message="Enter a query above, or apply filters to browse the index."
    />
  )
}

export function EmptyResultsState({
  query,
  clearFiltersHref,
}: {
  query?: string
  clearFiltersHref?: string
}) {
  return (
    <StateShell
      icon={SearchX}
      title={
        query ? `No results for “${query}”` : "No documents match these filters"
      }
      message={
        clearFiltersHref
          ? "No documents match the current filters. Broaden the query or clear a filter to see more."
          : "Try different keywords, check the spelling, or broaden the query — the index is still growing."
      }
    >
      {clearFiltersHref ? (
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          className="mt-6"
          render={<Link href={clearFiltersHref} />}
        >
          Clear all filters
        </Button>
      ) : null}
    </StateShell>
  )
}

/** Maps an ApiError to a user-safe message — internals stay server-side. */
function describeError(error: unknown): { title: string; message: string } {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case "network":
        return {
          title: "Can't reach the search service",
          message:
            "The search service didn't respond. Check that it's running and try again.",
        };
      case "config":
        return {
          title: "Search isn't configured",
          message:
            "The search service connection hasn't been set up yet on this deployment.",
        };
      case "auth":
        return {
          title: "Search access unavailable",
          message:
            "The search service couldn't authenticate right now. Try again in a moment.",
        };
      case "unexpected":
        return {
          title: "Unexpected response",
          message:
            "The search service returned something we couldn't read. Try again in a moment.",
        };
      case "http":
        if (error.status === 429) {
          return {
            title: "Too many searches",
            message: "You're searching faster than the limit. Wait a moment and try again.",
          };
        }
        if (error.status === 400) {
          return {
            title: "That search couldn't be processed",
            message:
              "The query was rejected — it may be too long or contain unsupported parameters.",
          };
        }
        return {
          title: "Search is temporarily unavailable",
          message:
            "The search service reported a problem. Try again in a moment.",
        };
    }
  }
  return {
    title: "Something went wrong",
    message: "The search failed unexpectedly. Try again in a moment.",
  };
}

export function SearchErrorState({
  error,
  retryHref,
}: {
  error: unknown
  retryHref: string
}) {
  const { title, message } = describeError(error)
  return (
    <StateShell icon={TriangleAlert} title={title} message={message}>
      <div className="mt-6 flex items-center gap-2">
        {/* A plain anchor forces a full reload, re-running the server fetch. */}
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={retryHref} />}
        >
          Try again
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/" />}
          className="text-muted-foreground"
        >
          Back to home
        </Button>
      </div>
    </StateShell>
  )
}

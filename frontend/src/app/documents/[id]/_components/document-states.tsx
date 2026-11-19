import Link from "next/link"
import { TriangleAlert } from "lucide-react"

import { StateShell } from "@/components/shared/state-shell"
import { ApiError } from "@/lib/api/client"
import { Button } from "@/components/ui/button"

/** Maps an ApiError to a user-safe message — internals stay server-side. */
function describeError(error: unknown): { title: string; message: string } {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case "network":
        return {
          title: "Can't reach the document service",
          message:
            "The document service didn't respond. Check that it's running and try again.",
        }
      case "config":
        return {
          title: "Documents aren't configured",
          message:
            "The document service connection hasn't been set up yet on this deployment.",
        }
      case "auth":
        return {
          title: "Document access unavailable",
          message:
            "The document service couldn't authenticate right now. Try again in a moment.",
        }
      case "unexpected":
        return {
          title: "Unexpected response",
          message:
            "The document service returned something we couldn't read. Try again in a moment.",
        }
      case "http":
        if (error.status === 429) {
          return {
            title: "Too many requests",
            message:
              "You're loading documents faster than the limit. Wait a moment and try again.",
          }
        }
        return {
          title: "Document is temporarily unavailable",
          message:
            "The document service reported a problem. Try again in a moment.",
        }
    }
  }
  return {
    title: "Something went wrong",
    message: "The document couldn't be loaded. Try again in a moment.",
  }
}

export function DocumentErrorState({
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
          render={<Link href="/search" />}
          className="text-muted-foreground"
        >
          Back to search
        </Button>
      </div>
    </StateShell>
  )
}

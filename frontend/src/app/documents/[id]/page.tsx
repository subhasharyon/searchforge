import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ExternalLink } from "lucide-react"

import { ApiError } from "@/lib/api/client"
import { getDocumentById } from "@/lib/api/documents"
import {
  isValidDocumentId,
  safeHttpUrl,
  sanitizeReturnPath,
} from "@/lib/documents"
import { requireSession } from "@/lib/session"
import { displayHost, formatDate } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { DocumentDetail } from "@/types/document"
import { DocumentErrorState } from "./_components/document-states"

export async function generateMetadata({
  params,
}: PageProps<"/documents/[id]">): Promise<Metadata> {
  const { id } = await params
  if (!isValidDocumentId(id)) {
    return { title: "Document not found — SearchForge" }
  }
  try {
    // getDocumentById is React-cached — this shares the page's request.
    const document = await getDocumentById(id)
    return {
      title: `${document.title} — SearchForge`,
      description: document.content.slice(0, 160),
    }
  } catch {
    return { title: "Document — SearchForge" }
  }
}

function DocumentMeta({ document }: { document: DocumentDetail }) {
  const published = document.publishedAt
    ? formatDate(document.publishedAt)
    : null
  const updated = formatDate(document.updatedAt)
  const items = [
    document.author ?? null,
    published ? `Published ${published}` : null,
    updated ? `Updated ${updated}` : null,
  ].filter((item): item is string => Boolean(item))

  if (items.length === 0) return null

  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      {items.map((item, index) => (
        <span key={item} className="inline-flex items-center gap-2">
          {index > 0 ? <span aria-hidden>·</span> : null}
          {item}
        </span>
      ))}
    </p>
  )
}

export default async function DocumentPage({
  params,
  searchParams,
}: PageProps<"/documents/[id]">) {
  const [{ id }, rawSearchParams] = await Promise.all([params, searchParams])
  if (!isValidDocumentId(id)) {
    notFound()
  }

  const backHref = sanitizeReturnPath(rawSearchParams.from)
  const selfHref =
    rawSearchParams.from && backHref !== "/search"
      ? `/documents/${id}?from=${encodeURIComponent(backHref)}`
      : `/documents/${id}`
  await requireSession(selfHref)

  let document: DocumentDetail | null = null
  let failure: unknown = null
  try {
    document = await getDocumentById(id)
  } catch (error) {
    console.error("Document fetch failed", error)
    failure = error
  }

  if (failure) {
    // 404 DOCUMENT_NOT_FOUND and 400 (invalid ObjectId) both mean "no such
    // document" — surface a real 404, not an error wall.
    if (
      failure instanceof ApiError &&
      failure.kind === "http" &&
      (failure.status === 400 || failure.status === 404)
    ) {
      notFound()
    }
    return (
      <section className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 sm:px-6">
        <DocumentErrorState
          error={failure}
          retryHref={`/documents/${id}`}
        />
      </section>
    )
  }
  if (!document) return null

  const originalUrl = safeHttpUrl(document.url)

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to results
      </Link>

      <article className="mx-auto mt-10 max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{document.source}</Badge>
          <Badge variant="outline">{document.category}</Badge>
          <Badge variant="outline" className="font-mono font-normal">
            {document.contentType}
          </Badge>
        </div>

        <h1 className="mt-4 text-2xl leading-9 font-semibold tracking-tight text-balance [overflow-wrap:break-word] text-foreground sm:text-3xl sm:leading-10">
          {document.title}
        </h1>

        <DocumentMeta document={document} />

        {document.technologies.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {document.technologies.map((tech) => (
              <Badge
                key={tech}
                variant="outline"
                className="font-mono font-normal"
              >
                {tech}
              </Badge>
            ))}
          </div>
        ) : null}

        <Separator className="mt-6" />

        {/* content is plain text — rendered as text only, never as HTML.
            overflow-wrap keeps long unbroken tokens (URLs, hashes) from
            overflowing the card on narrow screens. */}
        <div className="mt-6 rounded-xl border border-border/60 bg-card px-5 py-6 text-[15px] leading-7 whitespace-pre-wrap [overflow-wrap:break-word] text-foreground/90 sm:px-8 sm:py-8">
          {document.content}
        </div>

        {originalUrl ? (
          <div className="mt-6">
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <a
                  href={originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLink className="size-3.5" aria-hidden />
              View original
              <span className="font-mono text-xs text-muted-foreground">
                {displayHost(originalUrl)}
              </span>
            </Button>
          </div>
        ) : null}
      </article>
    </div>
  )
}

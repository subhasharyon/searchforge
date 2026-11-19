"use client"

import { CornerDownLeft } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"

import { Input } from "@/components/ui/input"
import { buildSearchHref, type SearchUrlParams } from "@/lib/search-url"

/**
 * Free-text filter for backend params that have no finite option set
 * (source, technology). Applies on Enter; clearing the field and
 * submitting removes the filter. The parent keys this component by the
 * applied value so it resyncs after navigation.
 */
export function TextFilter({
  name,
  value,
  params,
  placeholder,
}: {
  name: "source" | "technology"
  value: string
  params: SearchUrlParams
  placeholder?: string
}) {
  const router = useRouter()
  const [text, setText] = useState(value)

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = text.trim()
    router.push(
      buildSearchHref({
        ...params,
        [name]: next || undefined,
        page: undefined,
      })
    )
  }

  return (
    <form onSubmit={onSubmit} className="relative">
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setText(value)
          }
        }}
        placeholder={placeholder}
        aria-label={`Filter by ${name}`}
        className="h-8 pr-7 text-[13px]"
      />
      {text.trim() ? (
        <button
          type="submit"
          aria-label={`Apply ${name} filter`}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <CornerDownLeft className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </form>
  )
}

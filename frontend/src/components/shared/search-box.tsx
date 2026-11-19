"use client"

import { ArrowRight, Search, X } from "lucide-react"
import { useRouter } from "next/navigation"
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"

const subscribe = () => () => {}
const getIsMac = () =>
  typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent)
const getIsMacServer = () => false

export function SearchBox({
  defaultValue = "",
  className,
}: {
  defaultValue?: string
  className?: string
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(defaultValue)
  const isMac = useSyncExternalStore(subscribe, getIsMac, getIsMacServer)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = query.trim()
    if (!value) {
      inputRef.current?.focus()
      return
    }
    router.push(`/search?q=${encodeURIComponent(value)}`)
  }

  return (
    <form role="search" onSubmit={onSubmit} className={cn("w-full", className)}>
      <div className="flex h-12 items-center gap-3 rounded-xl border border-border bg-card/80 pr-2 pl-4 shadow-xs backdrop-blur transition-colors focus-within:border-ring/60 focus-within:ring-4 focus-within:ring-ring/15 sm:h-13">
        <Search
          className="size-4.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          role="searchbox"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.stopPropagation()
              setQuery("")
            }
          }}
          placeholder="Search docs, guides, APIs…"
          aria-label="Search technical documentation"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        {query ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Clear search"
            onClick={() => {
              setQuery("")
              inputRef.current?.focus()
            }}
          >
            <X />
          </Button>
        ) : null}
        <kbd
          aria-hidden
          className="pointer-events-none hidden shrink-0 items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground sm:inline-flex"
        >
          <span>{isMac ? "⌘" : "Ctrl"}</span>
          <span>K</span>
        </kbd>
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          aria-label="Submit search"
        >
          <ArrowRight />
        </Button>
      </div>
    </form>
  )
}
